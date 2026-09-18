// Lead-only transcription UI:
//  - TranscribeTool: the Read-tab tool where a lead uploads an audio/video file
//    and gets its transcript; the upload is deleted server-side once done.
import { useEffect, useRef, useState } from 'react'
import { ScrollText, X, Copy, Check, Loader2, Upload, RotateCcw } from 'lucide-react'
import { Portal } from './Portal'
import { useLanguage } from './i18n'
import type { AppUser } from './types'
import {
  subscribeJob, subscribeMyJobs, uploadForTranscription, startUploadTranscription, clearJob,
  type TranscriptDoc, type TranscriptJob,
} from './transcribe'

const timeAgo = (ts: any): string => {
  try {
    const ms = ts?.toMillis ? ts.toMillis() : 0
    if (!ms) return ''
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}j`
  } catch { return '' }
}

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
  const [recent, setRecent] = useState<TranscriptJob[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const jobRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Back to the picker WITHOUT deleting the job - finished transcripts stay in
  // the recent list so they can always be retrieved (the whole point here).
  const reset = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null }
    jobRef.current = null
    setPhase('idle'); setProgress(0); setText(''); setErrMsg('')
  }
  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current()
    if (failsafeRef.current) clearTimeout(failsafeRef.current)
  }, [])

  // Load this lead's recent jobs while the tool is open.
  useEffect(() => {
    if (!open) return
    return subscribeMyJobs(user.uid, setRecent)
  }, [open, user.uid])

  // Keep watching a job doc until it lands on done/error (used for a fresh
  // upload and for resuming a job that's still processing).
  const watchJob = (jobId: string) => {
    if (unsubRef.current) unsubRef.current()
    if (failsafeRef.current) clearTimeout(failsafeRef.current)
    jobRef.current = jobId
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null }
      fn()
    }
    unsubRef.current = subscribeJob(jobId, (j: TranscriptDoc | null) => {
      if (!j) return
      if (j.status === 'done') finish(() => { setText(j.text || ''); setPhase('done') })
      else if (j.status === 'error') finish(() => { setErrMsg(j.error || ''); setPhase('error') })
    })
    failsafeRef.current = setTimeout(
      () => finish(() => { setErrMsg(t('script.timeout')); setPhase('error') }),
      30 * 60 * 1000)
    return finish
  }

  // Open a job from the recent list.
  const openRecent = (job: TranscriptJob) => {
    setErrMsg(''); setText('')
    if (job.status === 'done') { jobRef.current = job.id; setText(job.text || ''); setPhase('done') }
    else if (job.status === 'error') { jobRef.current = job.id; setErrMsg(job.error || ''); setPhase('error') }
    else { setPhase('processing'); watchJob(job.id) }
  }

  const deleteRecent = (id: string) => { clearJob(id); if (jobRef.current === id) reset() }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErrMsg(''); setText(''); setPhase('uploading'); setProgress(0)
    try {
      const path = await uploadForTranscription(user.uid, file, setProgress)
      setPhase('processing')
      const { jobId, done } = await startUploadTranscription(user.uid, path, file.name)
      // The job doc is the source of truth: the function keeps transcribing on
      // the server (up to ~1h) and writes 'done'/'error' there, even if the
      // callable connection below has already timed out.
      const finish = watchJob(jobId)
      // The callable only KICKS OFF the work. A timeout (deadline-exceeded /
      // cancelled / unavailable) just means we stopped waiting on the call - the
      // server is still going and the subscription will deliver the result.
      // Only an immediate, terminal error (auth / permission / bad input) fails
      // the UI.
      done.catch((err: any) => {
        const code = String(err?.code || '')
        const transient = /deadline-exceeded|cancelled|unavailable|aborted|internal/.test(code)
          || /deadline|timeout/i.test(String(err?.message || ''))
        if (!transient) finish(() => { setErrMsg(err?.message || String(err)); setPhase('error') })
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
                  <div className="py-4">
                    <div className="text-center">
                      <p className="text-sm text-slate-500 mb-5">{t('script.toolIntro')}</p>
                      <button onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-affirm-600 text-white font-semibold"><Upload size={18} /> {t('script.chooseFile')}</button>
                    </div>

                    {recent.length > 0 && (
                      <div className="mt-8">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{t('script.recent')}</p>
                        <div className="space-y-2">
                          {recent.map(job => (
                            <div key={job.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-3 py-2.5">
                              <button onClick={() => openRecent(job)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                  job.status === 'done' ? 'bg-emerald-100 text-emerald-600'
                                  : job.status === 'error' ? 'bg-red-100 text-red-600'
                                  : 'bg-amber-100 text-amber-600'}`}>
                                  {job.status === 'done' ? <ScrollText size={15} />
                                    : job.status === 'error' ? <X size={15} />
                                    : <Loader2 size={15} className="animate-spin" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-slate-800 truncate">{job.fileName || t('script.untitled')}</p>
                                  <p className="text-[11px] text-slate-400">
                                    {job.status === 'done' ? t('script.ready') : job.status === 'error' ? t('script.failedShort') : t('script.inProgress')}
                                    {timeAgo(job.createdAt) ? ` · ${timeAgo(job.createdAt)}` : ''}
                                  </p>
                                </div>
                              </button>
                              <button onClick={() => deleteRecent(job.id)} aria-label={t('script.delete')}
                                className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"><X size={16} /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
