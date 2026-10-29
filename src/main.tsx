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

// Browser page translation (Chrome's Google Translate, Edge, etc.) replaces the
// text nodes React rendered with its own <font> wrappers. When React later
// updates that text it calls removeChild/insertBefore on a node that is no
// longer where it left it, and the whole app crashes with "NotFoundError:
// Failed to execute 'removeChild' on 'Node'". Make those two calls tolerant of
// a moved node (the standard workaround, facebook/react#11538) so translation
// keeps working instead of taking the app down.
if (typeof Node === 'function' && Node.prototype) {
  const origRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child
    return origRemoveChild.call(this, child) as T
  }
  const origInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, refNode: Node | null): T {
    if (refNode && refNode.parentNode !== this) return origInsertBefore.call(this, newNode, null) as T
    return origInsertBefore.call(this, newNode, refNode) as T
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
