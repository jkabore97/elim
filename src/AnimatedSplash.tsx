import { useEffect, useState } from 'react'

// Animated intro shown once per launch, before the welcome screen.
// Built as an in-app React animation rather than a second native splash
// image: Capacitor's native splash already covers the cold-start gap, and
// layering a static image on top produces a visible double-flash. This picks
// up where the native one leaves off so it reads as one continuous motion.
//
// Warm orange theme to match the rest of the app: an orange dawn rising from
// below, the mark floating in breathing orange halos, an orange-gradient
// wordmark and drifting motes. Follows the phone into dark mode via .splash-bg.
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 1300)
    const t2 = setTimeout(() => setPhase('exit'), 2600)
    const t3 = setTimeout(onDone, 3200)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  const shown = phase !== 'enter'

  return (
    <div
      className={`splash-bg fixed inset-0 z-[100] overflow-hidden flex flex-col items-center justify-center transition-opacity duration-600 ${
        phase === 'exit' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Orange horizon glow rising under the mark */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full blur-3xl transition-all duration-[2200ms] ease-out"
        style={{
          bottom: shown ? '-14%' : '-30%',
          width: 620, height: 380,
          background: 'radial-gradient(circle, rgba(249,115,22,0.38) 0%, rgba(245,200,120,0.16) 45%, transparent 72%)',
          opacity: shown ? 1 : 0
        }}
      />
      {/* Soft counter-light from above, so the mark sits between two sources */}
      <div className="absolute top-[-10%] left-1/4 w-[460px] h-[460px] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(251,146,60,0.24) 0%, transparent 70%)' }} />

      {/* Drifting motes of light */}
      {[
        { l: '18%', d: 0, s: 3, dur: 7 }, { l: '31%', d: 1.4, s: 2, dur: 9 },
        { l: '47%', d: 0.6, s: 2.5, dur: 8 }, { l: '63%', d: 2.1, s: 3, dur: 10 },
        { l: '78%', d: 1.1, s: 2, dur: 8.5 }, { l: '88%', d: 2.6, s: 2.5, dur: 9.5 }
      ].map((p, i) => (
        <span key={i}
          className="absolute rounded-full"
          style={{
            left: p.l, width: p.s, height: p.s,
            background: 'rgba(249,115,22,0.55)',
            animation: `rise ${p.dur}s ease-in-out ${p.d}s infinite`,
            opacity: 0
          }} />
      ))}

      <div className="relative flex flex-col items-center px-8">
        {/* Halo rings breathing outward behind the mark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="absolute w-44 h-44 rounded-full border border-affirm-400/35"
            style={{ animation: 'halo 3.4s ease-out infinite' }} />
          <span className="absolute w-44 h-44 rounded-full border border-affirm-300/30"
            style={{ animation: 'halo 3.4s ease-out 1.1s infinite' }} />
          <span className="absolute w-44 h-44 rounded-full border border-amber-300/25"
            style={{ animation: 'halo 3.4s ease-out 2.2s infinite' }} />
        </div>

        <img
          src="/elim-logo-mark.png"
          alt="ELIM"
          className="relative w-32 h-32 object-contain transition-all duration-[1400ms] ease-out"
          style={{
            transform: shown ? 'scale(1) translateY(0)' : 'scale(0.72) translateY(10px)',
            opacity: shown ? 1 : 0,
            filter: 'drop-shadow(0 6px 20px rgba(124,45,18,0.24)) drop-shadow(0 0 42px rgba(249,115,22,0.28))'
          }}
        />

        <h1
          className="mt-8 text-[2.6rem] leading-none font-extrabold tracking-[0.16em] transition-all duration-1000 ease-out"
          style={{
            transform: shown ? 'translateY(0)' : 'translateY(16px)',
            opacity: shown ? 1 : 0,
            transitionDelay: '280ms',
            background: 'linear-gradient(180deg, #c2410c 0%, #f97316 55%, #ea580c 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          ELIM
        </h1>

        {/* Hairline divider that draws itself open */}
        <div className="mt-5 h-px bg-gradient-to-r from-transparent via-affirm-400/55 to-transparent transition-all duration-1000 ease-out"
          style={{ width: shown ? 200 : 0, opacity: shown ? 1 : 0, transitionDelay: '620ms' }} />

        <p
          className="mt-5 text-center text-[12.5px] leading-relaxed text-slate-600 max-w-[19rem] transition-all duration-1000 ease-out"
          style={{
            transform: shown ? 'translateY(0)' : 'translateY(12px)',
            opacity: shown ? 1 : 0,
            transitionDelay: '780ms'
          }}
        >
          Centre Chrétien d'Enseignement, de Libéralité,<br />d'Intercession et de Moisson
        </p>
      </div>

      <p className="absolute bottom-8 text-[10px] text-slate-400 transition-opacity duration-700"
        style={{ opacity: shown ? 1 : 0, transitionDelay: '1000ms' }}>
        © {new Date().getFullYear()} Centre Chrétien E.L.I.M.
      </p>

      <style>{`
        @keyframes halo {
          0%   { transform: scale(0.85); opacity: 0.6; }
          70%  { opacity: 0.12; }
          100% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes rise {
          0%   { transform: translateY(0) scale(1); opacity: 0; }
          15%  { opacity: 0.7; }
          85%  { opacity: 0.5; }
          100% { transform: translateY(-58vh) scale(0.45); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
