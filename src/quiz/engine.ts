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
  kids:      { emoji: '🎈', tint: 'bg-pink-100' },
  business:  { emoji: '💼', tint: 'bg-orange-100' },
  morality:  { emoji: '⚖️', tint: 'bg-violet-100' },
}

export const QUESTIONS_PER_GAME = 10
export const DAILY_QUESTIONS = 5
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
  try {
    const mod = await loader()
    const arr = Array.isArray(mod.default) ? mod.default : []
    bankCache.set(key, arr)
    return arr
  } catch {
    // A dynamic import() can reject if the chunk was never cached while online
    // (web/PWA). Return empty rather than throwing, so the caller shows an
    // empty state instead of hanging on a spinner forever.
    return []
  }
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

// The church is in Burkina Faso (UTC+0, no DST). All competition day/week keys
// are computed in CHURCH time so every member - including the diaspora - shares
// the same day and week boundaries the server (which runs in UTC) closes on.
const CHURCH_TZ = 'Africa/Ouagadougou'
function churchYMD(d = new Date()): [number, number, number] {
  // en-CA formats as YYYY-MM-DD in the target timezone.
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  return s.split('-').map(Number) as [number, number, number]
}

export function todayKey(d = new Date()): string {
  const [y, m, day] = churchYMD(d)
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Adult competition categories - every category except Kids, which runs its
// own separate weekly league (see kidsWeekKey).
export const ADULT_CATEGORIES = QUIZ_CATEGORIES.filter(c => c !== 'kids') as Exclude<QuizCategory, 'kids'>[]

// ISO-8601 week id, e.g. "2026-W38". Adult weekly leaderboards use this
// (Monday-Sunday), computed in church time to match the server's isoWeekKey.
export function weekKey(d = new Date()): string {
  const [y, m, dd] = churchYMD(d)
  const date = new Date(Date.UTC(y, m - 1, dd))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// Kids league week id, SUNDAY-based (Sunday 00:00 -> Saturday 23:59), so the
// week closes Saturday night and the winner is known for the Sunday-school
// prize. Format "2026-K38": the year and the index of the week's Sunday.
// Computed in church time to match the server's kidsWeekKeyUTC.
export function kidsWeekKey(d = new Date()): string {
  const [y, m, dd] = churchYMD(d)
  const day = new Date(Date.UTC(y, m - 1, dd))
  // Roll back to this week's Sunday.
  day.setUTCDate(day.getUTCDate() - day.getUTCDay())
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  const week = Math.floor((day.getTime() - yearStart.getTime()) / (7 * 86400000)) + 1
  return `${day.getUTCFullYear()}-K${String(week).padStart(2, '0')}`
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
  if (bank.length) {
    return shuffle(bank).slice(0, QUESTIONS_PER_GAME).map(q => toPlay(q, cat, diff, lang, Math.random))
  }
  // No dedicated bank for this level yet: pool every difficulty the category
  // ships so the level still plays random questions. Each question keeps its
  // real difficulty, so points stay fair.
  const pools = await Promise.all(QUIZ_DIFFICULTIES.map(d => loadBank(cat, d)))
  const merged: { q: BankQuestion; d: QuizDifficulty }[] = []
  QUIZ_DIFFICULTIES.forEach((d, i) => pools[i].forEach(q => merged.push({ q, d })))
  return shuffle(merged).slice(0, QUESTIONS_PER_GAME).map(({ q, d }) => toPlay(q, cat, d, lang, Math.random))
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

// A quick random game: 10 questions drawn from every category and level the
// app ships. Powers the "continue playing" tap on the home level card.
export async function buildRandom(lang: QuizLang): Promise<PlayQuestion[]> {
  const pools = await Promise.all(
    ADULT_CATEGORIES.flatMap(cat => QUIZ_DIFFICULTIES.map(d => loadBank(cat, d).then(b => ({ cat, d, b }))))
  )
  const merged: { q: BankQuestion; cat: QuizCategory; d: QuizDifficulty }[] = []
  for (const { cat, d, b } of pools) for (const q of b) merged.push({ q, cat, d })
  return shuffle(merged).slice(0, QUESTIONS_PER_GAME).map(({ q, cat, d }) => toPlay(q, cat, d, lang, Math.random))
}

// ---- Scoring ----------------------------------------------------------------
const BASE: Record<QuizDifficulty, number> = { easy: 100, medium: 150, hard: 200 }

// Open-book quiz: every correct answer is worth its difficulty's base points.
// There is no timer and no speed or streak bonus - the point is to study with
// your Bible open and learn, not to race.
export function pointsFor(diff: QuizDifficulty): number {
  return BASE[diff]
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
  weekPoints: number        // LEARNING points this week (new questions mastered)
  // Per-day learning points, for the "top score today" push. dayId is YYYY-MM-DD.
  dayId: string
  dayPoints: number
  // Every question id the player has ever answered correctly. Used to decide
  // which answers are NEW - only new ones earn weekly/daily (learning) points,
  // so the race rewards learning more, not replaying what you already know.
  mastered: Record<string, true>
  // How many weekly championships this player has won (drives the crown).
  weeksWon: number
  updatedAt?: unknown
}

export function emptyProfile(uid: string, displayName: string, avatar?: string): QuizProfile {
  return {
    uid, displayName, avatar, points: 0, gamesPlayed: 0, answered: 0, correct: 0,
    dailyStreak: 0, badges: [], best: {}, weekId: weekKey(), weekPoints: 0,
    dayId: todayKey(), dayPoints: 0, mastered: {}, weeksWon: 0,
  }
}

export const BADGE_IDS = [
  'first_game', 'perfect', 'daily_first', 'daily_7', 'daily_30',
  'games_50', 'level_5', 'level_10',
  'master_ot', 'master_nt', 'master_parables', 'master_people', 'master_verses',
  'master_miracles', 'master_geography', 'master_kids', 'master_business', 'master_morality',
] as const
export type BadgeId = typeof BADGE_IDS[number]

export const BADGE_EMOJI: Record<BadgeId, string> = {
  first_game: '🥉', perfect: '💯', daily_first: '⭐', daily_7: '🔥', daily_30: '🏅',
  games_50: '🎯', level_5: '🥈', level_10: '👑',
  master_ot: '📜', master_nt: '✝️', master_parables: '🌾', master_people: '🧑🏿‍🤝‍🧑🏿', master_verses: '📖',
  master_miracles: '✨', master_geography: '🗺️', master_kids: '🎈', master_business: '💼', master_morality: '⚖️',
}

export interface GameResult {
  category: QuizCategory | 'daily' | 'random'
  difficulty: QuizDifficulty
  total: number
  correct: number
  points: number          // CAREER points: every correct answer (drives level)
  learningPoints: number  // points from NEW questions only (weekly/daily race)
  newIds: string[]        // question ids mastered for the first time this game
}

// Applies a finished game to the profile and returns the new profile plus
// the badges unlocked by this game. Pure - the caller persists it.
export function applyResult(p: QuizProfile, r: GameResult, day = todayKey()): { profile: QuizProfile; unlocked: BadgeId[] } {
  const wk = weekKey()
  const mastered = { ...(p.mastered || {}) }
  for (const id of r.newIds) mastered[id] = true
  const next: QuizProfile = {
    ...p,
    points: p.points + r.points,                       // career: all correct
    gamesPlayed: p.gamesPlayed + 1,
    answered: p.answered + r.total,
    correct: p.correct + r.correct,
    badges: p.badges.slice(),
    best: { ...p.best },
    mastered,
    weeksWon: p.weeksWon || 0,
    // Weekly/daily RACE counts learning points only (new questions).
    weekId: wk,
    weekPoints: (p.weekId === wk ? p.weekPoints : 0) + r.learningPoints,
    dayId: day,
    dayPoints: (p.dayId === day ? (p.dayPoints || 0) : 0) + r.learningPoints,
  }
  if (r.category !== 'daily') {
    const k = `${r.category}-${r.difficulty}`
    next.best[k] = Math.max(next.best[k] ?? 0, r.correct)
  } else if (p.lastDailyDate !== day) {
    // Daily streak: consecutive days with a completed challenge. The +50 daily
    // bonus is awarded HERE, gated to the first completion of the day, so
    // replaying the daily can't farm it (it used to be added unconditionally
    // by the caller on every daily game).
    const y = new Date(); y.setDate(y.getDate() - 1)
    next.dailyStreak = p.lastDailyDate === todayKey(y) ? p.dailyStreak + 1 : 1
    next.lastDailyDate = day
    next.points += DAILY_BONUS
  }

  const unlocked: BadgeId[] = []
  const grant = (id: BadgeId, cond: boolean) => {
    if (cond && !next.badges.includes(id)) { next.badges.push(id); unlocked.push(id) }
  }
  grant('first_game', true)
  grant('perfect', r.total >= QUESTIONS_PER_GAME && r.correct === r.total)
  grant('daily_first', r.category === 'daily')
  grant('daily_7', next.dailyStreak >= 7)
  grant('daily_30', next.dailyStreak >= 30)
  grant('games_50', next.gamesPlayed >= 50)
  grant('level_5', levelFor(next.points) >= 5)
  grant('level_10', levelFor(next.points) >= 10)
  if (r.category !== 'daily' && r.difficulty === 'hard' && r.correct >= 8) {
    grant(`master_${r.category}` as BadgeId, true)
  }
  return { profile: next, unlocked }
}
