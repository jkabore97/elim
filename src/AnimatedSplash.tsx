import { useEffect, useState } from 'react'

// Animated intro shown once per app launch, before the welcome/auth screen.
// Deliberately built as an in-app React animation rather than a second
// native splash image: Capacitor's native splash already covers the cold-
// start gap, and layering another static image on top of it produces a
// visible double-flash. This picks up exactly where the native one leaves
// off, so it reads as one continuous motion.
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 1100)
    const t2 = setTimeout(() => setPhase('exit'), 2100)
    const t3 = setTimeout(onDone, 2700)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  return (
    <div
      className={`fixed inset-0 z-[100] bg-[#0a0e1a] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-500 ${
        phase === 'exit' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Ambient glows, matching the rest of the app's dark theme */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-emerald-500/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-amber-500/15 rounded-full blur-3xl animate-pulse" />

      <div className="relative flex flex-col items-center">
        {/* Expanding rings behind the logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="absolute w-40 h-40 rounded-full border border-emerald-400/30 animate-ping" style={{ animationDuration: '2s' }} />
          <span className="absolute w-56 h-56 rounded-full border border-emerald-400/15 animate-ping" style={{ animationDuration: '2.4s', animationDelay: '0.3s' }} />
        </div>

        <img
          src="/elim-logo-mark.png"
          alt="ELIM"
          className="relative w-28 h-28 object-contain transition-all duration-1000 ease-out"
          style={{
            transform: phase === 'enter' ? 'scale(0.6)' : 'scale(1)',
            opacity: phase === 'enter' ? 0 : 1,
          }}
        />

        <div
          className="mt-7 text-center transition-all duration-700 ease-out"
          style={{
            transform: phase === 'enter' ? 'translateY(14px)' : 'translateY(0)',
            opacity: phase === 'enter' ? 0 : 1,
            transitionDelay: '350ms',
          }}
        >
          <h1 className="text-4xl font-extrabold text-white tracking-tight">ELIM</h1>
          <p className="mt-2 text-[13px] text-slate-400 px-8 leading-relaxed max-w-xs">
            Centre Chrétien d'Enseignement,<br />de Libéralité et de Moisson
          </p>
        </div>

        {/* Loading shimmer bar */}
        <div
          className="mt-10 h-0.5 w-32 rounded-full bg-white/10 overflow-hidden transition-opacity duration-500"
          style={{ opacity: phase === 'enter' ? 0 : 1, transitionDelay: '600ms' }}
        >
          <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  )
}
