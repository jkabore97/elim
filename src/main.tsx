import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'

// In the phone app the same live site renders noticeably larger than in a
// desktop browser. Zoom the whole app OUT to 90% on native only. CSS `zoom` on
// the root enlarges the layout viewport and scales it down, so content reflows
// to fill the screen exactly — smaller, with no horizontal panning and no gaps.
// (The earlier viewport initial-scale approach widened the layout and caused
// left/right scrolling — this doesn't.) The browser keeps its own scale.
if (Capacitor.isNativePlatform()) {
  document.documentElement.style.zoom = '0.9'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
