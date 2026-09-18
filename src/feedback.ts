// One feedback service for the whole app: rich synthesised sounds + haptics,
// spent by MEANING through a single gate. Every cue passes one gate (master ·
// per-channel setting · quiet hours · Sunday-service mute) before it can play.
// The actual sounds come from a 20-strong library (quiz/soundlib.ts); which
// sound fires for each quiz event is admin-configurable (config/quizSounds),
// so the church can pick the feel they want.
//
// No audio assets (synthesised on the Web Audio API, instant) and no native
// dependency (haptics via navigator.vibrate, honoured by the Android WebView).

import { storageGet, storageSet } from './safeStorage'
import { playSound } from './quiz/soundlib'

// ---- Settings ---------------------------------------------------------------
export type SoundChannel = 'quiz' | 'messages' | 'announcements' | 'social'
export interface SoundSettings {
  master: boolean
  haptics: boolean
  channels: Record<SoundChannel, boolean>
  quietEnabled: boolean
  quietFrom: string   // 'HH:MM' church time
  quietTo: string     // 'HH:MM' church time
  serviceMute: boolean
}

const KEY = 'elim-sound-settings'
const DEFAULTS: SoundSettings = {
  master: true,
  haptics: true,
  // Social (likes/comments) is silent by default — it's the constant action;
  // sound there would desensitise everything else. Learning + being reached ring.
  channels: { quiz: true, messages: true, announcements: true, social: false },
  quietEnabled: true,
  quietFrom: '22:00',
  quietTo: '06:00',
  serviceMute: true,
}

export function getSoundSettings(): SoundSettings {
  try {
    const raw = storageGet(KEY)
    if (raw) { const o = JSON.parse(raw); return { ...DEFAULTS, ...o, channels: { ...DEFAULTS.channels, ...(o.channels || {}) } } }
  } catch { /* corrupt/blocked */ }
  return { ...DEFAULTS }
}

export function setSoundSettings(patch: Partial<SoundSettings>): SoundSettings {
  const next = { ...getSoundSettings(), ...patch }
  try { storageSet(KEY, JSON.stringify(next)) } catch { /* nothing persists */ }
  return next
}

// ---- The gate (church-time aware) -------------------------------------------
function churchNow(): { hm: number; dow: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Ouagadougou', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(new Date())
    const h = Number(parts.find(p => p.type === 'hour')?.value || 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value || 0)
    const wd = parts.find(p => p.type === 'weekday')?.value || ''
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
    return { hm: h * 60 + m, dow }
  } catch { return { hm: 12 * 60, dow: 1 } }
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

function inQuietHours(s: SoundSettings): boolean {
  if (!s.quietEnabled) return false
  const { hm } = churchNow(), from = toMin(s.quietFrom), to = toMin(s.quietTo)
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to // wraps midnight
}
// Sunday service window (church time): Sun 08:00–11:00.
function inService(s: SoundSettings): boolean {
  if (!s.serviceMute) return false
  const { hm, dow } = churchNow()
  return dow === 0 && hm >= 8 * 60 && hm < 11 * 60
}

function allow(channel: SoundChannel, kind: 'sound' | 'haptic'): boolean {
  const s = getSoundSettings()
  if (!s.master) return false
  if (inService(s)) return false                 // service silences both
  if (kind === 'haptic') return s.haptics        // haptics OK at night (a DM buzz)
  if (inQuietHours(s)) return false              // quiet hours silence sound
  return !!s.channels[channel]
}

// ---- Events → channel, sound, haptics --------------------------------------
export type QuizEvent = 'quiz.correct' | 'quiz.wrong' | 'quiz.retry' | 'quiz.levelup' | 'quiz.result'
type Event = QuizEvent | 'message' | 'announce' | 'tick'
export const QUIZ_EVENTS: QuizEvent[] = ['quiz.correct', 'quiz.wrong', 'quiz.retry', 'quiz.levelup', 'quiz.result']

const CHANNEL: Record<Event, SoundChannel> = {
  'quiz.correct': 'quiz', 'quiz.wrong': 'quiz', 'quiz.retry': 'quiz', 'quiz.levelup': 'quiz', 'quiz.result': 'quiz',
  message: 'messages', announce: 'announcements', tick: 'social',
}
const BUZZ: Record<Event, number[]> = {
  'quiz.correct': [15], 'quiz.wrong': [26, 40, 26], 'quiz.retry': [18],
  'quiz.levelup': [15, 45, 15, 45, 25], 'quiz.result': [20],
  message: [40, 60, 40], announce: [30], tick: [12],
}
// Which library sound fires for each event. Non-quiz events are fixed; quiz
// events default here but the admin can reassign them (config/quizSounds).
const DEFAULT_SOUND: Record<Event, string> = {
  'quiz.correct': 'powerup', 'quiz.wrong': 'softdown', 'quiz.retry': 'bloop',
  'quiz.levelup': 'epicwin', 'quiz.result': 'fanfare',
  message: 'ding', announce: 'bell', tick: 'tick',
}

// The admin's chosen quiz sounds, cached locally so they apply instantly and
// offline; App keeps this in sync with config/quizSounds.
const MAP_KEY = 'elim-quiz-sound-map'
let quizMap: Partial<Record<QuizEvent, string>> = (() => {
  try { const o = JSON.parse(storageGet(MAP_KEY) || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} }
})()

export function setEventSounds(map: Partial<Record<QuizEvent, string>>): void {
  quizMap = { ...quizMap, ...map }
  try { storageSet(MAP_KEY, JSON.stringify(quizMap)) } catch { /* ignore */ }
}
export function getEventSound(e: QuizEvent): string {
  return quizMap[e] || DEFAULT_SOUND[e]
}

let last = 0
export function emit(e: Event): void {
  const now = Date.now()
  if (now - last < 60) return   // debounce a flood into one cue
  last = now
  const ch = CHANNEL[e]
  const soundId = (e.startsWith('quiz.') ? quizMap[e as QuizEvent] : undefined) || DEFAULT_SOUND[e]
  if (allow(ch, 'sound')) playSound(soundId)
  if (allow(ch, 'haptic')) { try { if ('vibrate' in navigator) navigator.vibrate(BUZZ[e]) } catch { /* ignore */ } }
}
