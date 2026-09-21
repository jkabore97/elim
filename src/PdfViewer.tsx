import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  ArrowLeft, ZoomIn, ZoomOut, Download, Loader, FileText,
} from 'lucide-react'
import { useLanguage } from './i18n'
import { Portal } from './Portal'
import { useBackHandler } from './backButton'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// pdf.js parses in a web worker; point it at the copy in our own bundle (same as
// the Library reader) so it works offline and isn't broken by a blocked CDN.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Keep the card preview light on mobile data: fetch only what page 1 needs via
// range requests instead of pulling the whole PDF just to show a thumbnail.
const LIGHT_OPTS = { disableAutoFetch: true, disableStream: false }

// A first-page thumbnail for a document card in the feed. Renders only once the
// card scrolls near the viewport (so a feed with several PDFs doesn't download
// them all up front), and renders nothing if the file can't be previewed — the
// card then just shows its icon + filename.
export function PdfThumb({ url, className }: { url: string; className?: string }) {
  const [visible, setVisible] = useState(false)
  const [ok, setOk] = useState(true)
  const [w, setW] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { setVisible(true); io.disconnect() }
    }, { rootMargin: '250px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  if (!ok) return null
  return (
    <div ref={ref} className={className}>
      {visible && (
        <Document file={url} options={LIGHT_OPTS} onLoadError={() => setOk(false)}
          error={<></>}
          loading={<div className="h-44 flex items-center justify-center"><Loader size={20} className="text-slate-300 animate-spin" /></div>}>
          <Page pageNumber={1} width={w || 320}
            renderAnnotationLayer={false} renderTextLayer={false}
            onRenderError={() => setOk(false)}
            loading={<div className="h-44" />} />
        </Document>
      )}
    </div>
  )
}

// One page = one full-screen "slide". Each sits in a section at least the height
// of the viewport, centered, with scroll-snap so scrolling moves exactly one
// page at a time (the current page leaves, the next fills the screen). The page
// is rendered only once its slot nears the viewport (lazy).
function LazyPage({ pageNumber, width, height, root }: { pageNumber: number; width: number; height: number; root: HTMLElement | null }) {
  const [show, setShow] = useState(pageNumber === 1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || show) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { setShow(true); io.disconnect() }
    }, { root: root || null, rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root, show])
  return (
    <div ref={ref} data-page={pageNumber}
      className="flex items-center justify-center"
      style={{ minHeight: height, scrollSnapAlign: 'center' }}>
      {show && (
        <Page pageNumber={pageNumber} width={width}
          renderAnnotationLayer={false} renderTextLayer={false}
          loading={<div style={{ height: Math.min(height, Math.round(width * 1.3)), width }} />} />
      )}
    </div>
  )
}

// A full-screen, in-app PDF viewer (Portal). Pages are stacked and you scroll
// down to move from page to page; the header shows the current page. A back
// button (and the hardware/browser back button, via useBackHandler) returns to
// the previous page. Zoom re-flows the page width. Locks the page behind it so
// the feed doesn't scroll underneath.
export function PdfViewer({ url, title, onClose }: { url: string; title?: string; onClose: () => void }) {
  const { t } = useLanguage()
  const [numPages, setNumPages] = useState(0)
  const [current, setCurrent] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(0)
  const [holderH, setHolderH] = useState(0)
  // Page aspect ratio (w/h), read from the first page, so each page can be fit
  // to the screen (one page per view) instead of just fit to width.
  const [aspect, setAspect] = useState(0)
  const holderRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useBackHandler(true, onClose)

  // Pinch-to-zoom with two fingers, anchored on the point BETWEEN the fingers so
  // you can zoom into any part of the page (a corner, a figure), not just the
  // centre. During the gesture a CSS transform gives smooth feedback around that
  // focal point; on release the scale is committed (pages re-render crisply) and
  // the scroll is adjusted so the same point stays under your fingers — then you
  // can pan freely to any edge. A native non-passive listener lets the two-finger
  // move preventDefault (so the browser doesn't zoom the whole app); one-finger
  // scrolling is untouched.
  const MIN = 1, MAX = 6
  const pinch = useRef<{ startDist: number; base: number; live: number; sx: number; sy: number; fx: number; fy: number } | null>(null)
  const pendingFocal = useRef<{ base: number; live: number; sx: number; sy: number; fx: number; fy: number } | null>(null)
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      const hr = holder.getBoundingClientRect()
      const fx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - hr.left
      const fy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - hr.top
      pinch.current = { startDist: dist(e.touches), base: scale, live: scale, sx: holder.scrollLeft, sy: holder.scrollTop, fx, fy }
    }
    const onMove = (e: TouchEvent) => {
      const p = pinch.current
      if (!p || e.touches.length !== 2) return
      if (e.cancelable) e.preventDefault()
      const live = Math.min(MAX, Math.max(MIN, p.base * (dist(e.touches) / p.startDist)))
      p.live = live
      if (innerRef.current) {
        // Origin at the focal point, expressed in the inner's own coordinates
        // (its content is currently scaled at `base`, and it sits at scroll sx/sy).
        const r = innerRef.current.getBoundingClientRect()
        const hr = holder.getBoundingClientRect()
        innerRef.current.style.transformOrigin = `${(p.fx + hr.left) - r.left}px ${(p.fy + hr.top) - r.top}px`
        innerRef.current.style.transform = `scale(${live / p.base})`
      }
    }
    const onEnd = (e: TouchEvent) => {
      const p = pinch.current
      if (!p || e.touches.length >= 2) return
      pinch.current = null
      if (innerRef.current) { innerRef.current.style.transform = ''; innerRef.current.style.transformOrigin = '' }
      pendingFocal.current = { base: p.base, live: p.live, sx: p.sx, sy: p.sy, fx: p.fx, fy: p.fy }
      setScale(Math.round(p.live * 100) / 100)
    }
    holder.addEventListener('touchstart', onStart, { passive: true })
    holder.addEventListener('touchmove', onMove, { passive: false })
    holder.addEventListener('touchend', onEnd, { passive: true })
    holder.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      holder.removeEventListener('touchstart', onStart)
      holder.removeEventListener('touchmove', onMove)
      holder.removeEventListener('touchend', onEnd)
      holder.removeEventListener('touchcancel', onEnd)
    }
  }, [scale])

  // After a pinch commits a new scale, move the scroll so the focal point stays
  // under the fingers (keeps the zoom precise). The whole scrollable content
  // grows by ratio, so the content point (start scroll + focal offset) scales
  // and we subtract the focal offset back out.
  useLayoutEffect(() => {
    const pf = pendingFocal.current
    const holder = holderRef.current
    if (!pf || !holder) return
    pendingFocal.current = null
    const ratio = pf.live / pf.base
    holder.scrollLeft = (pf.sx + pf.fx) * ratio - pf.fx
    holder.scrollTop = (pf.sy + pf.fy) * ratio - pf.fy
  }, [scale])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const ph = html.style.overflow
    const pb = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => { html.style.overflow = ph; body.style.overflow = pb }
  }, [])

  useEffect(() => {
    const measure = () => {
      setWidth(holderRef.current?.clientWidth || 0)
      setHolderH(holderRef.current?.clientHeight || 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Update the "Page X / Y" indicator: the current page is the one whose section
  // covers the middle of the viewport.
  const onScroll = () => {
    const holder = holderRef.current
    if (!holder) return
    const mid = holder.getBoundingClientRect().top + holder.clientHeight / 2
    let cur = 1
    holder.querySelectorAll<HTMLElement>('[data-page]').forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.top <= mid) cur = Number(el.dataset.page) || cur
    })
    setCurrent(cur)
  }

  // Fit each page to the SCREEN (width and height) so one whole page shows at a
  // time; zoom then scales up from that fit. The section height is the viewport
  // so pages snap one per screen.
  const availW = width ? width - 32 : 320
  const availH = holderH ? holderH - 24 : 480
  const fitW = aspect ? Math.min(availW, availH * aspect) : availW
  const pageWidth = Math.max(120, fitW * scale)
  // Each section is the full viewport height, so exactly one page snaps into
  // view at a time; the fit page (slightly smaller) is centered within it.
  const sectionH = holderH || availH

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-[#0f172a] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
          <button onClick={onClose} aria-label={t('quiz.back')}
            className="p-1.5 -ml-1.5 rounded-full hover:bg-white/5 text-slate-300">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-white truncate text-sm">{title || t('post.document.fallback')}</h2>
            <p className="text-[11px] text-slate-400 truncate">
              {numPages ? `${t('lib.page')} ${current} / ${numPages}` : t('app.loading')}
            </p>
          </div>
          <button onClick={() => setScale(s => Math.max(MIN, Math.round((s - 0.25) * 100) / 100))} aria-label={t('lib.zoomOut')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomOut size={17} /></button>
          <button onClick={() => setScale(s => Math.min(MAX, Math.round((s + 0.25) * 100) / 100))} aria-label={t('lib.zoomIn')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomIn size={17} /></button>
          <a href={url} target="_blank" rel="noreferrer" aria-label={t('post.download')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><Download size={17} /></a>
        </div>

        <div ref={holderRef} onScroll={onScroll}
          className="flex-1 overflow-auto overscroll-contain bg-slate-800 px-4"
          // One page per screen: snap while at fit (scale 1); when zoomed in,
          // turn snapping off so you can freely pan around the enlarged page.
          style={{ scrollSnapType: scale <= 1 ? 'y mandatory' : 'none' }}>
          {error ? (
            <div className="text-center px-8 pt-16">
              <FileText size={30} className="text-slate-500 mx-auto mb-3" />
              <p className="text-sm text-red-400">{t('lib.readFailed')}</p>
              <p className="text-xs text-slate-400 mt-2 break-words">{error}</p>
              <a href={url} target="_blank" rel="noreferrer"
                className="inline-block mt-4 px-4 py-2.5 rounded-xl bg-affirm-600 text-white text-sm font-semibold">
                {t('lib.openExternally')}
              </a>
            </div>
          ) : (
            <div ref={innerRef}>
              <Document
                file={url}
                onLoadSuccess={async (pdf) => {
                  setNumPages(pdf.numPages); setError('')
                  try {
                    const p = await pdf.getPage(1)
                    const vp = p.getViewport({ scale: 1 })
                    if (vp.width && vp.height) setAspect(vp.width / vp.height)
                  } catch { /* keep width-only fit */ }
                }}
                onLoadError={e => setError(e?.message || String(e))}
                loading={
                  <div className="flex flex-col items-center pt-20 gap-3">
                    <Loader size={26} className="text-affirm-400 animate-spin" />
                    <p className="text-xs text-slate-400">{t('app.loading')}</p>
                  </div>
                }>
                {Array.from({ length: numPages }, (_, i) => (
                  <LazyPage key={i + 1} pageNumber={i + 1} width={pageWidth} height={sectionH} root={holderRef.current} />
                ))}
              </Document>
            </div>
          )}
        </div>
      </div>
    </Portal>
  )
}
