// A library of 20 synthesised game sounds. Everything is generated on the Web
// Audio API (no assets to ship or cache, instant), through one shared bus with
// a light global "space" (a short feedback delay) so the set feels cohesive and
// punchy rather than like bare beeps. Each sound is a small scheduler of
// oscillators, filtered-noise bursts and envelopes. `playSound(id)` plays one;
// the admin picks which id fires for each quiz event (see feedback.ts).

let actx: AudioContext | null = null
let bus: GainNode | null = null

function ensure(): { a: AudioContext; bus: GainNode } | null {
  try {
    if (!actx) {
      actx = new (window.AudioContext || (window as any).webkitAudioContext)()
      bus = actx.createGain(); bus.gain.value = 0.85
      const comp = actx.createDynamicsCompressor()
      comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25
      const delay = actx.createDelay(1); delay.delayTime.value = 0.11
      const fb = actx.createGain(); fb.gain.value = 0.22
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600
      const wet = actx.createGain(); wet.gain.value = 0.5
      bus.connect(comp); comp.connect(actx.destination)          // dry
      bus.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay) // echo tail
      lp.connect(wet); wet.connect(comp)                          // wet into output
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {})
    return { a: actx!, bus: bus! }
  } catch { return null }
}

// A single note with a click-free attack and exponential decay; optional glide.
function tone(a: AudioContext, out: AudioNode, o: {
  type?: OscillatorType; f: number; f2?: number; t: number; dur: number; peak?: number; detune?: number
}) {
  const osc = a.createOscillator(), g = a.createGain()
  osc.type = o.type || 'sine'
  osc.frequency.setValueAtTime(o.f, o.t)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), o.t + o.dur)
  if (o.detune) osc.detune.value = o.detune
  const peak = o.peak ?? 0.2
  g.gain.setValueAtTime(0.0001, o.t)
  g.gain.exponentialRampToValueAtTime(peak, o.t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0008, o.t + o.dur)
  osc.connect(g); g.connect(out); osc.start(o.t); osc.stop(o.t + o.dur + 0.03)
}

// A filtered noise burst — percussion, sparkle, whoosh.
function noise(a: AudioContext, out: AudioNode, o: { t: number; dur: number; peak?: number; hp?: number; lp?: number }) {
  const n = a.createBufferSource()
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * o.dur)), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  n.buffer = buf
  let node: AudioNode = n
  if (o.hp) { const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node.connect(f); node = f }
  if (o.lp) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f }
  const g = a.createGain()
  g.gain.setValueAtTime(o.peak ?? 0.2, o.t)
  g.gain.exponentialRampToValueAtTime(0.0006, o.t + o.dur)
  node.connect(g); g.connect(out); n.start(o.t); n.stop(o.t + o.dur + 0.02)
}

// C-major pentatonic across octaves, plus a couple of extras.
const P = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568 }

type Gen = (a: AudioContext, out: AudioNode, t: number) => void

// ---- The 20 sounds ----------------------------------------------------------
const SOUNDS: Record<string, { name: string; play: Gen }> = {
  powerup:  { name: 'Power-up',        play: (a, o, t) => { [P.C5, P.E5, P.G5, P.C6].forEach((f, i) => tone(a, o, { type: 'square', f, t: t + i * .06, dur: .12, peak: .16 })) } },
  epicwin:  { name: 'Epic win',        play: (a, o, t) => { tone(a, o, { type: 'sine', f: P.C4 / 2, f2: P.C4, t, dur: .5, peak: .18 }); [P.C5, P.E5, P.G5].forEach(f => tone(a, o, { type: 'sawtooth', f, t: t + .04, dur: .55, peak: .1 })); [P.C6, P.E6, P.G6].forEach((f, i) => tone(a, o, { type: 'triangle', f, t: t + .18 + i * .07, dur: .4, peak: .12 })); noise(a, o, { t: t + .16, dur: .5, peak: .05, hp: 5000 }) } },
  fanfare:  { name: 'Fanfare',         play: (a, o, t) => { [[P.G4, 0], [P.C5, .1], [P.E5, .2], [P.G5, .3]].forEach(([f, d]) => tone(a, o, { type: 'sawtooth', f, t: t + d, dur: .4, peak: .12 })); tone(a, o, { type: 'square', f: P.C6, t: t + .3, dur: .5, peak: .1 }) } },
  coin:     { name: 'Arcade coin',     play: (a, o, t) => { tone(a, o, { type: 'square', f: P.A5, t, dur: .07, peak: .18 }); tone(a, o, { type: 'square', f: P.E6, t: t + .07, dur: .22, peak: .18 }) } },
  chime:    { name: 'Chime',           play: (a, o, t) => { [P.C5, P.E5, P.G5].forEach((f, i) => tone(a, o, { type: 'sine', f, t: t + i * .09, dur: .5, peak: .18 })) } },
  sparkle:  { name: 'Sparkle',         play: (a, o, t) => { for (let i = 0; i < 6; i++) tone(a, o, { type: 'sine', f: P.C6 + Math.random() * 600, t: t + i * .045, dur: .18, peak: .1 }); noise(a, o, { t, dur: .3, peak: .04, hp: 6000 }) } },
  bell:     { name: 'Bell',            play: (a, o, t) => { tone(a, o, { type: 'sine', f: P.C5, t, dur: .8, peak: .2 }); tone(a, o, { type: 'sine', f: P.C5 * 2.76, t, dur: .5, peak: .06 }); tone(a, o, { type: 'sine', f: P.C5 * 5.4, t, dur: .3, peak: .03 }) } },
  marimba:  { name: 'Marimba run',     play: (a, o, t) => { [P.C5, P.E5, P.G5, P.C6].forEach((f, i) => tone(a, o, { type: 'triangle', f, t: t + i * .07, dur: .22, peak: .2 })) } },
  harp:     { name: 'Harp glide',      play: (a, o, t) => { [P.C4, P.E4, P.G4, P.C5, P.E5, P.G5, P.C6].forEach((f, i) => tone(a, o, { type: 'triangle', f, t: t + i * .035, dur: .5, peak: .12 })) } },
  ding:     { name: 'Ding',            play: (a, o, t) => { tone(a, o, { type: 'sine', f: P.E5, t, dur: .14, peak: .2 }); tone(a, o, { type: 'sine', f: P.A5, t: t + .1, dur: .3, peak: .2 }) } },
  whoosh:   { name: 'Whoosh up',       play: (a, o, t) => { noise(a, o, { t, dur: .35, peak: .16, hp: 400, lp: 6000 }); tone(a, o, { type: 'sine', f: 200, f2: 1400, t, dur: .35, peak: .08 }) } },
  laser:    { name: 'Laser',           play: (a, o, t) => { tone(a, o, { type: 'sawtooth', f: 1400, f2: 200, t, dur: .28, peak: .16 }) } },
  bloop:    { name: 'Bloop',           play: (a, o, t) => { tone(a, o, { type: 'sine', f: 300, f2: 700, t, dur: .16, peak: .2 }) } },
  pop:      { name: 'Pop',             play: (a, o, t) => { tone(a, o, { type: 'sine', f: 900, f2: 400, t, dur: .09, peak: .22 }) } },
  tick:     { name: 'Tick',            play: (a, o, t) => { noise(a, o, { t, dur: .04, peak: .18, hp: 2000 }) } },
  orchhit:  { name: 'Orchestra hit',   play: (a, o, t) => { [P.C4, P.C4 * 1.5, P.C5].forEach(f => tone(a, o, { type: 'sawtooth', f, t, dur: .4, peak: .12 })); noise(a, o, { t, dur: .25, peak: .12, lp: 3000 }) } },
  softdown: { name: 'Soft down',       play: (a, o, t) => { tone(a, o, { type: 'sine', f: P.G5, t, dur: .16, peak: .16 }); tone(a, o, { type: 'sine', f: P.E5, t: t + .12, dur: .3, peak: .16 }) } },
  wobble:   { name: 'Wobble down',     play: (a, o, t) => { tone(a, o, { type: 'triangle', f: 520, f2: 300, t, dur: .4, peak: .16, detune: -20 }) } },
  buzzsoft: { name: 'Soft buzz',       play: (a, o, t) => { tone(a, o, { type: 'sawtooth', f: 190, t, dur: .22, peak: .12 }); tone(a, o, { type: 'sawtooth', f: 196, t, dur: .22, peak: .1 }) } },
  thud:     { name: 'Thud',            play: (a, o, t) => { tone(a, o, { type: 'sine', f: 160, f2: 70, t, dur: .3, peak: .24 }); noise(a, o, { t, dur: .12, peak: .06, lp: 500 }) } },
}

export const SOUND_IDS = Object.keys(SOUNDS)
export const SOUND_NAMES: Record<string, string> = Object.fromEntries(SOUND_IDS.map(id => [id, SOUNDS[id].name]))

export function playSound(id: string): void {
  const e = ensure(); if (!e) return
  const s = SOUNDS[id]; if (!s) return
  try { s.play(e.a, e.bus, e.a.currentTime + 0.001) } catch { /* audio is a nicety */ }
}
