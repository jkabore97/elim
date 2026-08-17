// Slow drift of small stars behind the whole app.
//
// Deliberately cheap: a couple of dozen absolutely-positioned dots animating
// only transform and opacity, so the compositor handles them and nothing
// repaints. Positions and timings are a fixed table rather than Math.random()
// so the field is identical on every render and can't reshuffle mid-session.
// The layer sits at z-index 0 and is aria-hidden; app content sits above it
// on z-10. Motion is switched off entirely under prefers-reduced-motion.

type Star = {
  /** left position, % */ x: number
  /** starting top, %  */ y: number
  /** px               */ size: number
  /** seconds          */ dur: number
  /** seconds          */ delay: number
  /** horizontal drift, px */ dx: number
  /** peak opacity     */ peak: number
}

const STARS: Star[] = [
  { x: 6, y: 88, size: 2, dur: 26, delay: 0, dx: 18, peak: 0.55 },
  { x: 14, y: 96, size: 3, dur: 34, delay: 4, dx: -14, peak: 0.7 },
  { x: 21, y: 82, size: 2, dur: 29, delay: 9, dx: 22, peak: 0.45 },
  { x: 28, y: 99, size: 4, dur: 38, delay: 2, dx: -10, peak: 0.8 },
  { x: 35, y: 90, size: 2, dur: 31, delay: 13, dx: 16, peak: 0.5 },
  { x: 42, y: 94, size: 3, dur: 27, delay: 6, dx: -20, peak: 0.65 },
  { x: 49, y: 86, size: 2, dur: 36, delay: 17, dx: 12, peak: 0.42 },
  { x: 56, y: 98, size: 3, dur: 30, delay: 1, dx: -16, peak: 0.68 },
  { x: 63, y: 91, size: 2, dur: 33, delay: 11, dx: 20, peak: 0.5 },
  { x: 70, y: 95, size: 4, dur: 40, delay: 7, dx: -12, peak: 0.75 },
  { x: 77, y: 84, size: 2, dur: 28, delay: 15, dx: 14, peak: 0.46 },
  { x: 84, y: 97, size: 3, dur: 35, delay: 3, dx: -18, peak: 0.62 },
  { x: 91, y: 89, size: 2, dur: 32, delay: 19, dx: 10, peak: 0.48 },
  { x: 97, y: 93, size: 3, dur: 37, delay: 8, dx: -22, peak: 0.6 },
  { x: 10, y: 70, size: 2, dur: 39, delay: 21, dx: 15, peak: 0.4 },
  { x: 25, y: 64, size: 3, dur: 42, delay: 12, dx: -13, peak: 0.55 },
  { x: 39, y: 72, size: 2, dur: 30, delay: 24, dx: 19, peak: 0.38 },
  { x: 53, y: 60, size: 2, dur: 44, delay: 5, dx: -17, peak: 0.44 },
  { x: 67, y: 68, size: 3, dur: 33, delay: 16, dx: 11, peak: 0.58 },
  { x: 81, y: 62, size: 2, dur: 41, delay: 10, dx: -15, peak: 0.4 },
  { x: 94, y: 74, size: 3, dur: 36, delay: 22, dx: 21, peak: 0.52 },
  { x: 3, y: 55, size: 2, dur: 45, delay: 14, dx: -9, peak: 0.36 },
  { x: 18, y: 48, size: 3, dur: 38, delay: 26, dx: 17, peak: 0.5 },
  { x: 46, y: 52, size: 2, dur: 43, delay: 18, dx: -21, peak: 0.34 },
  { x: 74, y: 45, size: 2, dur: 47, delay: 23, dx: 13, peak: 0.38 },
  { x: 88, y: 50, size: 3, dur: 40, delay: 28, dx: -11, peak: 0.46 },
]

export function StarField() {
  return (
    <div className="star-field" aria-hidden="true">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="star"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            animationDuration: `${s.dur}s`,
            animationDelay: `-${s.delay}s`,
            ['--star-dx' as string]: `${s.dx}px`,
            ['--star-peak' as string]: s.peak,
          }}
        />
      ))}
    </div>
  )
}
