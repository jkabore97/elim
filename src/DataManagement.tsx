import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, limit } from 'firebase/firestore'
import { Search, Download, Database, FileText, Users, X } from 'lucide-react'
import { db } from './firebase'
import { useLanguage } from './i18n'
import type { AppUser } from './types'

// What we hold, why, and for how long. Written out in the app rather than kept
// in a document somewhere, so it can be shown on demand and is far harder to
// let drift out of date than a file nobody opens.
const DATA_REGISTRY = [
  {
    collection: 'users',
    purposeKey: 'reg.users',
    fields: [
      'uid', 'firstName', 'lastName', 'displayName', 'email', 'phone',
      'phoneVerified', 'dateOfBirth', 'gender', 'profession', 'interests',
      'role', 'churchName', 'memberChurchId', 'memberChurchName',
      'country', 'city', 'avatar', 'notificationsEnabled', 'fcmTokens', 'createdAt'
    ],
    sensitive: true
  },
  {
    collection: 'posts',
    purposeKey: 'reg.posts',
    fields: ['churchId', 'churchName', 'type', 'content', 'mediaUrl', 'fileName', 'likes', 'commentsCount', 'createdAt'],
    sensitive: false
  },
  {
    collection: 'comments',
    purposeKey: 'reg.comments',
    fields: ['postId', 'userId', 'userName', 'text', 'createdAt'],
    sensitive: false
  },
  {
    collection: 'likes',
    purposeKey: 'reg.likes',
    fields: ['postId', 'userId', 'createdAt'],
    sensitive: false
  },
  {
    collection: 'conversations',
    purposeKey: 'reg.conversations',
    fields: ['type', 'participantIds', 'participantNames', 'lastMessage', 'lastMessageAt', 'readBy', 'createdAt'],
    sensitive: true
  },
  {
    collection: 'messages',
    purposeKey: 'reg.messages',
    fields: ['conversationId', 'senderId', 'senderName', 'senderRole', 'text', 'mediaUrl', 'mediaType', 'createdAt'],
    sensitive: true
  },
  {
    collection: 'activityLogs',
    purposeKey: 'reg.logs',
    fields: ['action', 'userId', 'userName', 'userRole', 'detail', 'createdAt'],
    sensitive: true
  },
  {
    collection: 'churchDirectory',
    purposeKey: 'reg.directory',
    fields: ['name'],
    sensitive: false
  }
]

// Values can contain commas, quotes, and newlines (a post body especially), so
// every field is quoted and internal quotes doubled - the CSV standard escape.
// Without this a single comma in someone's job title would shift every
// subsequent column and silently corrupt the export.
function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return '""'
    const s = Array.isArray(v) ? v.join('; ')
      : typeof v === 'object' && v.toDate ? v.toDate().toISOString()
      : typeof v === 'object' ? JSON.stringify(v)
      : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const header = columns.map(escape).join(',')
  const body = rows.map(r => columns.map(col => escape(r[col])).join(',')).join('\n')
  return `${header}\n${body}`
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoking frees the blob; without it the data stays in memory for the life
  // of the tab, which matters when exporting the whole member list.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function DataManagementTab({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [view, setView] = useState<'people' | 'registry' | 'export'>('people')
  const [people, setPeople] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selected, setSelected] = useState<AppUser | null>(null)

  const isAdmin = user.role === 'admin' || user.role === 'pastor'

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), limit(1000)),
      snap => {
        setPeople(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
        setError('')
        setLoading(false)
      },
      err => { setError(err?.message || String(err)); setLoading(false) }
    )
    return () => unsub()
  }, [])

  const visible = useMemo(() => {
    let rows = people
    if (roleFilter !== 'all') rows = rows.filter(p => p.role === roleFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(p =>
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.churchName || p.memberChurchName || '').toLowerCase().includes(q) ||
        (p.profession || '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [people, search, roleFilter])

  // Headline counts. Useful on their own, and the first thing anyone asks.
  const stats = useMemo(() => ({
    total: people.length,
    members: people.filter(p => p.role === 'member').length,
    leads: people.filter(p => p.role === 'church').length,
    pending: people.filter(p => p.role === 'pending_church').length,
    verified: people.filter(p => p.phoneVerified).length,
    withNotifications: people.filter(p => p.notificationsEnabled).length
  }), [people])

  const exportPeopleCsv = () => {
    const columns = [
      'uid', 'firstName', 'lastName', 'displayName', 'role', 'email', 'phone',
      'phoneVerified', 'dateOfBirth', 'gender', 'profession', 'interests',
      'churchName', 'memberChurchName', 'country', 'city', 'createdAt'
    ]
    const stamp = new Date().toISOString().split('T')[0]
    download(`elim-membres-${stamp}.csv`, toCsv(visible as any[], columns), 'text/csv')
  }

  const exportPeopleJson = () => {
    const stamp = new Date().toISOString().split('T')[0]
    // fcmTokens are device push addresses, not information about the person -
    // they're operational plumbing and there's no reason to put them in a file
    // that gets emailed around.
    const cleaned = visible.map(({ fcmTokens, ...rest }) => rest)
    download(`elim-membres-${stamp}.json`, JSON.stringify(cleaned, null, 2), 'application/json')
  }

  const exportRegistry = () => {
    const stamp = new Date().toISOString().split('T')[0]
    const lines = [
      'REGISTRE DES DONNEES - ELIM',
      `Genere le : ${new Date().toLocaleString('fr-FR')}`,
      `Responsable : Centre Chretien E.L.I.M`,
      `Contact : hello@kaj-consulting.com`,
      '',
      `Nombre total de comptes : ${stats.total}`,
      `  - Membres : ${stats.members}`,
      `  - Leads : ${stats.leads}`,
      `  - En attente : ${stats.pending}`,
      '',
      '='.repeat(60),
      ''
    ]
    DATA_REGISTRY.forEach(entry => {
      lines.push(`COLLECTION : ${entry.collection}`)
      lines.push(`Finalite : ${t(entry.purposeKey as any)}`)
      lines.push(`Donnees personnelles : ${entry.sensitive ? 'OUI' : 'Non'}`)
      lines.push(`Champs : ${entry.fields.join(', ')}`)
      lines.push('')
    })
    download(`elim-registre-donnees-${stamp}.txt`, lines.join('\n'), 'text/plain')
  }

  const tabs = [
    { id: 'people' as const, label: t('data.people'), Icon: Users },
    { id: 'registry' as const, label: t('data.registry'), Icon: FileText },
    { id: 'export' as const, label: t('data.export'), Icon: Download }
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id)}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition ${
              view === tab.id
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/40'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:text-slate-200'}`}>
            <tab.Icon size={15} /> {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-center text-slate-400 py-16">{t('app.loading')}</p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <p className="text-sm font-semibold text-red-400">{t('data.loadFailed')}</p>
          <p className="text-xs text-red-300 mt-1.5 break-words">{error}</p>
        </div>
      )}

      {/* ---------- PEOPLE ---------- */}
      {!loading && !error && view === 'people' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('data.statTotal'), value: stats.total },
              { label: t('data.statMembers'), value: stats.members },
              { label: t('data.statLeads'), value: stats.leads },
              { label: t('data.statPending'), value: stats.pending },
              { label: t('data.statVerified'), value: stats.verified },
              { label: t('data.statNotifs'), value: stats.withNotifications }
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl px-3 py-3 border border-slate-100 text-center">
                <p className="text-xl font-bold text-slate-900">{s.value}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="relative">
            <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('data.searchPeople')}
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]" />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { id: 'all', label: t('data.filterAll') },
              { id: 'member', label: t('data.filterMembers') },
              { id: 'church', label: t('data.filterLeads') },
              { id: 'pending_church', label: t('data.filterPending') },
              { id: 'admin', label: t('data.filterAdmin') }
            ].map(f => (
              <button key={f.id} onClick={() => setRoleFilter(f.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  roleFilter === f.id
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/40'
                    : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                {f.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-400 px-1">{visible.length} {t('data.results')}</p>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            {visible.slice(0, 200).map((p, i) => (
              <button key={p.uid} onClick={() => setSelected(p)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition ${
                  i !== Math.min(visible.length, 200) - 1 ? 'border-b border-slate-50' : ''}`}>
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {(p.displayName || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">{p.displayName}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {p.phone || p.email || '—'}{p.profession ? ` · ${p.profession}` : ''}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                  {p.role}
                </span>
              </button>
            ))}
          </div>
          {visible.length > 200 && (
            <p className="text-[11px] text-slate-500 text-center">{t('data.showingFirst200')}</p>
          )}
        </>
      )}

      {/* ---------- REGISTRY ---------- */}
      {!loading && !error && view === 'registry' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs text-amber-800 leading-relaxed">{t('data.registryIntro')}</p>
          </div>

          {DATA_REGISTRY.map(entry => (
            <div key={entry.collection} className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                <Database size={15} className="text-emerald-600 shrink-0" />
                <h3 className="font-bold text-slate-900">{entry.collection}</h3>
                {entry.sensitive && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {t('data.personalData')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">{t(entry.purposeKey as any)}</p>
              <div className="flex flex-wrap gap-1 mt-3">
                {entry.fields.map(f => (
                  <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- EXPORT ---------- */}
      {!loading && !error && view === 'export' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs text-amber-800 leading-relaxed">{t('data.exportWarning')}</p>
          </div>

          {[
            { label: t('data.exportCsv'), desc: t('data.exportCsvDesc'), fn: exportPeopleCsv, adminOnly: false },
            { label: t('data.exportJson'), desc: t('data.exportJsonDesc'), fn: exportPeopleJson, adminOnly: true },
            { label: t('data.exportRegistry'), desc: t('data.exportRegistryDesc'), fn: exportRegistry, adminOnly: false }
          ].filter(x => !x.adminOnly || isAdmin).map(x => (
            <button key={x.label} onClick={x.fn}
              className="w-full flex items-center gap-4 p-5 rounded-3xl bg-white shadow-sm border border-slate-100 hover:border-emerald-200 transition text-left">
              <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <Download size={19} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900">{x.label}</h3>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{x.desc}</p>
              </div>
            </button>
          ))}

          <p className="text-[11px] text-slate-500 px-1 leading-relaxed">
            {t('data.exportScope')} {visible.length} {t('data.results')}.
          </p>
        </div>
      )}

      {/* ---------- SINGLE PERSON ---------- */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 truncate">{selected.displayName}</h2>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-2">
              {Object.entries(selected)
                // fcmTokens are long device addresses that tell a human nothing.
                .filter(([k]) => k !== 'fcmTokens')
                .map(([k, v]) => (
                  <div key={k} className="flex gap-3 py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-[11px] text-slate-400 w-32 shrink-0">{k}</span>
                    <span className="text-[12px] text-slate-700 break-words min-w-0">
                      {v === null || v === undefined ? '—'
                        : Array.isArray(v) ? v.join(', ')
                        : typeof v === 'object' && (v as any).toDate ? (v as any).toDate().toLocaleString()
                        : typeof v === 'object' ? JSON.stringify(v)
                        : String(v)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
