import { useState } from 'react'
import { Flag, X, Check, ShieldAlert } from 'lucide-react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { useLanguage } from './i18n'
import { Portal } from './Portal'
import type { AppUser, ReportReason, ReportTargetType } from './types'

// In-app reporting for harmful content.
//
// Google Play's child safety standards policy requires social apps to let
// people report child safety concerns from inside the app. This is that
// mechanism, and it is what the published standards page describes.
//
// Reports are write-only for ordinary users: anyone signed in can file one,
// but only staff can read the queue (see firestore.rules). That keeps a
// report from becoming a way to enumerate other people's content.

const REASONS: { id: ReportReason; labelKey: string; urgent?: boolean }[] = [
  { id: 'child_safety', labelKey: 'report.reason.childSafety', urgent: true },
  { id: 'sexual', labelKey: 'report.reason.sexual' },
  { id: 'violence', labelKey: 'report.reason.violence' },
  { id: 'harassment', labelKey: 'report.reason.harassment' },
  { id: 'spam', labelKey: 'report.reason.spam' },
  { id: 'other', labelKey: 'report.reason.other' },
]

export function ReportSheet({ user, targetType, targetId, targetOwnerId, targetOwnerName, preview, onClose }: {
  user: AppUser
  targetType: ReportTargetType
  targetId: string
  targetOwnerId?: string
  targetOwnerName?: string
  preview?: string
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!reason || busy) return
    setBusy(true); setError('')
    try {
      await addDoc(collection(db, 'reports'), {
        targetType,
        targetId,
        ...(targetOwnerId ? { targetOwnerId } : {}),
        ...(targetOwnerName ? { targetOwnerName } : {}),
        reason,
        details: details.trim().slice(0, 1000),
        // Snapshot so the report stays reviewable if the content is deleted.
        preview: (preview || '').slice(0, 300),
        reporterId: user.uid,
        reporterName: user.displayName || '',
        status: 'open',
        createdAt: serverTimestamp(),
      })
      setSent(true)
    } catch (_e) {
      setError(t('report.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="glass w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-pop max-h-[88vh] overflow-y-auto">
          {sent ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-full bg-affirm-50 text-affirm-600 flex items-center justify-center mx-auto">
                <Check size={26} />
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-800">{t('report.sentTitle')}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{t('report.sentBody')}</p>
              <button onClick={onClose}
                className="mt-6 w-full py-3.5 rounded-2xl btn-glass-primary font-semibold text-[15px]">
                {t('report.close')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Flag size={20} className="text-affirm-600 shrink-0" />
                  <h3 className="text-lg font-bold text-slate-800">{t('report.title')}</h3>
                </div>
                <button onClick={onClose} aria-label={t('report.close')}
                  className="p-1.5 -mr-1.5 rounded-full text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{t('report.subtitle')}</p>

              <div className="mt-5 space-y-2">
                {REASONS.map(r => {
                  const on = reason === r.id
                  return (
                    <button key={r.id} type="button" onClick={() => setReason(r.id)}
                      className={`w-full text-left px-4 py-3 rounded-2xl border text-[15px] font-medium transition flex items-center gap-2.5 ${
                        on ? 'border-affirm-500 bg-affirm-50 text-affirm-700'
                           : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                      {r.urgent && <ShieldAlert size={17} className={on ? 'text-affirm-600' : 'text-slate-400'} />}
                      {t(r.labelKey as never)}
                    </button>
                  )
                })}
              </div>

              <textarea value={details} onChange={e => setDetails(e.target.value)}
                maxLength={1000} rows={3} placeholder={t('report.detailsPlaceholder')}
                className="mt-4 w-full p-4 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 resize-none text-[15px] focus:outline-none" />

              {error && <p className="mt-3 text-sm text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}

              <button onClick={submit} disabled={!reason || busy}
                className="mt-4 w-full py-3.5 rounded-2xl btn-glass-primary font-semibold text-[15px] disabled:opacity-50">
                {busy ? t('report.sending') : t('report.submit')}
              </button>
              <p className="mt-3 text-[11px] text-slate-400 text-center leading-relaxed">
                {t('report.urgentNote')}
              </p>
            </>
          )}
        </div>
      </div>
    </Portal>
  )
}
