import { useState, useEffect, useRef } from 'react'
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

// One page in the continuous scroll. Renders the actual PDF page only once its
// slot nears the viewport (lazy), so a long document scrolls smoothly instead of
// rendering every page up front. Before it renders, it reserves an approximate
// height (A4 ratio) so the scrollbar and page positions don't jump.
function LazyPage({ pageNumber, width, root }: { pageNumber: number; width: number; root: HTMLElement | null }) {
  const [show, setShow] = useState(pageNumber === 1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || show) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { setShow(true); io.disconnect() }
    }, { root: root || null, rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root, show])
  const approxH = Math.round(width * 1.414)
  return (
    <div ref={ref} data-page={pageNumber} className="mb-3 flex justify-center"
      style={!show ? { minHeight: approxH } : undefined}>
      {show && (
        <Page pageNumber={pageNumber} width={width}
          renderAnnotationLayer={false} renderTextLayer={false}
          loading={<div style={{ height: approxH, width }} />} />
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
  const holderRef = useRef<HTMLDivElement>(null)

  useBackHandler(true, onClose)

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
    const measure = () => setWidth(holderRef.current?.clientWidth || 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Update the "Page X / Y" indicator from the scroll position: the current page
  // is the last one whose top has scrolled above ~40% of the viewport height.
  const onScroll = () => {
    const holder = holderRef.current
    if (!holder) return
    const top = holder.getBoundingClientRect().top
    const mark = holder.clientHeight * 0.4
    let cur = 1
    holder.querySelectorAll<HTMLElement>('[data-page]').forEach(el => {
      if (el.getBoundingClientRect().top - top <= mark) cur = Number(el.dataset.page) || cur
    })
    setCurrent(cur)
  }

  const pageWidth = width ? Math.min(width - 16, 900) * scale : 320

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
          <button onClick={() => setScale(s => Math.max(0.6, s - 0.2))} aria-label={t('lib.zoomOut')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomOut size={17} /></button>
          <button onClick={() => setScale(s => Math.min(3, s + 0.2))} aria-label={t('lib.zoomIn')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomIn size={17} /></button>
          <a href={url} target="_blank" rel="noreferrer" aria-label={t('post.download')}
            className="p-2 rounded-full hover:bg-white/5 text-slate-300"><Download size={17} /></a>
        </div>

        <div ref={holderRef} onScroll={onScroll}
          className="flex-1 overflow-auto overscroll-contain bg-slate-800 py-4">
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
            <Document
              file={url}
              onLoadSuccess={({ numPages }) => { setNumPages(numPages); setError('') }}
              onLoadError={e => setError(e?.message || String(e))}
              loading={
                <div className="flex flex-col items-center pt-20 gap-3">
                  <Loader size={26} className="text-affirm-400 animate-spin" />
                  <p className="text-xs text-slate-400">{t('app.loading')}</p>
                </div>
              }>
              {Array.from({ length: numPages }, (_, i) => (
                <LazyPage key={i + 1} pageNumber={i + 1} width={pageWidth} root={holderRef.current} />
              ))}
            </Document>
          )}
        </div>
      </div>
    </Portal>
  )
}
