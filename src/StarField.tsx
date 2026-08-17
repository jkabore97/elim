// Slow drift of small stars behind the whole app.
//
// Deliberately cheap: ~4 dozen absolutely-positioned dots animating
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
  { x: 1.5, y: 59.6, size: 2, dur: 39, delay: 10, dx: 23, peak: 0.85 },
  { x: 4.0, y: 90.3, size: 2, dur: 40, delay: 13, dx: 21, peak: 0.49 },
  { x: 5.2, y: 38.5, size: 2.5, dur: 25, delay: 28, dx: -18, peak: 0.75 },
  { x: 8.2, y: 89.4, size: 2.5, dur: 28, delay: 14, dx: -3, peak: 0.76 },
  { x: 8.7, y: 91.3, size: 2, dur: 43, delay: 24, dx: 12, peak: 0.48 },
  { x: 10.6, y: 63.3, size: 2, dur: 35, delay: 3, dx: 15, peak: 0.53 },
  { x: 14.1, y: 79.5, size: 2, dur: 28, delay: 1, dx: -15, peak: 0.71 },
  { x: 15.1, y: 63.3, size: 2.5, dur: 37, delay: 31, dx: -20, peak: 0.7 },
  { x: 17.9, y: 46.4, size: 3, dur: 39, delay: 9, dx: -14, peak: 0.54 },
  { x: 20.7, y: 46.3, size: 2, dur: 37, delay: 30, dx: -7, peak: 0.68 },
  { x: 21.5, y: 73.2, size: 1.5, dur: 45, delay: 24, dx: -1, peak: 0.88 },
  { x: 23.5, y: 54.5, size: 2, dur: 46, delay: 5, dx: -3, peak: 0.73 },
  { x: 25.5, y: 93.5, size: 2, dur: 24, delay: 9, dx: -16, peak: 0.67 },
  { x: 28.1, y: 50.1, size: 2.5, dur: 38, delay: 15, dx: 5, peak: 0.54 },
  { x: 30.8, y: 53.0, size: 2.5, dur: 43, delay: 16, dx: -20, peak: 0.58 },
  { x: 31.7, y: 60.5, size: 2.5, dur: 38, delay: 20, dx: 17, peak: 0.67 },
  { x: 33.7, y: 49.0, size: 2, dur: 43, delay: 19, dx: -17, peak: 0.58 },
  { x: 36.6, y: 94.6, size: 3, dur: 26, delay: 1, dx: 15, peak: 0.55 },
  { x: 38.0, y: 68.0, size: 3, dur: 36, delay: 10, dx: 9, peak: 0.55 },
  { x: 40.0, y: 92.2, size: 2, dur: 44, delay: 24, dx: 9, peak: 0.5 },
  { x: 41.9, y: 80.2, size: 3, dur: 43, delay: 32, dx: -22, peak: 0.67 },
  { x: 45.8, y: 84.8, size: 3, dur: 32, delay: 25, dx: -4, peak: 0.51 },
  { x: 47.6, y: 79.3, size: 3.5, dur: 27, delay: 8, dx: -0, peak: 0.55 },
  { x: 49.7, y: 52.3, size: 3, dur: 36, delay: 26, dx: 17, peak: 0.86 },
  { x: 50.5, y: 70.0, size: 2, dur: 42, delay: 18, dx: 22, peak: 0.6 },
  { x: 52.3, y: 79.6, size: 3.5, dur: 35, delay: 26, dx: 20, peak: 0.53 },
  { x: 54.3, y: 50.9, size: 2, dur: 28, delay: 16, dx: -23, peak: 0.55 },
  { x: 58.3, y: 40.6, size: 3.5, dur: 48, delay: 3, dx: -10, peak: 0.83 },
  { x: 60.0, y: 59.9, size: 3, dur: 41, delay: 30, dx: -2, peak: 0.8 },
  { x: 62.3, y: 51.1, size: 3, dur: 37, delay: 24, dx: 8, peak: 0.92 },
  { x: 62.8, y: 77.0, size: 3.5, dur: 47, delay: 7, dx: 7, peak: 0.88 },
  { x: 65.7, y: 81.1, size: 3, dur: 37, delay: 26, dx: -10, peak: 0.56 },
  { x: 67.9, y: 41.4, size: 2, dur: 30, delay: 4, dx: -14, peak: 0.77 },
  { x: 70.2, y: 84.9, size: 3.5, dur: 36, delay: 25, dx: -11, peak: 0.48 },
  { x: 71.8, y: 80.4, size: 3.5, dur: 46, delay: 27, dx: -24, peak: 0.49 },
  { x: 74.4, y: 46.8, size: 1.5, dur: 41, delay: 24, dx: -8, peak: 0.64 },
  { x: 75.9, y: 80.3, size: 3, dur: 43, delay: 14, dx: -11, peak: 0.59 },
  { x: 78.8, y: 78.1, size: 1.5, dur: 32, delay: 24, dx: 6, peak: 0.59 },
  { x: 80.2, y: 41.0, size: 3.5, dur: 45, delay: 17, dx: 24, peak: 0.84 },
  { x: 81.9, y: 92.3, size: 2.5, dur: 28, delay: 25, dx: 2, peak: 0.66 },
  { x: 84.3, y: 81.6, size: 2, dur: 26, delay: 0, dx: -10, peak: 0.74 },
  { x: 86.3, y: 78.5, size: 3, dur: 35, delay: 12, dx: 5, peak: 0.87 },
  { x: 87.7, y: 60.5, size: 3.5, dur: 42, delay: 16, dx: -9, peak: 0.82 },
  { x: 91.5, y: 62.4, size: 1.5, dur: 38, delay: 29, dx: -16, peak: 0.76 },
  { x: 93.7, y: 98.0, size: 3, dur: 28, delay: 26, dx: -9, peak: 0.64 },
  { x: 94.9, y: 59.5, size: 2.5, dur: 44, delay: 19, dx: 20, peak: 0.8 },
  { x: 95.9, y: 56.3, size: 3, dur: 28, delay: 14, dx: 12, peak: 0.47 },
  { x: 98.1, y: 75.9, size: 3, dur: 28, delay: 11, dx: 11, peak: 0.82 },
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
