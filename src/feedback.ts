// One feedback service for the whole app: short synthesised earcons + haptics,
// spent by MEANING through a single gate. The failure mode of app sound is a
// noise per feature until people mute everything; here every cue passes one
// gate (master switch · per-channel setting · quiet hours · Sunday-service
// mute) before it can play, and the palette is one warm mallet in C-major
// pentatonic so success rises and resolves while a mistake falls gently — never
// a shaming buzzer (this matters most for children).
//
// No audio assets (synthesised on the Web Audio API, starts instantly, nothing
// to cache) and no native dependency (haptics via navigator.vibrate, which the
// Android WebView honours; desktop/iOS silently ignore it).

import { storageGet, storageSet } from './safeStorage'

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

// ---- Synthesis --------------------------------------------------------------
let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch { return null }
}
// A soft mallet note with a click-free ramp and exponential decay.
function note(a: AudioContext, freq: number, at: number, dur: number, peak = 0.16) {
  const osc = a.createOscillator(), gain = a.createGain()
  osc.type = 'triangle'; osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(peak, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0008, at + dur)
  osc.connect(gain); gain.connect(a.destination)
  osc.start(at); osc.stop(at + dur + 0.03)
}
// C-major pentatonic across two octaves.
const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 }

type Event =
  | 'quiz.correct' | 'quiz.wrong' | 'quiz.retry' | 'quiz.levelup' | 'quiz.result'
  | 'message' | 'announce' | 'tick'

// event → [channel, notes[freq,delay,dur], haptic pattern]
function spec(e: Event): { ch: SoundChannel; seq: [number, number, number][]; buzz: number[] } {
  switch (e) {
    case 'quiz.correct': return { ch: 'quiz', seq: [[N.E5, 0, .1], [N.G5, .07, .1], [N.C6, .14, .16]], buzz: [15] }
    case 'quiz.wrong':   return { ch: 'quiz', seq: [[N.G5, 0, .14], [N.E5, .12, .2]], buzz: [26, 40, 26] }
    case 'quiz.retry':   return { ch: 'quiz', seq: [[N.D5, 0, .12]], buzz: [18] }
    case 'quiz.levelup': return { ch: 'quiz', seq: [[N.C5, 0, .1], [N.E5, .09, .1], [N.G5, .18, .1], [N.C6, .27, .26]], buzz: [15, 45, 15, 45, 25] }
    case 'quiz.result':  return { ch: 'quiz', seq: [[N.C5, 0, .3], [N.E5, 0, .3], [N.G5, 0, .34], [N.C6, .12, .34]], buzz: [20] }
    case 'message':      return { ch: 'messages', seq: [[N.E5, 0, .12], [N.A5, .1, .18]], buzz: [40, 60, 40] }
    case 'announce':     return { ch: 'announcements', seq: [[N.A5, 0, .5]], buzz: [30] }
    case 'tick':         return { ch: 'social', seq: [[N.C6, 0, .05]], buzz: [12] }
  }
}

let last = 0
export function emit(e: Event): void {
  const now = Date.now()
  if (now - last < 60) return   // debounce a flood into one cue
  last = now
  const { ch, seq, buzz } = spec(e)
  if (allow(ch, 'sound')) {
    try { const a = audio(); if (a) { const t = a.currentTime; for (const [f, d, dur] of seq) note(a, f, t + d, dur) } } catch { /* audio is a nicety */ }
  }
  if (allow(ch, 'haptic')) {
    try { if ('vibrate' in navigator) navigator.vibrate(buzz) } catch { /* ignore */ }
  }
}
