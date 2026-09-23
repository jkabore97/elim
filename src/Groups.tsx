// Admin panel for publishing GROUPS: create/rename/delete groups, assign leads
// (accounts allowed to publish under a group), mark a lead as "featured" (their
// own name shows big on their group's posts, e.g. the pastor), and back-fill a
// group onto every existing post by a given author.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X, Check, Star, Users, Loader2, Search, DownloadCloud } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { useLanguage } from './i18n'
import type { AppUser, Group, GroupLead } from './types'
import {
  createGroup, updateGroup, deleteGroup, setLead, removeLead, bulkAssignAuthorToGroup,
  setGroupPerm, importChurchesAsGroups,
} from './groups'
import { GroupLogo, groupLogoKind } from './GroupLogo'

const PERM_KEYS = ['post', 'sante', 'books', 'transcribe', 'moderate'] as const

interface DirUser { uid: string; name: string }

export function GroupsPanel({ groups }: { user: AppUser; groups: Group[] }) {
  const { t } = useLanguage()
  const [users, setUsers] = useState<DirUser[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Load the account directory once so leads/authors can be picked by name.
  // Admins can read the users collection (see firestore.rules). Publishers
  // (church/admin/pastor) are the only accounts that can be leads.
  useEffect(() => {
    let alive = true
    getDocs(query(collection(db, 'users'), where('role', 'in', ['church', 'admin', 'pastor'])))
      .then(snap => { if (alive) setUsers(snap.docs.map(d => ({ uid: d.id, name: (d.data() as any).displayName || '—' }))) })
      .catch(() => { /* directory unavailable: pickers just stay empty */ })
    return () => { alive = false }
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true); setErr('')
    try { await createGroup(name); setNewName('') }
    catch (e: any) { setErr(e?.message || 'Error') }
    finally { setBusy(false) }
  }

  const handleImport = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const n = await importChurchesAsGroups(groups)
      setErr(n > 0 ? t('groups.importDone').replace('{n}', String(n)) : t('groups.importNone'))
    } catch (e: any) { setErr(e?.message || 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {/* Create a group */}
      <div className="glass-soft rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Users size={18} /> {t('groups.title')}</h3>
        <p className="text-xs text-slate-500 mb-3">{t('groups.intro')}</p>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder={t('groups.namePlaceholder')} maxLength={60}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          <button onClick={handleCreate} disabled={!newName.trim() || busy}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-affirm-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {t('groups.create')}
          </button>
        </div>
        <button onClick={handleImport} disabled={busy}
          className="mt-2 text-xs font-semibold text-affirm-600 flex items-center gap-1.5 disabled:opacity-50">
          <DownloadCloud size={14} /> {t('groups.importChurches')}
        </button>
        {err && <p className="text-xs text-slate-500 mt-2">{err}</p>}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">{t('groups.empty')}</p>
      ) : (
        groups.map(g => <GroupCard key={g.id} group={g} users={users} />)
      )}

      <BulkAssign groups={groups} users={users} />
    </div>
  )
}

// One lead of a group: name, an optional title (capacity like "Docteur" /
// "Pasteur" shown before their name on this group's posts), the featured toggle,
// and remove.
function LeadRow({ groupId, uid, lead }: { groupId: string; uid: string; lead: GroupLead }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(lead.title || '')
  useEffect(() => { setTitle(lead.title || '') }, [lead.title])
  const saveTitle = () => {
    if ((title.trim() || '') !== (lead.title || '')) setLead(groupId, uid, lead.name, !!lead.featured, title.trim())
  }
  return (
    <div className="bg-white/70 rounded-xl px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{lead.name}</span>
        <button onClick={() => setLead(groupId, uid, lead.name, !lead.featured, lead.title)}
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 ${lead.featured ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
          <Star size={12} className={lead.featured ? 'fill-amber-500 text-amber-500' : ''} /> {t('groups.featured')}
        </button>
        <button onClick={() => removeLead(groupId, uid)} aria-label={t('groups.removeLead')}
          className="shrink-0 w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center"><X size={15} /></button>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder={t('groups.titlePlaceholder')} maxLength={30}
        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
    </div>
  )
}

function GroupCard({ group, users }: { group: Group; users: DirUser[] }) {
  const { t } = useLanguage()
  const [name, setName] = useState(group.name)
  const [avatar, setAvatar] = useState(group.avatar || '')
  const [description, setDescription] = useState(group.description || '')
  const [savingMeta, setSavingMeta] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => { setName(group.name); setAvatar(group.avatar || ''); setDescription(group.description || '') }, [group.name, group.avatar, group.description])

  const dirty = name.trim() !== group.name
    || (avatar.trim() || '') !== (group.avatar || '')
    || (description.trim() || '') !== (group.description || '')
  const leadEntries = Object.entries(group.leads || {})

  const saveMeta = async () => {
    if (!dirty || !name.trim()) return
    setSavingMeta(true)
    try { await updateGroup(group.id, { name, avatar: avatar.trim() || null, description: description.trim() || null }) } finally { setSavingMeta(false) }
  }
  const remove = async () => {
    if (confirm(t('groups.deleteConfirm').replace('{name}', group.name))) await deleteGroup(group.id)
  }

  return (
    <div className="glass-soft rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        {avatar ? <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          : groupLogoKind(group.name) ? <GroupLogo name={group.name} size={36} />
          : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 text-white font-bold flex items-center justify-center shrink-0">{(group.name || 'G').charAt(0)}</div>}
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
        <button onClick={remove} aria-label={t('groups.delete')}
          className="shrink-0 w-9 h-9 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100"><Trash2 size={16} /></button>
      </div>
      <input value={avatar} onChange={e => setAvatar(e.target.value)} placeholder={t('groups.avatarPlaceholder')}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
      <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('groups.descriptionPlaceholder')}
        maxLength={400} rows={2}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400 resize-none" />
      {dirty && (
        <button onClick={saveMeta} disabled={savingMeta || !name.trim()}
          className="text-xs font-semibold text-affirm-600 flex items-center gap-1 disabled:opacity-50">
          {savingMeta ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('groups.save')}
        </button>
      )}

      {/* Permissions this group grants its leads. */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{t('groups.permsTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {PERM_KEYS.map(key => {
            const on = !!group.perms?.[key]
            return (
              <button key={key} onClick={() => setGroupPerm(group.id, key, !on)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${on ? 'bg-affirm-600 text-white border-affirm-500' : 'bg-white text-slate-500 border-slate-200'}`}>
                {on ? '✓ ' : ''}{t(`groups.perm.${key}` as any)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Leads */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{t('groups.leads')}</p>
        {leadEntries.length === 0 && <p className="text-xs text-slate-400 mb-2">{t('groups.noLeads')}</p>}
        <div className="space-y-1.5">
          {leadEntries.map(([uid, lead]) => (
            <LeadRow key={uid} groupId={group.id} uid={uid} lead={lead} />
          ))}
        </div>
        {pickerOpen ? (
          <UserPicker users={users.filter(u => !group.leads?.[u.uid])}
            onPick={u => { setLead(group.id, u.uid, u.name, false); setPickerOpen(false) }}
            onCancel={() => setPickerOpen(false)} />
        ) : (
          <button onClick={() => setPickerOpen(true)}
            className="mt-2 text-xs font-semibold text-affirm-600 flex items-center gap-1"><Plus size={14} /> {t('groups.addLead')}</button>
        )}
      </div>
    </div>
  )
}

// Back-fill a group onto all of one author's existing posts.
function BulkAssign({ groups, users }: { groups: Group[]; users: DirUser[] }) {
  const { t } = useLanguage()
  const [author, setAuthor] = useState<DirUser | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const apply = async (clear: boolean) => {
    if (!author || busy) return
    const group = clear ? null : groups.find(g => g.id === groupId) || null
    if (!clear && !group) return
    setBusy(true); setDone('')
    try {
      const n = await bulkAssignAuthorToGroup(author.uid, group)
      setDone(t('groups.bulkDone').replace('{n}', String(n)))
    } catch { setDone(t('groups.bulkError')) }
    finally { setBusy(false) }
  }

  return (
    <div className="glass-soft rounded-2xl p-4 space-y-3">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">{t('groups.bulkTitle')}</h3>
      <p className="text-xs text-slate-500">{t('groups.bulkIntro')}</p>

      {author ? (
        <div className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2">
          <span className="flex-1 truncate text-sm font-semibold text-slate-700">{author.name}</span>
          <button onClick={() => { setAuthor(null); setDone('') }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ) : pickerOpen ? (
        <UserPicker users={users} onPick={u => { setAuthor(u); setPickerOpen(false); setDone('') }} onCancel={() => setPickerOpen(false)} />
      ) : (
        <button onClick={() => setPickerOpen(true)}
          className="text-xs font-semibold text-affirm-600 flex items-center gap-1"><Search size={14} /> {t('groups.pickAuthor')}</button>
      )}

      {author && (
        <>
          <select value={groupId} onChange={e => setGroupId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
            <option value="">{t('groups.pickGroup')}</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => apply(false)} disabled={!groupId || busy}
              className="px-4 py-2 rounded-xl bg-affirm-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t('groups.bulkApply')}
            </button>
            <button onClick={() => apply(true)} disabled={busy}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm disabled:opacity-50">
              {t('groups.bulkClear')}
            </button>
          </div>
          {done && <p className="text-xs text-affirm-700 font-medium">{done}</p>}
        </>
      )}
    </div>
  )
}

function UserPicker({ users, onPick, onCancel }: {
  users: DirUser[]; onPick: (u: DirUser) => void; onCancel: () => void
}) {
  const { t } = useLanguage()
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? users.filter(u => u.name.toLowerCase().includes(s)) : users
    return list.slice(0, 12)
  }, [q, users])

  return (
    <div className="mt-2 border border-slate-200 rounded-xl bg-white p-2">
      <div className="flex items-center gap-2 mb-1.5">
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder={t('groups.searchName')}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-affirm-400" />
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 px-2 py-2">{t('groups.noMatch')}</p>
      ) : (
        <div className="max-h-52 overflow-y-auto">
          {filtered.map(u => (
            <button key={u.uid} onClick={() => onPick(u)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-affirm-50 truncate">{u.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
