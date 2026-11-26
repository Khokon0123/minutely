import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { exportDocx, exportPdf, exportText, NO_ACTIONS, sections, type Result } from './export.ts'
import {
  decodeText,
  EXAMPLE_NOTES,
  extractActionItems,
  extractAttendees,
  MAX_WORDS,
  NO_RELIABLE_SUMMARY,
  splitDates,
  tooLongMessage,
  tooShortMessage,
  wordCount,
} from './extract.ts'
import type { WorkerIn, WorkerOut } from './worker.ts'

type Model =
  | { status: 'loading'; loaded: number; total: number; downloading: boolean }
  | { status: 'ready'; fromCache: boolean }
  | { status: 'error'; message: string }

const MAX_FILE_BYTES = 2 * 1024 * 1024
const mb = (n: number) => (n / 1024 / 1024).toFixed(0)

export default function App() {
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const running = useRef(false) // set synchronously, so a double click can't start two runs
  const fileInput = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const [notes, setNotes] = useState('')
  const [model, setModel] = useState<Model>({ status: 'loading', loaded: 0, total: 0, downloading: false })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [runKey, setRunKey] = useState(0)

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
      if (data.type === 'progress') setModel({ status: 'loading', ...data })
      else if (data.type === 'ready') setModel({ status: 'ready', fromCache: data.fromCache })
      else if ('id' in data && data.id !== requestId.current) return // stale (cleared or superseded)
      else if (data.type === 'chunk') setProgress({ done: data.done, total: data.total })
      else if (data.type === 'result') {
        running.current = false
        setResult((r) => r && { ...r, summary: data.summary, note: data.summary ? undefined : NO_RELIABLE_SUMMARY })
        setProgress(null)
      } else if (data.type === 'error') {
        running.current = false
        setProgress(null)
        if (data.id === undefined) setModel({ status: 'error', message: data.message })
        else setError(`Summarizing failed: ${data.message}`)
      }
    }
    const send = (m: WorkerIn) => w.postMessage(m)
    send({ type: 'load' })
    return () => w.terminate()
  }, [])

  const summarize = () => {
    if (running.current) return
    const text = notes.replace(/\r\n?/g, '\n').trim()
    if (!text) return setError('Paste or upload some notes first.')
    const words = wordCount(text)
    if (words > MAX_WORDS) return setError(tooLongMessage(words))
    setError('')
    const id = ++requestId.current
    setRunKey(id)
    const tooShort = tooShortMessage(text)
    setResult({
      date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      summary: '',
      note: tooShort ?? undefined,
      actions: extractActionItems(text),
      attendees: extractAttendees(text),
    })
    // On narrow screens the result sits below the input; bring it into view.
    if (window.matchMedia('(max-width: 900px)').matches) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }))
    }
    // Too little text makes the model invent content, so short notes skip the summarizer entirely.
    if (tooShort) return
    running.current = true
    setProgress({ done: 0, total: 1 })
    worker.current?.postMessage({ type: 'summarize', id, text } satisfies WorkerIn)
  }

  const clear = () => {
    requestId.current++ // drop any summary still in flight
    running.current = false
    worker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn)
    setNotes('')
    setResult(null)
    setProgress(null)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const retryModel = () => {
    setModel({ status: 'loading', loaded: 0, total: 0, downloading: false })
    worker.current?.postMessage({ type: 'load' } satisfies WorkerIn)
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.txt$/i.test(file.name)) return setError('Only plain-text (.txt) files can be uploaded.')
    if (file.size > MAX_FILE_BYTES) return setError('That file is over 2 MB. Try a shorter set of notes.')
    const reader = new FileReader()
    reader.onload = () => {
      const text = decodeText(new Uint8Array(reader.result as ArrayBuffer))
      if (text === null) return setError("That file doesn't look like plain text.")
      if (!text.trim()) return setError('That file is empty.')
      setNotes(text)
      setError('')
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsArrayBuffer(file)
  }

  const ready = model.status === 'ready'
  const busy = progress !== null
  const words = wordCount(notes)

  const modelStatus =
    model.status === 'loading' ? (
      model.downloading ? (
        <>
          Getting ready: downloading <span className="count">{mb(model.loaded)}</span> of <span className="count">{mb(model.total)}</span> MB. This only
          happens the first time.
        </>
      ) : (
        'Getting ready…'
      )
    ) : model.status === 'ready' ? (
      'Ready. Paste your notes to get started.'
    ) : (
      `Couldn't get ready (${model.message}).`
    )

  return (
    <>
      <header className="bar">
        <div className="wrap top">
          <span className="logo">Minutely</span>
          <p className="top-status">
            <span className="dot" aria-hidden="true" />
            Private · runs on your computer
          </p>
          <a className="top-link" href="#privacy">
            How privacy works
          </a>
        </div>
      </header>

      <main className="wrap grid">
        <h1 className="lede">Turn meeting notes into a summary and to-do list. Your notes never leave your computer.</h1>

        <section className="input" aria-labelledby="notes-label">
          <div className="model" role="status" aria-live="polite">
            <progress
              className="model-bar"
              max={model.status === 'loading' ? model.total || 1 : 1}
              value={model.status === 'loading' ? model.loaded : 1}
              aria-label="Model download progress"
            />
            <p className="label">
              {modelStatus}
              {model.status === 'error' && (
                <>
                  {' '}
                  <button type="button" className="link" onClick={retryModel}>
                    Try again
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="field-head">
            <label id="notes-label" htmlFor="notes" className="label">
              Your notes
            </label>
            <span className="label">
              <span className="count">{words.toLocaleString()}</span> words
            </span>
          </div>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && summarize()}
            placeholder={'Paste meeting notes here…\n\nInclude a line like “Attendees: Ana, Ben, Chloe” to list who was there.'}
            spellCheck={false}
            // Ask grammar-checking extensions not to read or upload this field.
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
          />
          <div className="actions-row">
            <div className="text-buttons">
              <label className="text-btn file">
                <input ref={fileInput} type="file" accept=".txt,text/plain" onChange={onFile} className="sr-only" />
                Upload .txt
              </label>
              <button type="button" className="text-btn" onClick={() => (setNotes(EXAMPLE_NOTES), setError(''))}>
                Try an example
              </button>
              <button type="button" className="text-btn" onClick={clear} disabled={!notes && !result}>
                Clear
              </button>
            </div>
            <button type="button" className="primary" onClick={summarize} disabled={!ready || !notes.trim() || busy}>
              {busy ? 'Summarizing…' : 'Summarize'}
            </button>
          </div>
          <p className="label">⌘/Ctrl + Enter to summarize</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section ref={resultRef} className="result" aria-label="Summary document" aria-busy={busy}>
          {!result ? (
            <div className="empty">
              <p className="empty-title">Your summary will appear here.</p>
              <p className="muted">Paste notes or try the example, then press Summarize. Everything runs inside this tab.</p>
            </div>
          ) : (
            <article className="doc fade-in" key={runKey}>
              <p className="label">Meeting notes, {result.date}</p>

              <h2>Summary</h2>
              {busy ? (
                <p className="muted">
                  Summarizing
                  {progress.total > 1 && (
                    <>
                      {' '}part <span className="count">{progress.done + 1}</span> of <span className="count">{progress.total}</span>
                    </>
                  )}
                  …
                </p>
              ) : !result.summary ? (
                <p className="muted">{result.note}</p>
              ) : (
                result.summary.split('\n\n').map((p, i) => (
                  <p key={i} className="summary">
                    {p}
                  </p>
                ))
              )}

              <h2>Action items</h2>
              {result.actions.length ? (
                <ul className="action-list">
                  {result.actions.map((a, i) => (
                    <li key={i}>{splitDates(a).map((part, j) => (part.date ? <mark key={j}>{part.text}</mark> : part.text))}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{NO_ACTIONS}</p>
              )}

              <h2>Attendees</h2>
              <p className={result.attendees.length ? '' : 'muted'}>{sections(result).attendees}</p>

              {!busy && (
                <div className="exports">
                  <div className="text-buttons">
                    <button type="button" className="text-btn" onClick={() => exportPdf(result)}>
                      Download PDF
                    </button>
                    <button type="button" className="text-btn" onClick={() => exportDocx(result)}>
                      Word (.docx)
                    </button>
                    <button type="button" className="text-btn" onClick={() => exportText(result)}>
                      Plain text
                    </button>
                  </div>
                  <p className="label">Files are generated in your browser. The .docx also opens in Google Docs.</p>
                </div>
              )}
            </article>
          )}
        </section>
      </main>

      <section id="privacy" className="band" aria-labelledby="privacy-title">
        <div className="wrap privacy">
          <h2 id="privacy-title">How your privacy is protected</h2>
          <div className="privacy-cols">
            <div className="card">
              <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></svg>
              <h3>Your notes stay on your computer</h3>
              <p>Your notes are processed right here in your browser. They are never sent anywhere.</p>
            </div>
            <div className="card">
              <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v5M14 11v5" /></svg>
              <h3>Nothing is saved</h3>
              <p>
                Nothing you type is saved, and closing the page clears everything. We count page visits anonymously, without cookies. Your notes
                are never included.
              </p>
            </div>
            <div className="card">
              <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.9a10 10 0 0 1 5.2-2.7" /><path d="M19 12.9a10 10 0 0 0-2-1.5" /><path d="M2 8.8a15 15 0 0 1 4.2-2.7" /><path d="M10.7 5c4-.4 8.1.9 11.3 3.8" /><path d="M12 20h.01" /></svg>
              <h3>Works without internet</h3>
              <p>Once the page is ready, it keeps working even if you turn off Wi-Fi. Just keep the page open.</p>
            </div>
            <div className="card">
              <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.09.7 1.7s-.23 1.23-.7 1.7l-1.61 1.62a.98.98 0 0 1-.84.27c-.47-.07-.8-.48-.97-.92a2.5 2.5 0 1 0-3.21 3.21c.44.17.85.5.92.97a.98.98 0 0 1-.27.84l-1.62 1.61c-.47.47-1.09.7-1.7.7s-1.23-.23-1.7-.7l-1.57-1.57a1.03 1.03 0 0 0-.88-.29c-.49.07-.84.5-1.02.97a2.5 2.5 0 1 1-3.24-3.24c.47-.18.9-.53.97-1.02a1.03 1.03 0 0 0-.29-.88l-1.57-1.57A2.4 2.4 0 0 1 2 12c0-.62.24-1.23.7-1.7l1.53-1.53c.24-.24.58-.35.92-.3.51.08.88.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.2-.93-.56-1.01-1.07-.05-.34.06-.68.3-.92L10.3 2.7A2.4 2.4 0 0 1 12 2c.62 0 1.23.24 1.7.7l1.57 1.57c.23.23.56.34.88.29.49-.07.84-.5 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.47.18-.9.53-.97 1.02Z" /></svg>
              <h3>Watch your browser extensions</h3>
              <p>
                Browser extensions can read what you type. Grammarly and similar tools may send text to their own servers, so turn them off for this page
                when using confidential notes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bar footer">
        <p className="wrap">Minutely · Free to use · Your notes never leave your computer.</p>
      </footer>
    </>
  )
}
