import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { exportDocx, exportPdf, exportText, type Result } from './export.ts'
import { EXAMPLE_NOTES, extractActionItems, extractAttendees, splitDates } from './extract.ts'
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
  const fileInput = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState('')
  const [model, setModel] = useState<Model>({ status: 'loading', loaded: 0, total: 0, downloading: false })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState({ key: 0, date: '' })

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
      if (data.type === 'progress') setModel({ status: 'loading', ...data })
      else if (data.type === 'ready') setModel({ status: 'ready', fromCache: data.fromCache })
      else if ('id' in data && data.id !== requestId.current) return // stale (cleared or superseded)
      else if (data.type === 'chunk') setProgress({ done: data.done, total: data.total })
      else if (data.type === 'result') {
        setResult((r) => r && { ...r, summary: data.summary })
        setProgress(null)
      } else if (data.type === 'error') {
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
    const text = notes.trim()
    if (!text || progress) return
    setError('')
    const id = ++requestId.current
    setRun({ key: id, date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) })
    setResult({ summary: '', actions: extractActionItems(text), attendees: extractAttendees(text) })
    setProgress({ done: 0, total: 1 })
    worker.current?.postMessage({ type: 'summarize', id, text } satisfies WorkerIn)
  }

  const clear = () => {
    requestId.current++ // drop any summary still in flight
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
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') return setError('Please choose a plain-text (.txt) file.')
    if (file.size > MAX_FILE_BYTES) return setError('That file is over 2 MB. Try a shorter set of notes.')
    const reader = new FileReader()
    reader.onload = () => (setNotes(String(reader.result)), setError(''))
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }

  const ready = model.status === 'ready'
  const busy = progress !== null
  const words = notes.trim() ? notes.trim().split(/\s+/).length : 0

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1 className="wordmark">Minutely</h1>
          <p className="tagline">Meeting notes, distilled. Never leaves your device.</p>
        </div>
        <p className="badge mono">
          <span className="dot" aria-hidden="true" /> On-device · No uploads
        </p>
      </header>

      <main className="grid">
        <section className="input" aria-labelledby="notes-label">
          <div className="section-head">
            <label id="notes-label" htmlFor="notes" className="mono label">
              Your notes
            </label>
            <span className="mono meta">{words.toLocaleString()} words</span>
          </div>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && summarize()}
            placeholder={'Paste meeting notes here…\n\nTip: include a line like “Attendees: Ana, Ben, Chloe” to list who was there.'}
            spellCheck
          />
          <div className="toolbar">
            <label className="btn ghost file">
              <input ref={fileInput} type="file" accept=".txt,text/plain" onChange={onFile} className="sr-only" />
              Upload .txt
            </label>
            <button type="button" className="btn ghost" onClick={() => (setNotes(EXAMPLE_NOTES), setError(''))}>
              Try an example
            </button>
            <button type="button" className="btn ghost" onClick={clear} disabled={!notes && !result}>
              Clear
            </button>
            <button type="button" className="btn primary" onClick={summarize} disabled={!ready || !notes.trim() || busy}>
              {busy ? 'Summarizing…' : 'Summarize'}
            </button>
          </div>
          <p className="hint mono">⌘/Ctrl + Enter to summarize</p>

          <div className="model" role="status" aria-live="polite">
            {model.status === 'loading' && (
              <>
                <p>
                  {model.downloading
                    ? `Downloading the summarization model — ${mb(model.loaded)} of ${mb(model.total)} MB`
                    : 'Loading the summarization model…'}
                </p>
                <progress max={model.total || 1} value={model.loaded} aria-label="Model download progress" />
                {model.downloading && <p className="meta">One-time download from Hugging Face. It's cached in your browser afterward, so next time it loads instantly.</p>}
              </>
            )}
            {model.status === 'ready' && (
              <p>
                <span className="dot" aria-hidden="true" /> Model ready{model.fromCache ? ' — loaded from your device cache' : ' and cached for next time'}.
              </p>
            )}
            {model.status === 'error' && (
              <p className="error">
                Couldn't load the model ({model.message}).{' '}
                <button type="button" className="link" onClick={retryModel}>
                  Try again
                </button>
              </p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="page" aria-label="Summary document" aria-busy={busy}>
          {!result ? (
            <div className="empty">
              <p className="empty-title">Your summary will appear here.</p>
              <p>Paste notes or try the example, then press Summarize. Everything runs inside this tab.</p>
            </div>
          ) : (
            <article className="doc fade-in" key={run.key}>
              <p className="mono meta">
                Meeting notes · {run.date}
              </p>

              <h2 className="doc-label mono">
                <span>01</span> Summary
              </h2>
              {busy ? (
                <p className="meta">
                  Distilling{progress.total > 1 ? ` part ${progress.done + 1} of ${progress.total}` : ''}…
                </p>
              ) : (
                result.summary.split('\n\n').map((p, i) => (
                  <p key={i} className="summary">
                    {p}
                  </p>
                ))
              )}

              <h2 className="doc-label mono">
                <span>02</span> Action items
              </h2>
              {result.actions.length ? (
                <ol className="actions">
                  {result.actions.map((a, i) => (
                    <li key={i}>
                      <span className="mono num">{String(i + 1).padStart(2, '0')}</span>
                      <span>{splitDates(a).map((part, j) => (part.date ? <mark key={j}>{part.text}</mark> : part.text))}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="meta">No action items found.</p>
              )}

              <h2 className="doc-label mono">
                <span>03</span> Attendees
              </h2>
              {result.attendees.length ? (
                <ul className="pills">
                  {result.attendees.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="meta">No “Attendees:” line found.</p>
              )}

              {!busy && (
                <div className="exports">
                  <div className="toolbar">
                    <button type="button" className="btn ghost" onClick={() => exportPdf(result)}>
                      PDF
                    </button>
                    <button type="button" className="btn ghost" onClick={() => exportDocx(result)}>
                      Word (.docx)
                    </button>
                    <button type="button" className="btn ghost" onClick={() => exportText(result)}>
                      Plain text
                    </button>
                  </div>
                  <p className="meta">Files are generated in your browser. The .docx also opens in Google Docs.</p>
                </div>
              )}
            </article>
          )}
        </section>
      </main>

      <section className="privacy" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="privacy-title">
          How your privacy is protected
        </h2>
        <ol className="privacy-list">
          <li>
            <span className="mono num">01</span>
            <h3>Your notes never leave your device</h3>
            <p>The summarization model runs inside your browser. There is no server that receives your text — this site has no backend at all.</p>
          </li>
          <li>
            <span className="mono num">02</span>
            <h3>Nothing is uploaded or stored</h3>
            <p>No accounts, analytics, cookies, or tracking. Your notes live only in this tab's memory, and “Clear” wipes them. Close the tab and they're gone.</p>
          </li>
          <li>
            <span className="mono num">03</span>
            <h3>Keeps working offline while open</h3>
            <p>The only download is the model itself, fetched from Hugging Face and cached. Once it has loaded, turn off your Wi-Fi without closing or refreshing the page and keep summarizing. It still works.</p>
          </li>
          <li>
            <span className="mono num">04</span>
            <h3>Locked down by the browser</h3>
            <p>A strict Content-Security-Policy blocks this page from contacting anything except its own files and the model host.</p>
          </li>
        </ol>
      </section>

      <footer className="footer mono">Minutely · Meeting notes, distilled.</footer>
    </div>
  )
}
