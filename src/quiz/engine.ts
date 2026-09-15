// Bible quiz: question bank access, game rules, scoring, levels and badges.
//
// The question bank ships INSIDE the app bundle (src/quiz/bank/*.json, one
// file per category+difficulty, loaded lazily) so playing costs nothing in
// Firestore reads and works fully offline. Only the player's progress
// (points, streaks, badges) is stored in Firestore - see store.ts.

export const QUIZ_CATEGORIES = [
  'ot', 'nt', 'parables', 'people', 'verses', 'miracles', 'geography', 'kids', 'business', 'morality',
] as const
export type QuizCategory = typeof QUIZ_CATEGORIES[number]

export const QUIZ_DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type QuizDifficulty = typeof QUIZ_DIFFICULTIES[number]

// Questions are authored in French and English only (see QUESTION_SPEC.md).
// Every other app language plays in English.
export type QuizLang = 'fr' | 'en'

export interface BankQuestion {
  id: string
  ref: { fr: string; en: string }
  fr: { q: string; options: string[]; explain: string }
  en: { q: string; options: string[]; explain: string }
}

// A question as presented to the player: options already shuffled and the
// index of the right one remembered.
export interface PlayQuestion {
  id: string
  category: QuizCategory
  difficulty: QuizDifficulty
  text: string
  options: string[]
  correct: number
  explain: string
  ref: string
}

export const CATEGORY_META: Record<QuizCategory, { emoji: string; tint: string }> = {
  ot:        { emoji: '📜', tint: 'bg-amber-100' },
  nt:        { emoji: '✝️', tint: 'bg-rose-100' },
  parables:  { emoji: '🌱', tint: 'bg-emerald-100' },
  people:    { emoji: '👑', tint: 'bg-indigo-100' },
  verses:    { emoji: '📖', tint: 'bg-sky-100' },
  miracles:  { emoji: '✨', tint: 'bg-yellow-100' },
  geography: { emoji: '🗺️', tint: 'bg-lime-100' },
  kids:      { emoji: '🧒', tint: 'bg-pink-100' },
  business:  { emoji: '💼', tint: 'bg-orange-100' },
  morality:  { emoji: '⚖️', tint: 'bg-violet-100' },
}

export const QUESTIONS_PER_GAME = 10
export const DAILY_QUESTIONS = 5
export const SECONDS_PER_QUESTION = 20
export const DAILY_BONUS = 50

// ---- Bank loading -----------------------------------------------------------
// Vite turns this into one lazy chunk per JSON file, so a game only downloads
// the ~100 questions it needs (and the browser/WebView caches the chunk).
const bankModules = import.meta.glob('./bank/*.json') as Record<string, () => Promise<{ default: BankQuestion[] }>>

export function bankAvailable(cat: QuizCategory, diff: QuizDifficulty): boolean {
  return `./bank/${cat}-${diff}.json` in bankModules
}

// How many questions a category has across all three difficulties (0 if the
// bank hasn't shipped yet). Synchronous, from the eager count map below.
export function categoryReady(cat: QuizCategory): boolean {
  return QUIZ_DIFFICULTIES.some(d => bankAvailable(cat, d))
}

const bankCache = new Map<string, BankQuestion[]>()
export async function loadBank(cat: QuizCategory, diff: QuizDifficulty): Promise<BankQuestion[]> {
  const key = `./bank/${cat}-${diff}.json`
  const hit = bankCache.get(key)
  if (hit) return hit
  const loader = bankModules[key]
  if (!loader) return []
  const mod = await loader()
  const arr = Array.isArray(mod.default) ? mod.default : []
  bankCache.set(key, arr)
  return arr
}

// ---- Random helpers ---------------------------------------------------------
// Mulberry32: a tiny seedable PRNG so the daily challenge is the SAME five
// questions for everyone on a given day (fair leaderboard) while normal games
// stay truly random.
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO-8601 week id, e.g. "2026-W38". Weekly leaderboard buckets use this.
export function weekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function toPlay(q: BankQuestion, cat: QuizCategory, diff: QuizDifficulty, lang: QuizLang, rnd: () => number): PlayQuestion {
  const L = q[lang] ?? q.en
  // options[0] is authored as the right answer; shuffle and track where it went.
  const order = shuffle([0, 1, 2, 3], rnd)
  return {
    id: q.id, category: cat, difficulty: diff,
    text: L.q,
    options: order.map(i => L.options[i]),
    correct: order.indexOf(0),
    explain: L.explain,
    ref: q.ref?.[lang] ?? q.ref?.en ?? '',
  }
}

export async function buildGame(cat: QuizCategory, diff: QuizDifficulty, lang: QuizLang): Promise<PlayQuestion[]> {
  const bank = await loadBank(cat, diff)
  return shuffle(bank).slice(0, QUESTIONS_PER_GAME).map(q => toPlay(q, cat, diff, lang, Math.random))
}

// Daily challenge: 5 questions from 5 different categories, medium
// difficulty, chosen by the date so everyone gets the same set.
export async function buildDaily(lang: QuizLang, day = todayKey()): Promise<PlayQuestion[]> {
  const seed = Array.from(day).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rnd = seeded(seed)
  // Prefer medium (the intended daily level), but fall back to whatever
  // difficulty a category actually ships so the daily works from day one.
  const pickDiff = (c: QuizCategory): QuizDifficulty | null =>
    (['medium', 'easy', 'hard'] as QuizDifficulty[]).find(d => bankAvailable(c, d)) ?? null
  const playable = QUIZ_CATEGORIES.filter(c => c !== 'kids' && pickDiff(c) !== null)
  const cats = shuffle(playable, rnd).slice(0, DAILY_QUESTIONS)
  const out: PlayQuestion[] = []
  for (const cat of cats) {
    const diff = pickDiff(cat)!
    const bank = await loadBank(cat, diff)
    if (!bank.length) continue
    const q = bank[Math.floor(rnd() * bank.length)]
    out.push(toPlay(q, cat, diff, lang, rnd))
  }
  return out
}

// Free training: 10 random questions drawn across every category that has a
// bank (easiest available tier), for untimed practice.
export async function buildMixed(lang: QuizLang): Promise<PlayQuestion[]> {
  const pickDiff = (c: QuizCategory): QuizDifficulty | null =>
    (['easy', 'medium', 'hard'] as QuizDifficulty[]).find(d => bankAvailable(c, d)) ?? null
  const pool: PlayQuestion[] = []
  for (const cat of QUIZ_CATEGORIES) {
    const diff = pickDiff(cat)
    if (!diff) continue
    const bank = await loadBank(cat, diff)
    for (const q of shuffle(bank).slice(0, 3)) pool.push(toPlay(q, cat, diff, lang, Math.random))
  }
  return shuffle(pool).slice(0, QUESTIONS_PER_GAME)
}

// ---- Scoring ----------------------------------------------------------------
const BASE: Record<QuizDifficulty, number> = { easy: 100, medium: 150, hard: 200 }

export interface AnswerScore { base: number; speed: number; streak: number; total: number }

// A right answer earns the difficulty base, up to +100 for speed (linear in
// the time left), and +25 per consecutive right answer before it (capped at
// +150) - the "Série" the results screen brags about.
export function scoreAnswer(diff: QuizDifficulty, correct: boolean, secondsLeft: number, streakBefore: number, training = false): AnswerScore {
  if (!correct) return { base: 0, speed: 0, streak: 0, total: 0 }
  const base = BASE[diff]
  // Training (no timer) earns the base only - no speed or streak bonus - so
  // the timed leaderboard stays fair while learners still progress.
  if (training) return { base, speed: 0, streak: 0, total: base }
  const speed = Math.round(100 * Math.max(0, Math.min(1, secondsLeft / SECONDS_PER_QUESTION)))
  const streak = Math.min(150, 25 * streakBefore)
  return { base, speed, streak, total: base + speed + streak }
}

export function starsFor(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (!total) return 0
  const r = correct / total
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.5 ? 1 : 0
}

// ---- Levels -----------------------------------------------------------------
// Cumulative points needed to REACH each level (index = level - 1).
export const LEVEL_THRESHOLDS = [0, 500, 1200, 2500, 4500, 7000, 10000, 14000, 19000, 25000]
export const MAX_LEVEL = LEVEL_THRESHOLDS.length

export function levelFor(points: number): number {
  let lvl = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) if (points >= LEVEL_THRESHOLDS[i]) lvl = i + 1
  return lvl
}

// Progress (0..1) from the current level's floor to the next level's floor.
export function levelProgress(points: number): { level: number; next: number | null; ratio: number } {
  const level = levelFor(points)
  if (level >= MAX_LEVEL) return { level, next: null, ratio: 1 }
  const lo = LEVEL_THRESHOLDS[level - 1], hi = LEVEL_THRESHOLDS[level]
  return { level, next: hi, ratio: Math.max(0, Math.min(1, (points - lo) / (hi - lo))) }
}

// ---- Player profile & badges ------------------------------------------------
export interface QuizProfile {
  uid: string
  displayName: string
  avatar?: string
  points: number
  gamesPlayed: number
  answered: number
  correct: number
  dailyStreak: number
  lastDailyDate?: string   // YYYY-MM-DD of the last completed daily challenge
  badges: string[]
  // Best score (right answers out of 10) per "category-difficulty".
  best: Record<string, number>
  weekId: string
  weekPoints: number
  // Per-day points, for the "top score today" push. dayId is YYYY-MM-DD.
  dayId: string
  dayPoints: number
  updatedAt?: unknown
}

export function emptyProfile(uid: string, displayName: string, avatar?: string): QuizProfile {
  return {
    uid, displayName, avatar, points: 0, gamesPlayed: 0, answered: 0, correct: 0,
    dailyStreak: 0, badges: [], best: {}, weekId: weekKey(), weekPoints: 0,
    dayId: todayKey(), dayPoints: 0,
  }
}

export const BADGE_IDS = [
  'first_game', 'perfect', 'lightning', 'daily_first', 'daily_7', 'daily_30',
  'games_50', 'level_5', 'level_10',
  'master_ot', 'master_nt', 'master_parables', 'master_people', 'master_verses',
  'master_miracles', 'master_geography', 'master_kids', 'master_business', 'master_morality',
] as const
export type BadgeId = typeof BADGE_IDS[number]

export const BADGE_EMOJI: Record<BadgeId, string> = {
  first_game: '🥉', perfect: '💯', lightning: '⚡', daily_first: '⭐', daily_7: '🔥', daily_30: '🏅',
  games_50: '🎯', level_5: '🥈', level_10: '👑',
  master_ot: '📜', master_nt: '✝️', master_parables: '🌾', master_people: '🧑‍🤝‍🧑', master_verses: '📖',
  master_miracles: '✨', master_geography: '🗺️', master_kids: '🧒', master_business: '💼', master_morality: '⚖️',
}

export interface GameResult {
  category: QuizCategory | 'daily' | 'mixed'
  difficulty: QuizDifficulty
  total: number
  correct: number
  points: number
  fastAnswers: number   // right answers given with >= 10s left
  training?: boolean    // untimed practice: no records, no speed badges
}

// Applies a finished game to the profile and returns the new profile plus
// the badges unlocked by this game. Pure - the caller persists it.
export function applyResult(p: QuizProfile, r: GameResult, day = todayKey()): { profile: QuizProfile; unlocked: BadgeId[] } {
  const wk = weekKey()
  const next: QuizProfile = {
    ...p,
    points: p.points + r.points,
    gamesPlayed: p.gamesPlayed + 1,
    answered: p.answered + r.total,
    correct: p.correct + r.correct,
    badges: p.badges.slice(),
    best: { ...p.best },
    weekId: wk,
    weekPoints: (p.weekId === wk ? p.weekPoints : 0) + r.points,
    dayId: day,
    dayPoints: (p.dayId === day ? (p.dayPoints || 0) : 0) + r.points,
  }
  if (r.category !== 'daily' && r.category !== 'mixed' && !r.training) {
    const k = `${r.category}-${r.difficulty}`
    next.best[k] = Math.max(next.best[k] ?? 0, r.correct)
  } else if (r.category === 'daily' && p.lastDailyDate !== day) {
    // Daily streak: consecutive days with a completed challenge.
    const y = new Date(); y.setDate(y.getDate() - 1)
    next.dailyStreak = p.lastDailyDate === todayKey(y) ? p.dailyStreak + 1 : 1
    next.lastDailyDate = day
  }

  const unlocked: BadgeId[] = []
  const grant = (id: BadgeId, cond: boolean) => {
    if (cond && !next.badges.includes(id)) { next.badges.push(id); unlocked.push(id) }
  }
  grant('first_game', true)
  grant('perfect', r.total >= QUESTIONS_PER_GAME && r.correct === r.total)
  grant('lightning', !r.training && r.fastAnswers >= 5)
  grant('daily_first', r.category === 'daily')
  grant('daily_7', next.dailyStreak >= 7)
  grant('daily_30', next.dailyStreak >= 30)
  grant('games_50', next.gamesPlayed >= 50)
  grant('level_5', levelFor(next.points) >= 5)
  grant('level_10', levelFor(next.points) >= 10)
  if (r.category !== 'daily' && r.category !== 'mixed' && !r.training && r.difficulty === 'hard' && r.correct >= 8) {
    grant(`master_${r.category}` as BadgeId, true)
  }
  return { profile: next, unlocked }
}
