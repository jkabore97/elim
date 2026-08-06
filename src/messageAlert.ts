// Audible/haptic alert for an incoming message.
//
// The tone is synthesised rather than loaded from an audio file: no asset to
// ship or cache, no failed network request if it's slow, and it starts
// instantly. Two short notes rather than one, because a single beep is easily
// mistaken for another app.

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    // Browsers suspend audio contexts created before any user interaction;
    // resuming here means the first alert after a tap works rather than
    // silently doing nothing.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

function tone(audio: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // Ramped rather than switched on and off - an abrupt start/stop produces an
  // audible click that sounds like a fault.
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.14, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

export function playMessageAlert() {
  try {
    const audio = getContext()
    if (audio) {
      const now = audio.currentTime
      tone(audio, 880, now, 0.12)          // A5
      tone(audio, 1174.66, now + 0.11, 0.16) // D6
    }
  } catch {
    // Audio is a nicety; never let it throw into the caller.
  }

  try {
    // Short double buzz. Silent-mode and desktop simply ignore this.
    if ('vibrate' in navigator) navigator.vibrate([40, 60, 40])
  } catch {
    // ignore
  }
}

// Muting is remembered across sessions, since someone who turns it off in a
// service does not want it back next time they open the app.
const MUTE_KEY = 'elim-mute-message-sound'

export function isAlertMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function setAlertMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* ignore */ }
}
