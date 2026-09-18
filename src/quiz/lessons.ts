// The "Parcours" (path) — a finishable campaign layered over the same bank as
// the spaced-repetition engine. A category has three levels; each level is cut
// into LESSONS of five questions; a lesson is completed, a level fills up, and
// finishing a level unlocks the next.
//
// COMPLETION IS DERIVED, NOT A NEW SCORE. A lesson counts as passed when every
// one of its questions is already in the player's `mastered` map (answered
// right at least once — data that already exists), OR when the player scored
// 4/5+ on it in one go (a local flag). Nothing here writes to points, weekly
// races, badges or the Palmarès — it only reads `mastered` and keeps a small
// local star/pass record. So long-time players open the feature already partway
// done, and turning it off changes no score.

import { storageGet, storageSet } from '../safeStorage'
import type { BankQuestion, QuizCategory, QuizDifficulty } from './engine'

export const LESSON_SIZE = 5
export const PASS_RATIO = 0.8 // 4 of 5 in a single attempt marks a lesson passed

// Same thresholds as engine.starsFor, inlined so this module carries no runtime
// dependency on the engine's bank loader (keeps the logic unit-testable).
function stars(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (!total) return 0
  const r = correct / total
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.5 ? 1 : 0
}

// Deterministic, STABLE partition of a level's bank into lessons of five,
// ordered by question id — so "lesson 3" is always the same five questions and
// "completed" stays meaningful as the bank grows.
export function lessonsOf(bank: BankQuestion[]): BankQuestion[][] {
  const sorted = bank.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out: BankQuestion[][] = []
  for (let i = 0; i < sorted.length; i += LESSON_SIZE) out.push(sorted.slice(i, i + LESSON_SIZE))
  return out
}

export function lessonId(cat: QuizCategory, diff: QuizDifficulty, index: number): string {
  return `${cat}-${diff}-${index}`
}

// ---- Local star / pass record (cosmetic; completion also derives from mastered)
interface LState { s: number; p: boolean } // best stars 0..3, locally-passed (≥4/5 once)
const key = (uid: string) => `elim-quiz-lessons-${uid}`

function loadAll(uid: string): Record<string, LState> {
  try {
    const raw = storageGet(key(uid))
    if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') return o }
  } catch { /* blocked/corrupt */ }
  return {}
}

export function recordLessonResult(uid: string, id: string, correct: number, total: number): void {
  if (!uid || !id || !total) return
  const all = loadAll(uid)
  const cur = all[id] || { s: 0, p: false }
  const next: LState = { s: Math.max(cur.s, stars(correct, total)), p: cur.p || correct / total >= PASS_RATIO }
  all[id] = next
  try { storageSet(key(uid), JSON.stringify(all)) } catch { /* nothing persists this session */ }
}

export function lessonStars(uid: string, id: string): number {
  return loadAll(uid)[id]?.s || 0
}

// ---- Completion & unlock (derive from `mastered`, plus the local pass flag) ---
export function lessonPassed(
  lesson: BankQuestion[], mastered: Record<string, true> | undefined,
  uid?: string, id?: string,
): boolean {
  if (!lesson.length) return false
  const m = mastered || {}
  if (lesson.every(q => m[q.id])) return true          // every question mastered
  if (uid && id) return !!loadAll(uid)[id]?.p           // or passed 4/5 locally
  return false
}

export interface LevelState {
  lessons: BankQuestion[][]
  passed: number   // lessons completed
  total: number    // lessons in the level
  complete: boolean
}

export function levelState(
  bank: BankQuestion[], mastered: Record<string, true> | undefined,
  cat: QuizCategory, diff: QuizDifficulty, uid?: string,
): LevelState {
  const lessons = lessonsOf(bank)
  const passed = lessons.reduce(
    (n, l, i) => n + (lessonPassed(l, mastered, uid, lessonId(cat, diff, i)) ? 1 : 0), 0)
  return { lessons, passed, total: lessons.length, complete: lessons.length > 0 && passed === lessons.length }
}

// Easy is always open; each further level unlocks when the previous is complete.
export function levelUnlocked(
  diff: QuizDifficulty,
  complete: Record<QuizDifficulty, boolean>,
): boolean {
  if (diff === 'easy') return true
  if (diff === 'medium') return !!complete.easy
  return !!complete.medium
}
