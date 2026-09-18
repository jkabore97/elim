// Lead-only transcription UI:
//  - TranscribeTool: the Read-tab tool where a lead uploads an audio/video file
//    and gets its transcript; the upload is deleted server-side once done.
import { useEffect, useRef, useState } from 'react'
import { ScrollText, X, Copy, Check, Loader2, Upload, RotateCcw } from 'lucide-react'
import { Portal } from './Portal'
import { useLanguage } from './i18n'
import type { AppUser } from './types'
import {
  subscribeJob, uploadForTranscription, startUploadTranscription, clearJob,
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
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null }
    if (jobRef.current) { clearJob(jobRef.current); jobRef.current = null }
    setPhase('idle'); setProgress(0); setText(''); setErrMsg('')
  }
  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current()
    if (failsafeRef.current) clearTimeout(failsafeRef.current)
  }, [])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErrMsg(''); setText(''); setPhase('uploading'); setProgress(0)
    try {
      const path = await uploadForTranscription(user.uid, file, setProgress)
      setPhase('processing')
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null }
        fn()
      }
      const { jobId, done } = await startUploadTranscription(user.uid, path)
      jobRef.current = jobId
      // The job doc is the source of truth: the function keeps transcribing on
      // the server (up to ~1h) and writes 'done'/'error' here, even if the
      // callable connection below has already timed out.
      unsubRef.current = subscribeJob(jobId, (j: TranscriptDoc | null) => {
        if (!j) return
        if (j.status === 'done') finish(() => { setText(j.text || ''); setPhase('done') })
        else if (j.status === 'error') finish(() => { setErrMsg(j.error || ''); setPhase('error') })
      })
      // The callable only KICKS OFF the work. A timeout (deadline-exceeded /
      // cancelled / unavailable) just means we stopped waiting on the call - the
      // server is still going and the subscription above will deliver the
      // result. Only an immediate, terminal error (auth / permission / bad
      // input) should fail the UI.
      done.catch((err: any) => {
        const code = String(err?.code || '')
        const transient = /deadline-exceeded|cancelled|unavailable|aborted|internal/.test(code)
          || /deadline|timeout/i.test(String(err?.message || ''))
        if (!transient) finish(() => { setErrMsg(err?.message || String(err)); setPhase('error') })
      })
      // Absolute safety net: if the server never reports back (e.g. it was
      // killed mid-run), stop the spinner after 30 min instead of forever.
      failsafeRef.current = setTimeout(
        () => finish(() => { setErrMsg(t('script.timeout')); setPhase('error') }),
        30 * 60 * 1000)
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
