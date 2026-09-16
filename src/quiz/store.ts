// Firestore persistence for the Bible quiz.
//
// Collections:
//  - quizProfiles/{uid}  : a player's permanent career (points, level, badges,
//    the set of questions they've mastered, weeks won). World-readable so the
//    crown/weeks-won can be shown; only the owner writes.
//  - quizWeekly/{weekId__league__uid} : adult weekly race entries, one per
//    (week, league, player). league is a category id or 'grand'. Points here
//    are LEARNING points (new questions only) and reset each week simply
//    because the query filters by the current weekId.
//  - quizKids/{kidsWeekId__uid__childSlug} : the kids league, keyed by parent
//    account + child name; a Sunday-Saturday week; points count each question
//    once per week (weekly-distinct) so children are rewarded for covering
//    ground, not for replaying.
//  - quizChampions/{...} : weekly champion snapshots, written only by Cloud
//    Functions at week close; world-readable for the Palmarès.
import {
  doc, collection, onSnapshot, setDoc, query, where, orderBy, limit,
  getDocs, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  emptyProfile, weekKey, kidsWeekKey, pointsFor,
  type QuizProfile, type QuizCategory,
} from './engine'

const PROFILES = 'quizProfiles'
const WEEKLY = 'quizWeekly'
const KIDS = 'quizKids'
const CHAMPIONS = 'quizChampions'

// Firestore rejects `undefined` values; strip them before writing.
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// A short, stable key for a child's name (accents/case/space-insensitive), so
// the same child keeps the same weekly row even with minor typing differences.
export function childSlug(name: string): string {
  return (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'
}

// ---- Career profile ---------------------------------------------------------
export function subscribeProfile(
  uid: string, displayName: string, avatar: string | undefined,
  cb: (p: QuizProfile) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onSnapshot(doc(db, PROFILES, uid), snap => {
    if (!snap.exists()) { cb(emptyProfile(uid, displayName, avatar)); return }
    const d = snap.data() as Partial<QuizProfile>
    cb({
      ...emptyProfile(uid, displayName, avatar),
      ...d,
      uid,
      badges: Array.isArray(d.badges) ? d.badges : [],
      best: d.best && typeof d.best === 'object' ? d.best : {},
      mastered: d.mastered && typeof d.mastered === 'object' ? d.mastered : {},
      weeksWon: d.weeksWon || 0,
    })
  }, e => onError?.(e))
}

// Commit a finished ADULT game: save the career profile and add the game's
// learning points to the weekly leaderboards (grand + each category that had
// new questions). One batch, so it also works offline (queued until online).
export async function commitAdultGame(
  next: QuizProfile,
  perCategoryLearning: Partial<Record<QuizCategory, number>>,
  learningTotal: number,
): Promise<void> {
  const batch = writeBatch(db)
  // weeksWon is owned by the weekly-champion Cloud Function (FieldValue.increment).
  // Never write it from the client: a queued offline commit carrying a stale
  // value would overwrite the server's crown increment. Strip it from the write.
  const { weeksWon: _weeksWon, ...profileWrite } = next
  batch.set(doc(db, PROFILES, next.uid), clean({ ...profileWrite, updatedAt: serverTimestamp() }), { merge: true })

  if (learningTotal > 0) {
    const wk = weekKey()
    const base = { weekId: wk, uid: next.uid, name: next.displayName, avatar: next.avatar, updatedAt: serverTimestamp() }
    batch.set(doc(db, WEEKLY, `${wk}__grand__${next.uid}`),
      clean({ ...base, league: 'grand', points: increment(learningTotal) }), { merge: true })
    for (const [cat, pts] of Object.entries(perCategoryLearning)) {
      if (!pts) continue
      batch.set(doc(db, WEEKLY, `${wk}__${cat}__${next.uid}`),
        clean({ ...base, league: cat, points: increment(pts) }), { merge: true })
    }
  }
  await batch.commit()
}

// ---- Leaderboards -----------------------------------------------------------
export interface LeaderRow { uid: string; name: string; avatar?: string; points: number; weeksWon?: number }

// The General (all-adults) ranking reads each player's profile directly, so
// it shows everyone's real weekly score - including scores earned before the
// per-category collection existed. Still weekly: filtered to this week's id.
export async function fetchGrandLeaders(top = 30): Promise<LeaderRow[]> {
  try {
    const q = query(collection(db, PROFILES),
      where('weekId', '==', weekKey()), orderBy('weekPoints', 'desc'), limit(top))
    const snap = await getDocs(q)
    return snap.docs
      .map(d => {
        const v = d.data() as any
        return { uid: d.id, name: v.displayName || '—', avatar: v.avatar, points: v.weekPoints ?? 0, weeksWon: v.weeksWon || 0 }
      })
      .filter(r => r.points > 0)
  } catch { return [] }
}

// Per-category ranking still comes from the weekly collection (used by the
// Palmarès / champion snapshots).
export async function fetchCategoryLeaders(category: QuizCategory, top = 30): Promise<LeaderRow[]> {
  try {
    const q = query(collection(db, WEEKLY),
      where('weekId', '==', weekKey()), where('league', '==', category),
      orderBy('points', 'desc'), limit(top))
    const snap = await getDocs(q)
    return snap.docs.map(d => {
      const v = d.data() as any
      return { uid: v.uid, name: v.name || '—', avatar: v.avatar, points: v.points ?? 0 }
    })
  } catch { return [] }
}

// Home banner: this week's Grand champion (null if nobody has scored yet).
export interface TopScorer { uid: string; name: string; points: number; scope: 'week' }
export async function fetchTopScorer(): Promise<TopScorer | null> {
  try {
    const rows = await fetchGrandLeaders(1)
    if (rows[0] && rows[0].points > 0) return { uid: rows[0].uid, name: rows[0].name, points: rows[0].points, scope: 'week' }
  } catch { /* index building or offline */ }
  return null
}

// ---- Kids league ------------------------------------------------------------
export interface KidRow { id: string; childName: string; parentName: string; points: number }

export async function fetchKidsLeaders(top = 20): Promise<KidRow[]> {
  const q = query(collection(db, KIDS),
    where('kidsWeekId', '==', kidsWeekKey()), orderBy('points', 'desc'), limit(top))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const v = d.data() as any
    return { id: d.id, childName: v.childName || '—', parentName: v.parentName || '', points: v.points ?? 0 }
  })
}

// Commit a finished KIDS game. Kids earn points for EVERY correct answer, every
// game - the point is to encourage children to keep playing and learning, so a
// perfect round always rewards them (unlike the adult weekly race, which only
// counts a question the first time it's mastered). Returns points gained.
export async function commitKidsGame(
  uid: string, parentName: string, childName: string, correctIds: string[],
): Promise<number> {
  const kw = kidsWeekKey()
  const ref = doc(db, KIDS, `${kw}__${uid}__${childSlug(childName)}`)
  const gained = correctIds.length * pointsFor('easy')
  await setDoc(ref, clean({
    kidsWeekId: kw, uid, parentName, childName,
    points: increment(gained),
    updatedAt: serverTimestamp(),
  }), { merge: true })
  return gained
}

// ---- Palmarès (Hall of Fame) ------------------------------------------------
export interface ChampionDoc {
  id: string
  kind: 'adult' | 'kids'
  weekLabel?: string
  endedAt?: any
  grand?: { uid: string; name: string; points: number }
  categories?: Record<string, { uid: string; name: string; points: number }>
  winner?: { uid: string; childName: string; parentName: string; points: number }
}

export async function fetchChampions(top = 12): Promise<ChampionDoc[]> {
  try {
    const q = query(collection(db, CHAMPIONS), orderBy('endedAt', 'desc'), limit(top))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
  } catch { return [] }
}
