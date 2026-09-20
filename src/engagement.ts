// Post engagement writes: a view ("seen"), and a share.
//
// Each is stored as ONE document per (post, user) in its own collection —
// postViews/{postId}_{uid} and postShares/{postId}_{uid} — exactly like the
// likes collection. That per-user doc is the source of truth; a Cloud Function
// recomputes the count on the post from these docs, so posts.views / .shares
// always reflect the real number of documents rather than a client guess.
//
// To keep it cheap on the metered connections most members use, each write is
// fired at most once per device (a local guard) — re-viewing a post you've
// already seen doesn't write again, and the Cloud Function only ever counts
// the one doc regardless.
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { storageGet, storageSet } from './safeStorage'

// Remember, per device, which posts this person has already recorded a view /
// share for, so we never write the same doc twice. Kept in localStorage (with
// an in-memory mirror) so it survives reloads without a Firestore read.
function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(storageGet(key) || '[]')) } catch { return new Set() }
}
function saveSet(key: string, s: Set<string>) {
  try { storageSet(key, JSON.stringify([...s].slice(-2000))) } catch { /* ignore */ }
}

const VIEW_KEY = 'elim-viewed-posts'
const SHARE_KEY = 'elim-shared-posts'
const viewed = loadSet(VIEW_KEY)
const shared = loadSet(SHARE_KEY)

// Record that `uid` has seen `postId`. No-op if already recorded on this
// device. The author's own views ARE counted. Best-effort: a failed write is
// silently ignored.
// Returns true only when a NEW view was written (first time on this device), so
// the caller can log it once and not on every re-appearance.
export async function recordPostView(postId: string, uid: string): Promise<boolean> {
  if (!postId || !uid) return false
  if (viewed.has(postId)) return false
  viewed.add(postId); saveSet(VIEW_KEY, viewed)
  try {
    await setDoc(doc(db, 'postViews', `${postId}_${uid}`),
      { postId, userId: uid, createdAt: serverTimestamp() }, { merge: true })
    return true
  } catch { viewed.delete(postId); return false /* let a later view retry */ }
}

// Record that `uid` shared `postId` (unique per person). Called only after the
// share sheet actually resolves — a cancelled share doesn't count.
export async function recordPostShare(postId: string, uid: string): Promise<void> {
  if (!postId || !uid) return
  if (shared.has(postId)) return
  shared.add(postId); saveSet(SHARE_KEY, shared)
  try {
    await setDoc(doc(db, 'postShares', `${postId}_${uid}`),
      { postId, userId: uid, createdAt: serverTimestamp() }, { merge: true })
  } catch { shared.delete(postId) }
}
