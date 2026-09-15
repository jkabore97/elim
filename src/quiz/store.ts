// Firestore persistence for the Bible quiz.
//
// One document per player in `quizProfiles/{uid}`; the weekly leaderboard is
// a query over the same collection (weekId == this week, ordered by
// weekPoints). Firestore's persistent cache keeps the profile readable and
// writable offline - a game finished on the bus syncs when the network is
// back, which matters for the daily streak.
import {
  doc, collection, onSnapshot, setDoc, query, where, orderBy, limit, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { emptyProfile, weekKey, type QuizProfile } from './engine'

const COL = 'quizProfiles'

// Firestore rejects `undefined` values; strip them before writing.
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export function subscribeProfile(
  uid: string, displayName: string, avatar: string | undefined,
  cb: (p: QuizProfile) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onSnapshot(doc(db, COL, uid), snap => {
    if (!snap.exists()) { cb(emptyProfile(uid, displayName, avatar)); return }
    const d = snap.data() as Partial<QuizProfile>
    cb({
      ...emptyProfile(uid, displayName, avatar),
      ...d,
      uid,
      badges: Array.isArray(d.badges) ? d.badges : [],
      best: d.best && typeof d.best === 'object' ? d.best : {},
    })
  }, e => onError?.(e))
}

export async function saveProfile(p: QuizProfile): Promise<void> {
  await setDoc(doc(db, COL, p.uid), clean({ ...p, updatedAt: serverTimestamp() }), { merge: true })
}

export interface LeaderRow { uid: string; displayName: string; avatar?: string; weekPoints: number; points: number }

export async function fetchWeeklyLeaders(top = 10): Promise<LeaderRow[]> {
  const q = query(collection(db, COL), where('weekId', '==', weekKey()), orderBy('weekPoints', 'desc'), limit(top))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const v = d.data() as Partial<QuizProfile>
    return { uid: d.id, displayName: v.displayName || '—', avatar: v.avatar, weekPoints: v.weekPoints ?? 0, points: v.points ?? 0 }
  })
}
