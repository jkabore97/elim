import { useState, useRef, useEffect } from 'react'
import { useBackHandler } from './backButton'
import { X } from 'lucide-react'

// Fullscreen image viewer with pinch-to-zoom, double-tap-to-zoom, and pan.
// Implemented directly rather than relying on the browser's native page zoom,
// because the app sets a fixed viewport (needed for the app-like layout) which
// disables native pinch entirely.
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null)
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const lastTap = useRef(0)

  // Back zooms out first if zoomed in, then closes - so a zoomed photo takes
  // two presses rather than dumping the person straight out.
  useBackHandler(true, () => {
    if (scale > 1) { setScale(1); setOffset({ x: 0, y: 0 }) }
    else onClose()
  })

  // Escape closes, matching what people expect from a fullscreen overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const distance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.hypot(dx, dy)
  }

  const clampScale = (s: number) => Math.max(1, Math.min(5, s))

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStart.current = { dist: distance(e.touches), scale }
      panStart.current = null
    } else if (e.touches.length === 1 && scale > 1) {
      panStart.current = {
        x: e.touches[0].clientX, y: e.touches[0].clientY,
        ox: offset.x, oy: offset.y
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      const next = clampScale(pinchStart.current.scale * (distance(e.touches) / pinchStart.current.dist))
      setScale(next)
      if (next === 1) setOffset({ x: 0, y: 0 })
    } else if (e.touches.length === 1 && panStart.current) {
      setOffset({
        x: panStart.current.ox + (e.touches[0].clientX - panStart.current.x),
        y: panStart.current.oy + (e.touches[0].clientY - panStart.current.y)
      })
    }
  }

  const handleTouchEnd = () => {
    pinchStart.current = null
    panStart.current = null
  }

  // Double tap toggles between fit and 2.5x, the familiar photo-viewer gesture.
  const handleTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      if (scale > 1) { setScale(1); setOffset({ x: 0, y: 0 }) }
      else setScale(2.5)
    }
    lastTap.current = now
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/95 flex items-center justify-center touch-none"
      onClick={e => { if (e.target === e.currentTarget && scale === 1) onClose() }}>
      <button onClick={onClose} aria-label="Close"
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
        <X size={20} />
      </button>

      {scale > 1 && (
        <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}
          className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold">
          {Math.round(scale * 100)}%
        </button>
      )}

      <img
        src={src}
        alt=""
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={() => scale > 1 ? (setScale(1), setOffset({ x: 0, y: 0 })) : setScale(2.5)}
        draggable={false}
        className="max-w-full max-h-full object-contain select-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: pinchStart.current || panStart.current ? 'none' : 'transform 0.2s ease-out',
          cursor: scale > 1 ? 'grab' : 'zoom-in'
        }}
      />
    </div>
  )
}
