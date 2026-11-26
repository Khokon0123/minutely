# Minutely

**Meeting notes, distilled. Never leaves your device.**

Minutely turns raw meeting notes into a short summary, a list of action items, and the attendee list, all inside your browser. There's no backend, no database, and no API route, so there's nothing on a server that could ever receive your text.

## What it does

- Paste notes or upload a `.txt` file. The file is read locally with `FileReader` and never uploaded.
- Summarizes with [`Xenova/distilbart-cnn-6-6`](https://huggingface.co/Xenova/distilbart-cnn-6-6) running through [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker, so the page never freezes. Long notes are split into chunks, each chunk is summarized, and the results are joined.
- Pulls out action items: any sentence containing *will, should, must, needs to, by, deadline,* or *follow up*, kept in its original wording, with dates highlighted.
- Reads attendees from a line that starts with `Attendees:`.
- Exports to PDF (jsPDF), Word `.docx` (docx), and plain text. All three files are generated in the browser. The `.docx` also opens in Google Docs.
- **Clear** wipes the notes and results from memory.

## How your privacy is protected

| Guarantee | How it's enforced |
| --- | --- |
| Your text never leaves the device | The app is static files only. The model runs in a Web Worker via WebAssembly. No code path sends your notes anywhere. |
| Nothing is stored | No cookies, no `localStorage`/`sessionStorage`/IndexedDB for user text, no analytics, no tracking scripts. Notes live in React state and disappear on **Clear** or when the tab closes. Nothing logs user content to the console. |
| Only two kinds of network traffic | The app's own static files, plus the model weights from Hugging Face. Fonts and the ONNX Runtime `.wasm` files are self-hosted, with no Google Fonts and no CDN. |
| The browser enforces it | `vercel.json` sets a strict Content-Security-Policy: `connect-src` allows only `'self'`, `huggingface.co`, and its file hosts (`*.huggingface.co`, `*.hf.co`). Scripts, fonts, and styles must come from our own origin. Even a bug or a compromised dependency can't send your notes to some other server. |
| Keeps working offline while open | Once the model has loaded, everything it needs is in the open tab. Turn off Wi-Fi and keep summarizing without closing or refreshing the page. A refresh needs a connection to load the page itself (there is no service worker), though the model comes back from Cache Storage (`transformers-cache`) instead of being downloaded again. |

The only thing ever cached is the public model itself, never your notes.

### Verify it yourself

1. Open DevTools → **Network**, load the page, summarize something. You'll see only same-origin requests and (on first visit) model files from Hugging Face.
2. Once the model is ready, turn off Wi-Fi and summarize again without refreshing the page.
3. DevTools → **Application**: no cookies, empty Local/Session Storage. The only Cache Storage entry is `transformers-cache`, which holds the model.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # checks for action-item/attendee/date/chunking logic
```

To test with the production security headers (the CSP from `vercel.json`):

```bash
npm run build
npm run preview    # http://localhost:4173, served with the same headers as Vercel
```

The first run downloads about 280 MB of model weights. After that, it loads from the browser cache.

## Deploy to Vercel

It's a plain static site:

```bash
npm i -g vercel
vercel            # framework: Vite, build: npm run build, output: dist
```

Or import the repository in the Vercel dashboard. It detects Vite automatically. `vercel.json` applies the Content-Security-Policy and other security headers to every route.

## Project layout

```
src/App.tsx          UI and state
src/worker.ts        Web Worker: loads the model, chunks and summarizes
src/extract.ts       Action items, attendees, date highlighting, chunking
src/export.ts        PDF / .docx / .txt generation
scripts/copy-ort.mjs Copies ONNX Runtime wasm into public/ so it's self-hosted
vercel.json          Security headers (CSP)
```

## Limitations

- distilbart was trained on news articles and sometimes invents details. Minutely checks every summary sentence against your notes. It drops any sentence with a word or number that isn't in the notes, or with long stretches of new phrasing. If nothing from part of the notes survives, it uses that part's two most representative sentences, quoted word for word. This catches invented facts, but a short sentence that recombines real phrases into a wrong claim can still slip through.
- Notes under 40 words aren't summarized, and notes over 10,000 words have to be split into parts.
- Chunking is based on word count (about 550 words per chunk), not exact token count.
- Action items are found by rules. "will" and "should" only count when a person, pronoun or team comes before them, and "by" only counts before a date. Lowercase names ("sam will…") and passive phrasing ("the room needs booking") are missed.
- In the PDF, lines with characters outside Western European fonts (for example Vietnamese, Bengali, Chinese or emoji) are embedded as sharp images. They display and print correctly but can't be selected or searched. The .docx and .txt exports keep them as real text.
