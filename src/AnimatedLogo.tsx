// The ELIM mark, assembled on screen from four layers extracted from the logo
// (globe, palm trees, dove, light rays). The globe scales in, the trees grow
// up from their base, the dove swoops down from the upper-right into place,
// and the rays burst outward last. After it settles the whole mark breathes
// with a slow float. All motion is disabled under prefers-reduced-motion.
//
// `play` gates the entrance: when false, every layer is shown in its final
// resting state with no animation (used as a static fallback / reduced motion).
export function AnimatedLogo({ size = 150, play = true }: { size?: number; play?: boolean }) {
  const height = size * (382 / 500)
  const layer = 'absolute inset-0 w-full h-full object-contain'
  const anim = (a: string) => (play ? a : 'none')

  return (
    <div
      className="relative"
      style={{
        width: size,
        height,
        animation: anim('logoFloat 6s ease-in-out 2.4s infinite')
      }}
    >
      <img
        src="/logo-globe.png" alt="" aria-hidden="true" className={layer}
        style={{ transformOrigin: '41% 63%', animation: anim('logoGlobeIn 0.9s cubic-bezier(.22,1,.36,1) 0.05s both') }}
      />
      <img
        src="/logo-rays.png" alt="" aria-hidden="true" className={layer}
        style={{ transformOrigin: '54% 39%', animation: anim('logoRaysBurst 0.85s cubic-bezier(.22,1,.36,1) 1.15s both') }}
      />
      <img
        src="/logo-trees.png" alt="" aria-hidden="true" className={layer}
        style={{ transformOrigin: '22% 97%', animation: anim('logoTreesGrow 1s cubic-bezier(.2,1.15,.3,1) 0.45s both') }}
      />
      <img
        src="/logo-dove.png" alt="ELIM" className={layer}
        style={{ transformOrigin: '60% 45%', animation: anim('logoDoveFly 1.25s cubic-bezier(.16,1,.3,1) 0.3s both') }}
      />

      <style>{`
        @keyframes logoGlobeIn {
          from { opacity: 0; transform: scale(0.7); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes logoTreesGrow {
          0%   { opacity: 0; transform: scaleY(0.02) scaleX(0.82); }
          55%  { opacity: 1; }
          100% { opacity: 1; transform: scaleY(1) scaleX(1); }
        }
        @keyframes logoDoveFly {
          0%   { opacity: 0; transform: translate(26%, -48%) rotate(-16deg) scale(1.06); }
          45%  { opacity: 1; }
          100% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
        }
        @keyframes logoRaysBurst {
          0%   { opacity: 0; transform: scale(0.35); }
          60%  { opacity: 1; }
          100% { opacity: 0.96; transform: scale(1); }
        }
        @keyframes logoFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .relative > img { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>
    </div>
  )
}
