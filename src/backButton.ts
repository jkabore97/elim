import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

// A stack of "things the back button should close, most recent first".
//
// Without this, Android's back button goes straight to its default - leaving
// the app - regardless of what's open on screen. So closing a zoomed photo,
// leaving a conversation, or exiting a fullscreen video all quit the app
// instead, which is jarring and loses the person's place.
//
// Overlays register a dismiss function while they're open. Back pops the top
// one. Only when the stack is empty does the default (leave the app) apply.
type Handler = () => void
const stack: Handler[] = []

export function pushBackHandler(handler: Handler) {
  stack.push(handler)
  return () => {
    const i = stack.lastIndexOf(handler)
    if (i >= 0) stack.splice(i, 1)
  }
}

// Convenience hook: registers for as long as `active` is true.
//
// The handler is held in a ref and deliberately kept OUT of the dependency
// list. Callers pass inline arrow functions, which are a new identity every
// render - depending on them would unregister and re-register on every single
// render, constantly reordering the stack so "most recent first" stopped
// meaning anything. The ref keeps the latest handler without that churn.
export function useBackHandler(active: boolean, handler: Handler) {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => ref.current())
  }, [active])
}

function handleBack(): boolean {
  // Fullscreen video is checked first and separately: the browser owns that
  // state, no component registered it, and it visually sits above everything
  // else - so it must be what closes first.
  const fsDoc = document as any
  if (document.fullscreenElement || fsDoc.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
    else if (fsDoc.webkitExitFullscreen) fsDoc.webkitExitFullscreen()
    return true
  }

  const handler = stack.pop()
  if (handler) {
    handler()
    return true
  }
  return false
}

// Native: intercept the hardware back button. Web/PWA: intercept browser back
// via a sentinel history entry, so the same behaviour applies in Chrome.
export function initBackButton() {
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (handleBack()) return
      if (canGoBack) window.history.back()
      else CapApp.exitApp()
    }).catch(() => {})
    return
  }

  // Push a sentinel so there is always something for the browser's back to
  // consume; if nothing was open to close, the sentinel is re-pushed and the
  // person stays put rather than being thrown out of the app.
  try {
    window.history.pushState({ elimSentinel: true }, '')
    window.addEventListener('popstate', () => {
      if (handleBack()) {
        window.history.pushState({ elimSentinel: true }, '')
      }
    })
  } catch {
    // History API unavailable in some embedded contexts - not worth breaking
    // startup over.
  }
}
