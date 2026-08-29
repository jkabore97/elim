import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, limit } from 'firebase/firestore'
import { Search, Phone, Mail, MapPin, Briefcase, Users } from 'lucide-react'
import { db } from './firebase'
import { useLanguage } from './i18n'
import { TValue } from './TValue'
import type { AppUser } from './types'

// Read-only directory of the congregation, for church leads. Members sign up
// with contact details and the departments they serve in; this lays each one
// out as a tidy contact card. Leads can look people up but not edit them - that
// stays with staff in the Data explorer.
export function MembersTab() {
  const { t } = useLanguage()
  const [people, setPeople] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), limit(1000)),
      snap => {
        setPeople(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
        setError('')
        setLoading(false)
      },
      err => { setError(err?.message || String(err)); setLoading(false) },
    )
    return () => unsub()
  }, [])

  const members = useMemo(() => {
    // The congregation: ordinary members and church leads. Staff accounts
    // (admin/pastor) and not-yet-approved churches are deliberately left out.
    let rows = people.filter(p => p.role === 'member' || p.role === 'church')
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(p =>
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.profession || '').toLowerCase().includes(q) ||
        (p.city || '').toLowerCase().includes(q) ||
        (p.country || '').toLowerCase().includes(q) ||
        (p.interests || []).some(i => i.toLowerCase().includes(q)),
      )
    }
    // Alphabetical by name so the list reads like a directory.
    return rows.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
  }, [people, search])

  return (
    <div className="space-y-4">
      {/* Search + count */}
      <div className="glass rounded-3xl p-4 border border-slate-100/80">
        <div className="flex items-center gap-2 glass-input rounded-2xl px-3.5 py-2.5">
          <Search size={17} className="text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('members.searchPlaceholder')}
            className="flex-1 min-w-0 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none text-sm"
          />
        </div>
        <p className="mt-2 ml-1 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
          <Users size={13} /> {members.length} {t('members.count')}
        </p>
      </div>

      {loading && <p className="text-center text-on-bg py-8 text-sm">{t('app.loading')}</p>}
      {error && <p className="text-center text-red-500 py-8 text-sm">{error}</p>}

      {!loading && !error && members.length === 0 && (
        <div className="text-center py-14 text-on-bg">
          <Users size={34} className="mx-auto mb-3 opacity-50" />
          <p className="font-semibold text-on-bg">{t('members.empty')}</p>
          <p className="text-sm mt-1">{t('members.emptyHint')}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {members.map(m => <MemberCard key={m.uid} m={m} t={t} />)}
      </div>
    </div>
  )
}

function MemberCard({ m, t }: { m: AppUser; t: (k: any) => string }) {
  const gender = m.gender === 'homme' ? t('auth.male') : m.gender === 'femme' ? t('auth.female') : null

  return (
    <div className="glass rounded-3xl p-4 border border-slate-100/80">
      {/* Header: avatar + name + gender */}
      <div className="flex items-center gap-3">
        {m.avatar ? (
          <img src={m.avatar} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 flex items-center justify-center text-white font-bold shrink-0">
            {(m.displayName || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{m.displayName || '—'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {m.role === 'church' && (
              <span className="text-[11px] font-semibold text-teal-700 bg-teal-500/10 rounded-full px-2 py-0.5">
                {t('role.church')}
              </span>
            )}
            {gender && (
              <span className="text-[11px] font-semibold text-affirm-700 bg-affirm-500/10 rounded-full px-2 py-0.5">
                {gender}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Contact + details */}
      <div className="mt-3 space-y-1.5 text-sm text-slate-600">
        {m.phone && (
          <a href={`tel:${m.phone}`} className="flex items-center gap-2 hover:text-affirm-700 transition">
            <Phone size={14} className="text-slate-400 shrink-0" />
            <span className="truncate">{m.phone}</span>
          </a>
        )}
        {m.email && (
          <a href={`mailto:${m.email}`} className="flex items-center gap-2 hover:text-affirm-700 transition">
            <Mail size={14} className="text-slate-400 shrink-0" />
            <span className="truncate">{m.email}</span>
          </a>
        )}
        {(m.city || m.country) && (
          <p className="flex items-center gap-2">
            <MapPin size={14} className="text-slate-400 shrink-0" />
            {/* City stays as written (a place name); the country comes from a
                fixed English list, so it follows the reader's language. */}
            <span className="truncate">
              {m.city}{m.city && m.country ? ', ' : ''}
              {m.country && <TValue text={m.country} source="en" />}
            </span>
          </p>
        )}
        {m.profession && (
          <p className="flex items-center gap-2">
            <Briefcase size={14} className="text-slate-400 shrink-0" />
            <span className="truncate"><TValue text={m.profession} source="fr" /></span>
          </p>
        )}
      </div>

      {/* Interests / departments (authored in French) */}
      {m.interests && m.interests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.interests.map(i => (
            <span key={i} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
              <TValue text={i} source="fr" />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
