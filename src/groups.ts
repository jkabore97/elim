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
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  where, getDocs, writeBatch, serverTimestamp, arrayUnion, arrayRemove,
  deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Group } from './types'

const GROUPS = 'groups'
const POSTS = 'posts'

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

// Add or update a lead on a group. `featured` controls whether this person's
// own name is shown large on their group posts (the pastor), instead of the
// group name.
export async function setLead(groupId: string, uid: string, name: string, featured: boolean): Promise<void> {
  await updateDoc(doc(db, GROUPS, groupId), {
    [`leads.${uid}`]: { name, featured },
    leadIds: arrayUnion(uid),
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
      }
    : { groupId: deleteField(), groupName: deleteField(), groupAvatar: deleteField(), featured: deleteField() }

  const all = [...ids]
  // Firestore caps a batch at 500 writes; chunk to stay well under it.
  for (let i = 0; i < all.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of all.slice(i, i + 400)) batch.update(doc(db, POSTS, id), patch as any)
    await batch.commit()
  }
  return all.length
}
