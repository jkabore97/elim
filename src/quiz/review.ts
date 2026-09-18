// Spaced-repetition brain for the Bible quiz.
//
// The quiz used to hand out `shuffle(bank).slice(0, 10)` — pure random, so the
// same question could recur endlessly and a question you got WRONG was never
// deliberately brought back. This module fixes both:
//   • it remembers, per question, how you did and when to show it again, on a
//     Leitner spaced-repetition schedule (a right answer waits longer, a wrong
//     answer comes back soon), and
//   • it selects a game's questions smartly — due reviews of past mistakes
//     first, then unseen material, then whatever you've seen least recently —
//     so you almost never see a repeat until it's actually time to review it.
//
// State lives on the DEVICE (localStorage via safeStorage): no Firestore
// reads/writes, works fully offline, never slows a game. Career points,
// leaderboards and mastery stay in Firestore exactly as before.

import { storageGet, storageSet } from '../safeStorage'
import type { BankQuestion, QuizCategory, QuizDifficulty } from './engine'

// The church is in Burkina Faso (UTC+0, no DST); day boundaries are computed in
// church time so the review schedule lines up with streaks and weekly keys.
// (Kept local so this module stays free of the engine's bank-loading runtime,
// which lets the scheduling logic be unit-tested on its own.)
function todayKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Ouagadougou', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

// Leitner boxes. A correct answer promotes a question one box (longer wait); a
// wrong answer resets it to box 0 (due again now). Index = box, value = days
// until the question is due for review again.
const INTERVALS = [0, 1, 3, 7, 16, 35, 75]
const MAX_BOX = INTERVALS.length - 1
const MAX_ENTRIES = 5000

export interface QReview {
  b: number   // Leitner box (0..MAX_BOX)
  due: number // day index when this question is due for review again
  seen: number // day index it was last shown
  w: number   // times answered WRONG (ever)
  c: number   // times answered right (ever)
}
interface Store { v: 1; q: Record<string, QReview> }

// Whole days since the Unix epoch, computed from the church-time day key so it
// lines up with everything else (streaks, weekly keys).
export function dayIndex(key: string = todayKey()): number {
  const [y, m, d] = key.split('-').map(Number)
  return Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86400000)
}

const storeKey = (uid: string) => `elim-quiz-review-${uid}`

function load(uid: string): Store {
  try {
    const raw = storageGet(storeKey(uid))
    if (raw) {
      const o = JSON.parse(raw)
      if (o && o.q && typeof o.q === 'object') return { v: 1, q: o.q }
    }
  } catch { /* corrupt or blocked storage: start fresh */ }
  return { v: 1, q: {} }
}

function persist(uid: string, s: Store): void {
  // Keep the store bounded. When it grows past the cap, drop the most
  // "finished" cards first — highest box, never missed, seen longest ago —
  // since they're the least useful to keep scheduling.
  const ids = Object.keys(s.q)
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => {
      const A = s.q[a], B = s.q[b]
      return (A.w - B.w) || (B.b - A.b) || (A.seen - B.seen)
    })
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete s.q[id]
  }
  try { storageSet(storeKey(uid), JSON.stringify(s)) } catch { /* blocked: still works this session */ }
}

// Record one answer. Correct → promote a box and push the due date out; wrong
// → reset to box 0 so it comes back soon. Called for every adult answer.
export function recordAnswer(uid: string, qid: string, correct: boolean, today = dayIndex()): void {
  if (!uid || !qid) return
  const s = load(uid)
  const cur: QReview = s.q[qid] || { b: 0, due: today, seen: -9999, w: 0, c: 0 }
  if (correct) { cur.b = Math.min(cur.b + 1, MAX_BOX); cur.c += 1 }
  else { cur.b = 0; cur.w += 1 }
  cur.due = today + INTERVALS[cur.b]
  cur.seen = today
  s.q[qid] = cur
  persist(uid, s)
}

export interface ReviewSummary {
  due: number      // questions due for review right now (not already seen today)
  missed: number   // of those, ones the player has actually gotten wrong before
  learning: number // questions still being learned (missed and not yet mastered)
}

// A cheap snapshot for the home screen. The explicit Review action is allowed
// same-day (drill today's mistakes now), so this counts everything currently
// due - unlike normal games, which avoid same-day repeats (see priority()).
export function reviewSummary(uid: string, today = dayIndex()): ReviewSummary {
  const s = load(uid)
  let due = 0, missed = 0, learning = 0
  for (const id in s.q) {
    const r = s.q[id]
    if (r.w > 0 && r.b <= 2) learning++
    if (r.due <= today) { due++; if (r.w > 0) missed++ }
  }
  return { due, missed, learning }
}

function shuffled<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// How forgotten a due card is — higher = show sooner. Overdue relative to the
// last interval (a recall proxy), with missed cards weighted up. This ranks the
// review pool so the questions you're closest to forgetting come first.
function forgottenness(r: QReview, today: number): number {
  const interval = Math.max(1, r.due - r.seen)
  return (today - r.due) / interval + (r.w > 0 ? 2 : 0)
}

// Compose a round of `n` from one category's bank: the blueprint's adaptive
// 5-due / 3-new / 2-stretch mix, then fill leftover slots in learning order.
// Capping "due" at ~half means new material still appears even when a lot is
// overdue, and when you're caught up the round leans to new + stretch.
export function pickForCategory(bank: BankQuestion[], uid: string, n: number, today = dayIndex()): BankQuestion[] {
  if (bank.length <= n) return shuffled(bank)
  const s = load(uid)
  const due: { q: BankQuestion; k: number }[] = []
  const unseen: BankQuestion[] = []
  const rest: { q: BankQuestion; seen: number }[] = []
  const seenToday: BankQuestion[] = []
  for (const q of bank) {
    const r = s.q[q.id]
    if (!r) { unseen.push(q); continue }
    if (r.seen >= today) { seenToday.push(q); continue }   // avoid same-day repeats
    if (r.due <= today) due.push({ q, k: forgottenness(r, today) })
    else rest.push({ q, seen: r.seen })
  }
  const dueQ = due.sort((a, b) => b.k - a.k).map(d => d.q)          // most forgotten first
  const newQ = shuffled(unseen)
  const stretchQ = rest.sort((a, b) => a.seen - b.seen).map(d => d.q) // least-recently-seen

  const DUE = 5, NEW = 3, STRETCH = 2
  const out: BankQuestion[] = []
  const take = (pool: BankQuestion[], k: number) => {
    for (const q of pool) { if (out.length >= n || k <= 0) break; if (!out.includes(q)) { out.push(q); k-- } }
  }
  take(dueQ, DUE); take(newQ, NEW); take(stretchQ, STRETCH)
  // Fill any remaining slots from the deeper pools, learning-priority order.
  for (const pool of [dueQ, newQ, stretchQ, seenToday]) { take(pool, n - out.length); if (out.length >= n) break }
  return out.slice(0, n)
}

export interface DueItem { cat: QuizCategory; diff: QuizDifficulty; q: BankQuestion }

// Build a cross-category "review what you missed" round: only questions that
// are due, mistakes first then most overdue. Returns [] when nothing is due
// (the caller tells the player they're caught up).
export function pickReview(pool: DueItem[], uid: string, n: number, today = dayIndex()): DueItem[] {
  const s = load(uid)
  const due = pool.filter(it => {
    const r = s.q[it.q.id]
    return r && r.due <= today
  })
  due.sort((a, b) => {
    const A = s.q[a.q.id]!, B = s.q[b.q.id]!
    return ((B.w > 0 ? 1 : 0) - (A.w > 0 ? 1 : 0)) || (A.due - B.due) || (Math.random() - 0.5)
  })
  return due.slice(0, n)
}
