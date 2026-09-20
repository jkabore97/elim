import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'

// NOTE: a global CSS `zoom: 0.9` was tried here to shrink the native app, but
// it scaled down the phone's safe-area insets (env(safe-area-inset-*)), so
// fixed bars and bottom sheets across the app lost their spacing and got
// clipped by the gesture bar ("crop everywhere"). Removed — correct layout and
// safe areas matter more than the slight size reduction.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
