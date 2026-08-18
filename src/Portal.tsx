import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

// Renders children into <body> instead of where the component sits in the tree.
//
// Fullscreen overlays use `position: fixed; inset: 0`, which is only relative
// to the viewport while no ancestor is a "containing block". An ancestor
// becomes one as soon as it has a transform, filter, backdrop-filter,
// will-change or `contain: layout` - all of which are ordinary styling choices
// that can appear anywhere up the tree. When that happens the overlay is
// silently confined to that ancestor's box instead of covering the screen.
//
// Portalling to <body> removes the whole class of bug: there is no ancestor
// left to trap it, so a future transform or blur on some wrapper can't break
// fullscreen again.
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
