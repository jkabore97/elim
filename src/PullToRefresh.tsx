import { useEffect, useRef, useState } from 'react'
import { Loader2, ArrowDown } from 'lucide-react'

// Pull-to-refresh for the whole app. Wraps the scrollable page content; when
// the page is scrolled to the very top and the finger drags down past a
// threshold, it runs onRefresh (a full reload, which re-establishes every
// realtime listener). Works on every tab because it lives around the shared
// content area. Touch-only, so it never interferes on desktop.
//
// The page itself is the scroller (window), and `overscroll-behavior: none`
// already disables the browser's own bounce/refresh, so this owns the gesture.
export function PullToRefresh({ onRefresh, children }: {
  onRefresh: () => void | Promise<void>
  children: React.ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const dragging = useRef(false)

  const THRESHOLD = 95   // px of pull needed to trigger — deliberate, not a graze
  const MAX = 130        // capped travel

  useEffect(() => {
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

    const onStart = (e: TouchEvent) => {
      // When an overlay (comments/notifications sheet, popup) has locked the page
      // scroll, the gesture belongs to that overlay — don't also pull-to-refresh.
      if (document.body.style.overflow === 'hidden') { startY.current = null; return }
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) { startY.current = null; return }
      startY.current = e.touches[0].clientY
      dragging.current = false
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && atTop()) {
        dragging.current = true
        const p = Math.min(MAX, dy * 0.5)   // resistance
        pullRef.current = p
        setPull(p)
        if (p > 4 && e.cancelable) e.preventDefault()   // stop the page from scrolling under the pull
      } else if (dragging.current) {
        pullRef.current = 0
        setPull(0)
      }
    }
    const onEnd = () => {
      if (startY.current == null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true
        setRefreshing(true)
        setPull(THRESHOLD)
        // Run the (in-place) refresh, then settle back — the user stays on the
        // same page, so the spinner must reset itself when the refresh is done.
        Promise.resolve(onRefresh()).catch(() => {}).finally(() => {
          refreshingRef.current = false
          setRefreshing(false)
          pullRef.current = 0
          setPull(0)
        })
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  const settling = startY.current == null

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[60] flex justify-center pointer-events-none"
        style={{
          height: pull,
          opacity: pull > 8 ? 1 : 0,
          transition: settling ? 'height .2s ease, opacity .2s ease' : 'none',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}>
        <div className="mt-2 w-9 h-9 rounded-full glass-bar flex items-center justify-center shadow-lg">
          {refreshing
            ? <Loader2 size={18} className="animate-spin text-affirm-600" />
            : <ArrowDown size={18} className={`text-affirm-600 transition-transform ${pull >= THRESHOLD ? 'rotate-180' : ''}`} />}
        </div>
      </div>
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: settling ? 'transform .2s ease' : 'none' }}>
        {children}
      </div>
    </>
  )
}
