/// <reference lib="webworker" />
// Runs the summarization model off the main thread. Nothing here is logged,
// persisted, or sent anywhere: text arrives by postMessage and the summary
// goes back the same way.
import { env, pipeline, type ProgressInfo, type SummarizationPipeline } from '@huggingface/transformers'
import { chunkText } from './extract.ts'

export type WorkerIn = { type: 'load' } | { type: 'summarize'; id: number; text: string }
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

self.onmessage = async ({ data }: MessageEvent<WorkerIn>) => {
  const id = data.type === 'summarize' ? data.id : undefined
  try {
    const summarizer = await load()
    if (data.type !== 'summarize') return
    const chunks = chunkText(data.text)
    const parts: string[] = []
    for (const [i, chunk] of chunks.entries()) {
      post({ type: 'chunk', id: data.id, done: i, total: chunks.length })
      // The model's default 56-token minimum makes it invent filler for short notes; scale to the input.
      const words = chunk.split(' ').length
      const out = (await summarizer(chunk, {
        min_length: Math.min(56, Math.floor(words * 0.4)),
        max_new_tokens: Math.min(142, Math.max(24, words)),
      })) as { summary_text: string }[]
      parts.push(out[0].summary_text.trim())
    }
    post({ type: 'result', id: data.id, summary: parts.join('\n\n') })
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : 'Something went wrong.' })
  }
}
