import { useState, useEffect } from 'react'
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from 'firebase/firestore'
import { HeartPulse, Plus, X, Trash2, AlertTriangle } from 'lucide-react'
import { db } from './firebase'
import { useLanguage } from './i18n'
import { logActivity } from './activityLog'
import type { AppUser } from './types'

export interface HealthTip {
  id: string
  title: string
  body: string
  category: string
  authorId: string
  authorName: string
  createdAt?: any
}

const CATEGORIES = [
  'Prévention', 'Nutrition', 'Maternité & enfance', 'Hygiène',
  'Paludisme', 'Santé mentale', 'Premiers secours', 'Général'
]

// Who may publish. Deliberately narrow: a health tip carries more weight than
// an ordinary post, so it's limited to the medical professions declared at
// signup, plus leads and admins.
function canPublishHealth(user: AppUser) {
  if (user.role === 'admin' || user.role === 'pastor' || user.role === 'church') return true
  const medical = ['Médecin', 'Infirmier / Sage-femme', 'Pharmacien']
  return !!user.profession && medical.includes(user.profession)
}

export function SanteTab({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [tips, setTips] = useState<HealthTip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'healthTips'), orderBy('createdAt', 'desc'), limit(200)),
      snap => {
        setTips(snap.docs.map(d => ({ id: d.id, ...d.data() } as HealthTip)))
        setError('')
        setLoading(false)
      },
      err => { setError(err?.message || String(err)); setLoading(false) }
    )
    return () => unsub()
  }, [])

  const publish = async () => {
    if (!title.trim() || !body.trim() || saving) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'healthTips'), {
        title: title.trim(),
        body: body.trim(),
        category,
        authorId: user.uid,
        authorName: user.displayName,
        createdAt: serverTimestamp()
      })
      logActivity(user, 'post_created', `Santé: ${title.trim().slice(0, 60)}`)
      setTitle(''); setBody(''); setComposing(false)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try { await deleteDoc(doc(db, 'healthTips', id)) }
    catch (err: any) { setError(err?.message || String(err)) }
  }

  const visible = filter === 'all' ? tips : tips.filter(x => x.category === filter)
  const mayPublish = canPublishHealth(user)

  return (
    <div className="space-y-4">
      {/* Health information from a church isn't clinical advice, and saying so
          plainly protects both the reader and the person who posted. */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 leading-relaxed">{t('sante.disclaimer')}</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', ...CATEGORIES].map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
              filter === cat
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/40'
                : 'bg-white/5 text-slate-400 border border-white/10'}`}>
            {cat === 'all' ? t('sante.allCategories') : cat}
          </button>
        ))}
      </div>

      {mayPublish && !composing && (
        <button onClick={() => setComposing(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition shadow-lg shadow-emerald-500/20">
          <Plus size={18} /> {t('sante.newTip')}
        </button>
      )}

      {composing && (
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">{t('sante.newTip')}</h3>
            <button onClick={() => setComposing(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
              <X size={18} />
            </button>
          </div>

          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('sante.titlePlaceholder')}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-400" />

          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
            placeholder={t('sante.bodyPlaceholder')}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400" />

          <button onClick={publish} disabled={!title.trim() || !body.trim() || saving}
            className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-sm transition">
            {saving ? t('sante.publishing') : t('sante.publish')}
          </button>
        </div>
      )}

      {loading && <p className="text-center text-slate-400 py-16">{t('app.loading')}</p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <p className="text-sm text-red-400 break-words">{error}</p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <HeartPulse size={28} className="text-emerald-400" />
          </div>
          <p className="text-slate-300 font-medium">{t('sante.empty')}</p>
          <p className="text-sm text-slate-500 mt-1">{t('sante.emptyHint')}</p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(tip => (
          <article key={tip.id} className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                <HeartPulse size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                  {tip.category}
                </span>
                <h3 className="font-bold text-slate-900 mt-1.5 leading-snug">{tip.title}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{tip.authorName}</p>
              </div>
              {(tip.authorId === user.uid || user.role === 'admin' || user.role === 'pastor') && (
                <button onClick={() => remove(tip.id)}
                  className="p-1.5 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 shrink-0 transition">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <p className="text-[15px] text-slate-700 leading-relaxed mt-3 whitespace-pre-wrap break-words">
              {tip.body}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}
