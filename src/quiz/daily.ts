// Local record of which days the daily challenge was played, so the home screen
// can show a real streak calendar. Per-device (safeStorage) — the authoritative
// streak count + grace day live on the profile (engine.applyResult); this is the
// visual history. Also picks a gentle daily "theme" label, seeded by the date so
// everyone sees the same one (it's flavour, it doesn't change which questions
// the seeded daily draws).

import { storageGet, storageSet } from '../safeStorage'

const key = (uid: string) => `elim-daily-days-${uid}`
const MAX = 60 // keep ~two months of history

function keyToNum(k: string): number {
  const [y, m, d] = k.split('-').map(Number)
  return Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86400000)
}
function numToKey(n: number): string {
  const d = new Date(n * 86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function playedDays(uid: string): Set<string> {
  try {
    const raw = storageGet(key(uid))
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return new Set(a) }
  } catch { /* blocked/corrupt */ }
  return new Set()
}

export function recordDailyPlayed(uid: string, day: string): void {
  if (!uid || !day) return
  const set = playedDays(uid)
  if (set.has(day)) return
  set.add(day)
  const trimmed = [...set].sort().slice(-MAX)
  try { storageSet(key(uid), JSON.stringify(trimmed)) } catch { /* nothing persists */ }
}

export interface DayCell { key: string; weekday: number; played: boolean; isToday: boolean }

// The trailing 7 days ending today, oldest first — for the calendar strip.
// `streak` merges in the AUTHORITATIVE played days from the synced profile
// (lastDailyDate going back dailyStreak-1 days), so the calendar is correct even
// after a reload, a cache clear, or on another device — not only for days played
// on this device (the local set). The local set still fills in same-day plays
// instantly, before the profile round-trips.
export function weekCalendar(
  uid: string,
  todayKey: string,
  streak?: { lastDailyDate?: string; dailyStreak?: number },
): DayCell[] {
  const set = playedDays(uid)
  // Days implied by the current streak run ending at lastDailyDate.
  const streakDays = new Set<string>()
  if (streak?.lastDailyDate) {
    const last = keyToNum(streak.lastDailyDate)
    const run = Math.max(1, streak.dailyStreak || 1)
    for (let i = 0; i < run; i++) streakDays.add(numToKey(last - i))
  }
  const t = keyToNum(todayKey)
  const out: DayCell[] = []
  for (let i = 6; i >= 0; i--) {
    const k = numToKey(t - i)
    out.push({ key: k, weekday: new Date((t - i) * 86400000).getUTCDay(), played: set.has(k) || streakDays.has(k), isToday: i === 0 })
  }
  return out
}

// A deterministic daily theme label index (0..N-1), so today's flavour is the
// same for everyone. The caller maps it to a localized name.
export const DAILY_THEME_COUNT = 7
export function dailyThemeIndex(todayKey: string): number {
  let h = 7
  for (const c of todayKey) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % DAILY_THEME_COUNT
}
