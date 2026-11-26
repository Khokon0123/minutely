import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// `vite preview` serves the same security headers as production (vercel.json),
// so the Content-Security-Policy can be tested locally.
const vercelHeaders: { key: string; value: string }[] = JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers

// ONNX Runtime's bundle references its own .wasm as a fallback, so Vite emits a
// 27 MB copy. We always set wasmPaths to the self-hosted files in public/ort/,
// so that copy is never loaded; drop it from the output.
const dropUnusedOrtWasm: Plugin = {
  name: 'drop-unused-ort-wasm',
  generateBundle(_, bundle) {
    for (const file of Object.keys(bundle)) if (/ort-wasm-.*\.wasm$/.test(file)) delete bundle[file]
  },
}

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es', plugins: () => [dropUnusedOrtWasm] },
  // Never inline assets as data: URIs — the CSP only allows fonts from our own origin.
  build: { assetsInlineLimit: 0 },
  preview: { headers: Object.fromEntries(vercelHeaders.map((h) => [h.key, h.value])) },
})
