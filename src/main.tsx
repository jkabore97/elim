import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'

// In the phone app the same live site renders noticeably larger than in a
// desktop browser. Zoom the whole app to 90% on native only (via the viewport
// scale, so it reflows to fill the screen with no gaps) — the browser keeps
// its own scale untouched.
if (Capacitor.isNativePlatform()) {
  const vp = document.querySelector('meta[name="viewport"]')
  if (vp) vp.setAttribute('content',
    'width=device-width, initial-scale=0.9, maximum-scale=0.9, user-scalable=no, viewport-fit=cover')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
