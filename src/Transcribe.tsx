// Lead-only transcription UI:
//  - TranscribeTool: the Read-tab tool where a lead uploads an audio/video file
//    and gets its transcript; the upload is deleted server-side once done.
//  - ScriptsFolder: the shared library of every transcription job (past and
//    live), visible only to leads with transcription access + admins.
import { useEffect, useRef, useState } from 'react'
import { ScrollText, X, Copy, Check, Loader2, Upload, RotateCcw, Download, FolderOpen, Trash2, ChevronLeft } from 'lucide-react'
import { Portal } from './Portal'
import { useLanguage } from './i18n'
import type { AppUser } from './types'
import {
  subscribeJob, subscribeAllJobs, uploadForTranscription, startUploadTranscription, clearJob,
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
  const [procPct, setProcPct] = useState(0)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const jobRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (failsafeRef.current) { clearTimeout(failsafeRef.current); failsafeRef.current = null }
    jobRef.current = null
    setPhase('idle'); setProgress(0); setProcPct(0); setFileUrl(null); setText(''); setErrMsg('')
  }
  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current()
    if (failsafeRef.current) clearTimeout(failsafeRef.current)
  }, [])

  // Watch a job doc until done/error. The 30-min safety net is RE-ARMED on each
  // progress tick, so a long sermon that's actively advancing never trips a
  // false timeout.
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
    const arm = () => {
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
      failsafeRef.current = setTimeout(() => finish(() => { setErrMsg(t('script.timeout')); setPhase('error') }), 30 * 60 * 1000)
    }
    unsubRef.current = subscribeJob(jobId, (j: TranscriptDoc | null) => {
      if (!j) return
      if (typeof j.progress === 'number') { setProcPct(j.progress); if (!settled) arm() }
      if (j.status === 'done') finish(() => { setText(j.text || ''); setFileUrl(j.fileUrl || null); setPhase('done') })
      else if (j.status === 'error') finish(() => { setErrMsg(j.error || ''); setPhase('error') })
    })
    arm()
    return finish
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErrMsg(''); setText(''); setFileUrl(null); setProcPct(0); setPhase('uploading'); setProgress(0)
    try {
      const path = await uploadForTranscription(user.uid, file, setProgress)
      setPhase('processing')
      const { jobId, done } = await startUploadTranscription(user.uid, path, file.name, user.displayName)
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
                    <p className="text-sm font-medium">{t('script.working')}{procPct > 0 ? ` — ${procPct}%` : ''}</p>
                    {/* Real progress bar, driven by the server's per-chunk updates. */}
                    <div className="mt-3 mx-auto max-w-xs h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-affirm-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(4, procPct)}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-3">{t('script.workingHint')}</p>
                    <p className="text-xs text-slate-400 mt-1">{t('script.backgroundHint')}</p>
                  </div>
                )}
                {phase === 'done' && (
                  <>
                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                      <CopyAllButton text={text} />
                      {fileUrl && (
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"><Download size={15} /> {t('script.download')}</a>
                      )}
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

// ---- Shared Scripts library -------------------------------------------------
// One folder holding every transcription job — finished, running, or failed —
// so a script is never lost after the tool is closed and the whole team shares
// the same archive. Rules restrict reads to leads with transcription access
// (plus admins/pastors); deletes to the job's owner or an admin/pastor.
export function ScriptsFolder({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<TranscriptJob[]>([])
  const [loaded, setLoaded] = useState(false)
  const [viewing, setViewing] = useState<TranscriptJob | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const isAdmin = user.role === 'admin' || user.role === 'pastor'

  useEffect(() => {
    if (!open) return
    setLoaded(false)
    const unsub = subscribeAllJobs(js => { setJobs(js); setLoaded(true) })
    return unsub
  }, [open])

  // Keep the open viewer in sync with live updates (e.g. a job that finishes
  // while its script is on screen).
  useEffect(() => {
    if (!viewing) return
    const fresh = jobs.find(j => j.id === viewing.id)
    if (fresh) setViewing(fresh)
    else setViewing(null) // deleted elsewhere
  }, [jobs]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); setViewing(null); setConfirmId(null) }
  const remove = async (id: string) => {
    setConfirmId(null)
    if (viewing?.id === id) setViewing(null)
    await clearJob(id)
  }
  const canDelete = (j: TranscriptJob) => isAdmin || j.ownerUid === user.uid

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 border border-slate-100 shadow-sm text-left">
        <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><FolderOpen size={20} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] text-slate-800">{t('script.folderTitle')}</p>
          <p className="text-xs text-slate-400">{t('script.folderSubtitle')}</p>
        </div>
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={close}>
            <div onClick={e => e.stopPropagation()}
              className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col shadow-2xl">
              <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold text-lg flex items-center gap-2 min-w-0">
                  {viewing && (
                    <button onClick={() => setViewing(null)} className="p-1 -ml-1 rounded-full hover:bg-slate-100 shrink-0"><ChevronLeft size={20} /></button>
                  )}
                  <FolderOpen size={19} className="shrink-0" />
                  <span className="truncate">{viewing ? (viewing.fileName || t('script.untitled')) : t('script.folderTitle')}</span>
                </h2>
                <button onClick={close} className="p-1.5 rounded-full hover:bg-slate-100 shrink-0"><X size={20} /></button>
              </div>
              <div className="p-5 overflow-y-auto">
                {viewing ? (
                  <ScriptViewer job={viewing} />
                ) : !loaded ? (
                  <div className="py-12 text-center text-slate-400"><Loader2 size={26} className="animate-spin mx-auto" /></div>
                ) : jobs.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">{t('script.folderEmpty')}</p>
                ) : (
                  <div className="space-y-2">
                    {jobs.map(job => (
                      <div key={job.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-3 py-2.5">
                        <button onClick={() => setViewing(job)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            job.status === 'done' ? 'bg-emerald-100 text-emerald-600'
                            : job.status === 'error' ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-600'}`}>
                            {job.status === 'done' ? <ScrollText size={16} />
                              : job.status === 'error' ? <X size={16} />
                              : <Loader2 size={16} className="animate-spin" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800 truncate">{job.fileName || t('script.untitled')}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {job.status === 'done' ? t('script.ready')
                                : job.status === 'error' ? t('script.failedShort')
                                : `${t('script.inProgress')}${typeof job.progress === 'number' && job.progress > 0 ? ` · ${job.progress}%` : ''}`}
                              {job.ownerName ? ` · ${job.ownerName}` : ''}
                              {timeAgo(job.createdAt) ? ` · ${timeAgo(job.createdAt)}` : ''}
                            </p>
                          </div>
                        </button>
                        {canDelete(job) && (
                          confirmId === job.id ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => remove(job.id)} className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold">{t('script.confirmDelete')}</button>
                              <button onClick={() => setConfirmId(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-semibold">{t('script.cancelDelete')}</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmId(job.id)} aria-label={t('script.delete')}
                              className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={16} /></button>
                          )
                        )}
                      </div>
                    ))}
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

// A single script inside the shared folder: its text with copy + download when
// ready, a live progress bar while it runs, or the failure reason.
function ScriptViewer({ job }: { job: TranscriptJob }) {
  const { t } = useLanguage()
  if (job.status === 'error') {
    return <p className="text-sm text-red-500 py-6 text-center">{t('script.error')}{job.error ? ` — ${job.error}` : ''}</p>
  }
  if (job.status !== 'done') {
    const pct = typeof job.progress === 'number' ? job.progress : 0
    return (
      <div className="py-8 text-center text-slate-500">
        <Loader2 size={26} className="animate-spin mx-auto mb-3 text-affirm-500" />
        <p className="text-sm font-medium">{t('script.working')}{pct > 0 ? ` — ${pct}%` : ''}</p>
        <div className="mt-3 mx-auto max-w-xs h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-affirm-500 rounded-full transition-all duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="text-xs text-slate-400 mt-3">{t('script.backgroundHint')}</p>
      </div>
    )
  }
  return (
    <>
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <CopyAllButton text={job.text || ''} />
        {job.fileUrl && (
          <a href={job.fileUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"><Download size={15} /> {t('script.download')}</a>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{job.text || t('script.empty')}</p>
    </>
  )
}
