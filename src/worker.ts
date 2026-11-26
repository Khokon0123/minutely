/// <reference lib="webworker" />
// Runs the summarization model off the main thread. Nothing here is logged,
// persisted, or sent anywhere: text arrives by postMessage and the summary
// goes back the same way.
import { env, pipeline, type ProgressInfo, type SummarizationPipeline } from '@huggingface/transformers'
import { chunkText, cleanSummary, keySentences } from './extract.ts'

export type WorkerIn = { type: 'load' } | { type: 'summarize'; id: number; text: string } | { type: 'cancel' }
export type WorkerOut =
  | { type: 'progress'; loaded: number; total: number; downloading: boolean }
  | { type: 'ready'; fromCache: boolean }
  | { type: 'chunk'; id: number; done: number; total: number }
  | { type: 'result'; id: number; summary: string }
  | { type: 'error'; id?: number; message: string }

const MODEL = 'Xenova/distilbart-cnn-6-6'

env.allowLocalModels = false
// Serve ONNX Runtime from our own origin, never a CDN.
const ort = `${self.location.origin}/ort/`
env.backends.onnx.wasm!.wasmPaths = { mjs: `${ort}ort-wasm-simd-threaded.mjs`, wasm: `${ort}ort-wasm-simd-threaded.wasm` }

const post = (m: WorkerOut) => self.postMessage(m)
let loading: Promise<SummarizationPipeline> | null = null
let fromCache = false

async function isCached() {
  try {
    return (await (await caches.open(env.cacheKey)).keys()).length > 0
  } catch {
    return false
  }
}

function load() {
  loading ??= isCached().then((c) => {
    fromCache = c
    return pipeline('summarization', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: ProgressInfo) => {
        if (p.status === 'progress_total') post({ type: 'progress', loaded: p.loaded, total: p.total, downloading: !fromCache })
      },
    }) as Promise<SummarizationPipeline>
  }).then(
    (s) => (post({ type: 'ready', fromCache }), s),
    (e) => {
      loading = null
      throw e
    },
  )
  return loading
}

// Requests run one at a time. Only the latest one matters: a newer request, or a cancel from Clear,
// makes any earlier one stop at the next chunk boundary.
let latest = 0
let queue: Promise<void> = Promise.resolve()

self.onmessage = ({ data }: MessageEvent<WorkerIn>) => {
  if (data.type === 'cancel') {
    latest = -1
    return
  }
  if (data.type === 'summarize') latest = data.id
  queue = queue.then(() => handle(data))
}

async function handle(data: Exclude<WorkerIn, { type: 'cancel' }>) {
  const id = data.type === 'summarize' ? data.id : undefined
  try {
    const summarizer = await load()
    if (data.type !== 'summarize' || data.id !== latest) return
    const chunks = chunkText(data.text)
    const parts: string[] = []
    for (const [i, chunk] of chunks.entries()) {
      if (data.id !== latest) return
      post({ type: 'chunk', id: data.id, done: i, total: chunks.length })
      // Keep the summary well below the input length so the model condenses instead of padding.
      const words = chunk.split(' ').length
      const out = (await summarizer(chunk, {
        min_length: Math.min(56, Math.floor(words * 0.3)),
        max_new_tokens: Math.min(142, Math.floor(words * 0.6)),
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.2,
      })) as { summary_text: string }[]
      // Keep only what's grounded in the notes. If nothing is, fall back to this chunk's key sentences,
      // quoted from the notes, so no part of a long meeting silently drops out of the summary.
      parts.push(cleanSummary([out[0].summary_text], data.text) || keySentences(chunk))
    }
    // Remove sentences repeated across chunks.
    if (data.id === latest) post({ type: 'result', id: data.id, summary: cleanSummary(parts) })
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : 'Something went wrong.' })
  }
}
