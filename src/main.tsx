import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/schibsted-grotesk'
import { Analytics } from '@vercel/analytics/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { pageViewOnly } from './analytics.ts'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Anonymous page-view counts in production only (the dev build would load a third-party debug script). */}
    {import.meta.env.PROD && <Analytics beforeSend={pageViewOnly} />}
  </StrictMode>,
)
