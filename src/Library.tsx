import { useState, useEffect, useMemo, useRef } from 'react'
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  BookOpen, Plus, X, Search, Trash2, Download, ArrowLeft,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Upload, Loader
} from 'lucide-react'
import { db, storage } from './firebase'
import { useLanguage } from './i18n'
import { logActivity } from './activityLog'
import type { AppUser, Book } from './types'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// pdf.js does its parsing in a web worker. Pointing at the copy inside our own
// bundle rather than a CDN means the reader still works offline and doesn't
// break if a CDN changes or is blocked - which matters on the connections this
// congregation actually has.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// Bible first, deliberately - it is the reason most people will open this tab,
// so it should never be something they have to scroll to find.
export const BOOK_CATEGORIES = [
  'Bible',
  'Étude biblique',
  'Prière & intercession',
  'Enseignement',
  'Vie chrétienne',
  'Famille & mariage',
  'Jeunesse',
  'Louange & adoration',
  'Témoignages',
  'Documents de l\'église',
  'Autre'
]

function humanSize(bytes?: number) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

// ==================== READER ====================

function PdfReader({ book, onClose }: { book: Book; onClose: () => void }) {
  const { t } = useLanguage()
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(0)
  const holderRef = useRef<HTMLDivElement>(null)

  // Render at the container's width rather than a fixed size, so a page fills
  // a phone screen without horizontal scrolling.
  useEffect(() => {
    const measure = () => setWidth(holderRef.current?.clientWidth || 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Remember where someone stopped reading. A 400-page Bible that reopens at
  // page 1 every time is unusable.
  const progressKey = `elim-book-progress-${book.id}`
  useEffect(() => {
    try {
      const saved = localStorage.getItem(progressKey)
      if (saved) setPage(Math.max(1, parseInt(saved, 10) || 1))
    } catch { /* ignore */ }
  }, [progressKey])

  useEffect(() => {
    try { localStorage.setItem(progressKey, String(page)) } catch { /* ignore */ }
  }, [page, progressKey])

  const go = (delta: number) => {
    setPage(p => Math.min(Math.max(1, p + delta), numPages || 1))
    holderRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="fixed inset-0 z-[70] bg-[#0f172a] flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full hover:bg-white/5 text-slate-300">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-white truncate text-sm">{book.title}</h2>
          <p className="text-[11px] text-slate-400 truncate">
            {numPages ? `${t('lib.page')} ${page} / ${numPages}` : t('app.loading')}
          </p>
        </div>
        <button onClick={() => setScale(s => Math.max(0.6, s - 0.2))}
          aria-label={t('lib.zoomOut')}
          className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomOut size={17} /></button>
        <button onClick={() => setScale(s => Math.min(3, s + 0.2))}
          aria-label={t('lib.zoomIn')}
          className="p-2 rounded-full hover:bg-white/5 text-slate-300"><ZoomIn size={17} /></button>
        <a href={book.fileUrl} target="_blank" rel="noreferrer"
          aria-label={t('post.download')}
          className="p-2 rounded-full hover:bg-white/5 text-slate-300"><Download size={17} /></a>
      </div>

      <div ref={holderRef} className="flex-1 overflow-auto bg-slate-800 flex justify-center py-4">
        {error ? (
          <div className="text-center px-8 pt-16">
            <p className="text-sm text-red-400">{t('lib.readFailed')}</p>
            <p className="text-xs text-slate-400 mt-2 break-words">{error}</p>
            {/^Failed to fetch/i.test(error) && (
              <p className="text-[11px] text-amber-400 mt-3 leading-relaxed">{t('lib.corsHint')}</p>
            )}
            <a href={book.fileUrl} target="_blank" rel="noreferrer"
              className="inline-block mt-4 px-4 py-2.5 rounded-xl bg-affirm-600 text-white text-sm font-semibold">
              {t('lib.openExternally')}
            </a>
          </div>
        ) : (
          <Document
            file={book.fileUrl}
            onLoadSuccess={({ numPages }) => { setNumPages(numPages); setError('') }}
            onLoadError={e => setError(e?.message || String(e))}
            loading={
              <div className="flex flex-col items-center pt-20 gap-3">
                <Loader size={26} className="text-affirm-400 animate-spin" />
                <p className="text-xs text-slate-400">{t('lib.loadingBook')}</p>
              </div>
            }
          >
            <Page
              pageNumber={page}
              width={width ? Math.min(width - 16, 900) * scale : undefined}
              renderAnnotationLayer={false}
              loading={<div className="h-96" />}
            />
          </Document>
        )}
      </div>

      {numPages > 0 && !error && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-white/10 shrink-0">
          <button onClick={() => go(-1)} disabled={page <= 1}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-200 flex items-center justify-center">
            <ChevronLeft size={18} />
          </button>

          {/* Dragging the slider is the only sane way to move through a book
              with hundreds of pages. */}
          <input type="range" min={1} max={numPages} value={page}
            onChange={e => setPage(Number(e.target.value))}
            className="flex-1 h-1 accent-affirm-400 bg-white/10" />

          <button onClick={() => go(1)} disabled={page >= numPages}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-200 flex items-center justify-center">
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

// ==================== UPLOAD ====================

function UploadBook({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState(BOOK_CATEGORIES[0])
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('lib.notPdf')); return
    }
    if (f.size > 100 * 1024 * 1024) { setError(t('lib.tooLarge')); return }
    setError('')
    setFile(f)
    // Filename is usually a reasonable title, so offer it rather than making
    // someone retype it - still editable.
    if (!title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  const submit = async () => {
    if (!file || !title.trim() || busy) return
    setBusy(true); setError('')
    try {
      const sref = ref(storage, `books/${user.uid}/${Date.now()}-${file.name}`)
      const task = uploadBytesResumable(sref, file)
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed',
          s => setProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
          reject,
          () => resolve()
        )
      })
      const url = await getDownloadURL(sref)
      await addDoc(collection(db, 'books'), {
        title: title.trim(),
        author: author.trim(),
        category,
        fileUrl: url,
        fileName: file.name,
        sizeBytes: file.size,
        uploadedById: user.uid,
        uploadedByName: user.displayName,
        createdAt: serverTimestamp()
      })
      logActivity(user, 'post_created', `Bibliothèque: ${title.trim().slice(0, 60)}`)
      onClose()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="glass-bar w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-lg text-slate-900">{t('lib.addBook')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3">
          <label className={`flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed cursor-pointer transition ${
            file ? 'border-affirm-300 bg-affirm-50' : 'border-slate-200 hover:border-affirm-300'}`}>
            <Upload size={22} className={file ? 'text-affirm-500' : 'text-slate-400'} />
            <span className="text-xs font-medium text-slate-600 px-4 text-center break-all">
              {file ? file.name : t('lib.choosePdf')}
            </span>
            {file && <span className="text-[11px] text-affirm-600">{humanSize(file.size)}</span>}
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={pick} disabled={busy} />
          </label>

          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('lib.bookTitle')}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-affirm-400" />

          <input value={author} onChange={e => setAuthor(e.target.value)} placeholder={t('lib.bookAuthor')}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-affirm-400" />

          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
            {BOOK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {busy && (
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-affirm-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 break-words">{error}</p>}

          <button onClick={submit} disabled={!file || !title.trim() || busy}
            className="w-full py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 disabled:opacity-40 text-white font-semibold text-sm transition">
            {busy ? `${t('lib.uploading')} ${progress}%` : t('lib.publishBook')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== TAB ====================

export function LibraryTab({ user, canUpload }: { user: AppUser; canUpload: boolean }) {
  const { t } = useLanguage()
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [reading, setReading] = useState<Book | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'books'), orderBy('createdAt', 'desc'), limit(300)),
      snap => { setBooks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Book))); setError(''); setLoading(false) },
      err => { setError(err?.message || String(err)); setLoading(false) }
    )
    return () => unsub()
  }, [])

  const visible = useMemo(() => {
    let rows = category === 'all' ? books : books.filter(b => b.category === category)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(b =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q)
      )
    }
    // Bible entries float to the top within whatever is being shown. Copy the
    // array first - sorting in place would mutate the books state.
    return [...rows].sort((a, b) => {
      const aB = a.category === 'Bible' ? 0 : 1
      const bB = b.category === 'Bible' ? 0 : 1
      return aB - bB
    })
  }, [books, search, category])

  const remove = async (b: Book) => {
    try {
      await deleteDoc(doc(db, 'books', b.id))
      // Also remove the uploaded PDF so it doesn't linger in Storage forever
      // (files can be up to 100 MB). Best-effort - a missing/renamed object
      // shouldn't turn a successful delete into an error.
      if (b.fileUrl) {
        try { await deleteObject(ref(storage, b.fileUrl)) } catch { /* already gone */ }
      }
      setConfirmRemoveId(null)
    }
    catch (err: any) { setError(err?.message || String(err)) }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('lib.search')}
            className="w-full pl-11 pr-4 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
        </div>
        {canUpload && (
          <button onClick={() => setUploading(true)}
            className="w-12 h-12 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white flex items-center justify-center shrink-0 shadow-lg shadow-affirm-500/20">
            <Plus size={20} />
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', ...BOOK_CATEGORIES].map(cat => (
          <button key={cat} onClick={() => setCategory(cat)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
              category === cat
                ? 'bg-affirm-500 text-white border border-affirm-400/60'
                : 'glass-soft text-slate-600'}`}>
            {cat === 'all' ? t('lib.allBooks') : cat}
          </button>
        ))}
      </div>

      {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <p className="text-xs text-red-600 break-words">{error}</p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-12 px-6 my-6 scrim">
          <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
            <BookOpen size={28} className="text-affirm-400" />
          </div>
          <p className="text-slate-800 font-medium">{t('lib.empty')}</p>
          <p className="text-sm text-slate-400 mt-1">{t('lib.emptyHint')}</p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(b => (
          <div key={b.id} className="glass rounded-3xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
            <button onClick={() => setReading(b)}
              className={`w-14 h-16 rounded-xl flex items-center justify-center shrink-0 ${
                b.category === 'Bible'
                  ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white'
                  : 'bg-gradient-to-br from-affirm-400 to-teal-500 text-white'}`}>
              <BookOpen size={22} />
            </button>

            <button onClick={() => setReading(b)} className="min-w-0 flex-1 text-left">
              <h3 className="font-bold text-slate-900 leading-snug line-clamp-2">{b.title}</h3>
              {b.author && <p className="text-xs text-slate-500 mt-0.5 truncate">{b.author}</p>}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  b.category === 'Bible' ? 'bg-amber-50 text-amber-700' : 'bg-affirm-50 text-affirm-700'}`}>
                  {b.category}
                </span>
                <span className="text-[10px] text-slate-400">{humanSize(b.sizeBytes)}</span>
              </div>
            </button>

            <div className="flex flex-col gap-1 shrink-0">
              <a href={b.fileUrl} target="_blank" rel="noreferrer"
                aria-label={t('post.download')}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-affirm-600">
                <Download size={16} />
              </a>
              {(b.uploadedById === user.uid || user.role === 'admin' || user.role === 'pastor') && (
                confirmRemoveId === b.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => remove(b)}
                      className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-full">
                      {t('post.delete')}
                    </button>
                    <button onClick={() => setConfirmRemoveId(null)}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 px-1">
                      {t('post.cancel')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRemoveId(b.id)} aria-label={t('post.delete')}
                    className="p-2 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {reading && <PdfReader book={reading} onClose={() => setReading(null)} />}
      {uploading && <UploadBook user={user} onClose={() => setUploading(false)} />}
    </div>
  )
}
