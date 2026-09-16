// Lead-only transcription UI:
//  - PostScriptButton: a small "Script" button under an audio post that opens
//    the transcript large, with Copy-all. Transcribes on first open, caches.
//  - TranscribeTool: the Read-tab tool where a lead uploads an audio/video file
//    and gets its transcript; the upload is deleted server-side once done.
import { useEffect, useRef, useState } from 'react'
import { ScrollText, X, Copy, Check, Loader2, Upload, RotateCcw } from 'lucide-react'
import { Portal } from './Portal'
import { useLanguage } from './i18n'
import type { AppUser } from './types'
import {
  subscribeTranscript, requestPostTranscript, subscribeJob,
  uploadForTranscription, startUploadTranscription, clearJob,
  type TranscriptDoc,
} from './transcribe'

function CopyAllButton({ text }: { text: string }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
      }}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-affirm-600 text-white text-sm font-semibold">
      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('script.copied') : t('script.copyAll')}
    </button>
  )
}

// ---- Feed audio post: "Script" button + transcript modal --------------------
export function PostScriptButton({ postId }: { postId: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [tr, setTr] = useState<TranscriptDoc | null>(null)

  // Watch the cached transcript whenever the modal is open.
  useEffect(() => {
    if (!open) return
    const unsub = subscribeTranscript(postId, setTr)
    return unsub
  }, [open, postId])

  const openPanel = () => {
    setOpen(true)
    // Kick off transcription; if a done transcript already exists the function
    // returns it without re-spending. The subscription shows the result.
    requestPostTranscript(postId)
  }

  const status = tr?.status
  return (
    <>
      <button onClick={openPanel}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold">
        <ScrollText size={14} /> {t('script.button')}
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
            <div onClick={e => e.stopPropagation()}
              className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col shadow-2xl">
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold text-lg flex items-center gap-2"><ScrollText size={19} /> {t('script.title')}</h2>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
              </div>
              <div className="p-5 overflow-y-auto">
                {status === 'done' ? (
                  <>
                    <div className="mb-4"><CopyAllButton text={tr?.text || ''} /></div>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{tr?.text || t('script.empty')}</p>
                  </>
                ) : status === 'error' ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-red-500 mb-4">{t('script.error')}</p>
                    <button onClick={() => requestPostTranscript(postId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold"><RotateCcw size={15} /> {t('script.retry')}</button>
                  </div>
                ) : (
                  <div className="text-center py-10 text-slate-500">
                    <Loader2 size={28} className="animate-spin mx-auto mb-3 text-affirm-500" />
                    <p className="text-sm font-medium">{t('script.working')}</p>
                    <p className="text-xs text-slate-400 mt-1">{t('script.workingHint')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}

// ---- Read-tab tool: upload audio/video -> transcript ------------------------
export function TranscribeTool({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [text, setText] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const jobRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const reset = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (jobRef.current) { clearJob(jobRef.current); jobRef.current = null }
    setPhase('idle'); setProgress(0); setText(''); setErrMsg('')
  }
  useEffect(() => () => { if (unsubRef.current) unsubRef.current() }, [])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErrMsg(''); setText(''); setPhase('uploading'); setProgress(0)
    try {
      const path = await uploadForTranscription(user.uid, file, setProgress)
      setPhase('processing')
      const jobId = await startUploadTranscription(user.uid, path)
      jobRef.current = jobId
      unsubRef.current = subscribeJob(jobId, (j: TranscriptDoc | null) => {
        if (!j) return
        if (j.status === 'done') { setText(j.text || ''); setPhase('done') }
        else if (j.status === 'error') { setErrMsg(j.error || ''); setPhase('error') }
      })
    } catch (err: any) {
      setErrMsg(err?.message || String(err)); setPhase('error')
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-gradient-to-r from-violet-500 to-affirm-600 text-white rounded-2xl px-4 py-3.5 shadow-lg shadow-affirm-500/20 text-left">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><ScrollText size={20} /></div>
        <div className="min-w-0">
          <p className="font-bold text-[15px]">{t('script.toolTitle')}</p>
          <p className="text-xs text-white/80">{t('script.toolSubtitle')}</p>
        </div>
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={() => { setOpen(false); if (phase === 'done' || phase === 'error') reset() }}>
            <div onClick={e => e.stopPropagation()}
              className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col shadow-2xl">
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold text-lg flex items-center gap-2"><ScrollText size={19} /> {t('script.toolTitle')}</h2>
                <button onClick={() => { setOpen(false); if (phase === 'done' || phase === 'error') reset() }} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
              </div>
              <div className="p-5 overflow-y-auto">
                <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onFile} />

                {phase === 'idle' && (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500 mb-5">{t('script.toolIntro')}</p>
                    <button onClick={() => fileRef.current?.click()}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-affirm-600 text-white font-semibold"><Upload size={18} /> {t('script.chooseFile')}</button>
                  </div>
                )}
                {phase === 'uploading' && (
                  <div className="py-8 text-center text-slate-500">
                    <Loader2 size={26} className="animate-spin mx-auto mb-3 text-affirm-500" />
                    <p className="text-sm font-medium">{t('script.uploading')} {progress}%</p>
                  </div>
                )}
                {phase === 'processing' && (
                  <div className="py-8 text-center text-slate-500">
                    <Loader2 size={26} className="animate-spin mx-auto mb-3 text-affirm-500" />
                    <p className="text-sm font-medium">{t('script.working')}</p>
                    <p className="text-xs text-slate-400 mt-1">{t('script.workingHint')}</p>
                  </div>
                )}
                {phase === 'done' && (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      <CopyAllButton text={text} />
                      <button onClick={reset} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold"><RotateCcw size={15} /> {t('script.another')}</button>
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{text || t('script.empty')}</p>
                  </>
                )}
                {phase === 'error' && (
                  <div className="text-center py-8">
                    <p className="text-sm text-red-500 mb-4">{t('script.error')}{errMsg ? ` — ${errMsg}` : ''}</p>
                    <button onClick={reset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold"><RotateCcw size={15} /> {t('script.retry')}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
