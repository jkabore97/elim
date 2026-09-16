// Firestore layer for publishing GROUPS (ministries / departments / the church
// itself). Groups are created and edited by an admin; each group has a set of
// "leads" (accounts allowed to publish under it), any of whom can be marked
// "featured" so their own name shows large on their group's posts.
//
// Collection:
//  - groups/{groupId} : { name, avatar?, leads: {uid: {name, featured}},
//    leadIds: string[], createdAt, updatedAt }. World-readable so a lead's
//    composer can list "my groups"; only admins/pastors write.
import {
  collection, doc, addDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  where, getDocs, writeBatch, serverTimestamp, arrayUnion, arrayRemove,
  deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Group } from './types'

const GROUPS = 'groups'
const POSTS = 'posts'

// Firestore rejects `undefined`; drop those keys before writing.
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// Live list of all groups, ordered by name. There are only a handful (the
// church's departments), so loading them all is cheap and lets the composer and
// admin filter client-side without extra queries.
export function subscribeGroups(
  cb: (groups: Group[]) => void,
  onError?: (e: unknown) => void,
): () => void {
  const q = query(collection(db, GROUPS), orderBy('name'))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => {
      const v = d.data() as any
      return {
        id: d.id,
        name: v.name || '',
        avatar: v.avatar || undefined,
        leads: v.leads && typeof v.leads === 'object' ? v.leads : {},
        leadIds: Array.isArray(v.leadIds) ? v.leadIds : [],
        perms: v.perms && typeof v.perms === 'object' ? v.perms : {},
      } as Group
    }))
  }, e => onError?.(e))
}

export async function createGroup(name: string, avatar?: string): Promise<void> {
  await addDoc(collection(db, GROUPS), {
    name: name.trim(),
    ...(avatar ? { avatar } : {}),
    leads: {},
    leadIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateGroup(id: string, patch: { name?: string; avatar?: string | null }): Promise<void> {
  const data: Record<string, any> = { updatedAt: serverTimestamp() }
  if (patch.name !== undefined) data.name = patch.name.trim()
  if (patch.avatar !== undefined) data.avatar = patch.avatar || deleteField()
  await updateDoc(doc(db, GROUPS, id), data)
}

export async function deleteGroup(id: string): Promise<void> {
  await deleteDoc(doc(db, GROUPS, id))
}

// Seed groups from the existing church directory so "churches become groups"
// starts with the churches already present. Each church becomes a group with
// the church account as a featured lead and full publishing permissions (so
// existing publishers keep their access). Idempotent: skips a church whose name
// already has a group. Returns how many groups were created.
export async function importChurchesAsGroups(existing: Group[]): Promise<number> {
  const haveNames = new Set(existing.map(g => (g.name || '').trim().toLowerCase()))
  let snap
  try { snap = await getDocs(collection(db, 'churchDirectory')) } catch { return 0 }
  let created = 0
  for (const d of snap.docs) {
    const churchName = ((d.data() as any).name || '').trim()
    if (!churchName || haveNames.has(churchName.toLowerCase())) continue
    const uid = d.id
    // Prefer the account's own display name for the lead label; fall back to
    // the church name if the user doc isn't readable.
    let leadName = churchName
    try {
      const u = await getDoc(doc(db, 'users', uid))
      if (u.exists() && (u.data() as any).displayName) leadName = (u.data() as any).displayName
    } catch { /* fall back to church name */ }
    await addDoc(collection(db, GROUPS), {
      name: churchName,
      leads: { [uid]: { name: leadName, featured: true } },
      leadIds: [uid],
      perms: { post: true, sante: true, books: true },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    haveNames.add(churchName.toLowerCase())
    created++
  }
  return created
}

// Add or update a lead on a group. `featured` controls whether this person's
// own name is shown large on their group posts (the pastor), instead of the
// group name. `title` is the capacity shown before their name on this group's
// posts (e.g. "Docteur", "Pasteur").
export async function setLead(
  groupId: string, uid: string, name: string, featured: boolean, title?: string,
): Promise<void> {
  await updateDoc(doc(db, GROUPS, groupId), {
    [`leads.${uid}`]: clean({ name, featured, title: title || undefined }),
    leadIds: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  })
}

// Toggle a capability the group grants to its leads.
export async function setGroupPerm(
  groupId: string, key: 'post' | 'sante' | 'books' | 'transcribe', value: boolean,
): Promise<void> {
  await updateDoc(doc(db, GROUPS, groupId), {
    [`perms.${key}`]: value,
    updatedAt: serverTimestamp(),
  })
}

export async function removeLead(groupId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, GROUPS, groupId), {
    [`leads.${uid}`]: deleteField(),
    leadIds: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  })
}

// Apply (or clear) a group on EVERY existing post by one author, so past
// publications can be back-filled with their group. `group` null clears it.
// Matches posts by authorId and by churchId (older posts predate authorId),
// which for a church/lead account are the same person.
export async function bulkAssignAuthorToGroup(authorId: string, group: Group | null): Promise<number> {
  const ids = new Set<string>()
  for (const field of ['authorId', 'churchId'] as const) {
    try {
      const snap = await getDocs(query(collection(db, POSTS), where(field, '==', authorId)))
      snap.docs.forEach(d => ids.add(d.id))
    } catch { /* one of the two may need an index; the other still applies */ }
  }
  const patch = group
    ? {
        groupId: group.id,
        groupName: group.name,
        groupAvatar: group.avatar || null,
        featured: !!group.leads[authorId]?.featured,
        authorTitle: group.leads[authorId]?.title || deleteField(),
      }
    : { groupId: deleteField(), groupName: deleteField(), groupAvatar: deleteField(), featured: deleteField(), authorTitle: deleteField() }

  const all = [...ids]
  // Firestore caps a batch at 500 writes; chunk to stay well under it.
  for (let i = 0; i < all.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of all.slice(i, i + 400)) batch.update(doc(db, POSTS, id), patch as any)
    await batch.commit()
  }
  return all.length
}
