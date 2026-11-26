// Copies the ONNX Runtime WebAssembly files into public/ so they are served
// from our own origin instead of a third-party CDN.
import { cpSync, mkdirSync } from 'node:fs'

const src = 'node_modules/onnxruntime-web/dist/'
mkdirSync('public/ort', { recursive: true })
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(src + f, 'public/ort/' + f)
