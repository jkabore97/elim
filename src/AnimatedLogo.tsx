// The ELIM emblem, redrawn as a vector illustration and assembled on screen:
// the globe scales in, the dove swoops down from the upper-right, light beams
// from its beak and settle onto the globe, and then the palms grow from small
// to tall. Once assembled the whole mark breathes with a slow float. All
// motion is disabled under prefers-reduced-motion.
//
// `play` gates the entrance; when false every part is shown in its final
// resting state (used as a static fallback / for reduced motion).
export function AnimatedLogo({ size = 168, play = true }: { size?: number; play?: boolean }) {
  return (
    <div
      className={play ? 'elim-logo elim-logo--play' : 'elim-logo'}
      style={{ width: size, height: size * (390 / 400) }}
    >
      <svg viewBox="0 0 400 390" width="100%" height="100%" role="img" aria-label="ELIM">
        <defs>
          <radialGradient id="el-ocean" cx="37%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#8fc4f2" /><stop offset="42%" stopColor="#3f86d8" /><stop offset="100%" stopColor="#1c4a9c" />
          </radialGradient>
          <linearGradient id="el-land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#57b473" /><stop offset="100%" stopColor="#2c8150" />
          </linearGradient>
          <radialGradient id="el-shine" cx="33%" cy="26%" r="42%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity=".6" /><stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="el-globeShadow" cx="50%" cy="50%" r="50%">
            <stop offset="68%" stopColor="#000000" stopOpacity="0" /><stop offset="100%" stopColor="#0b2a5e" stopOpacity=".4" />
          </radialGradient>
          <linearGradient id="el-trunk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7a4a22" /><stop offset="50%" stopColor="#b07a42" /><stop offset="100%" stopColor="#6b3f1d" />
          </linearGradient>
          <linearGradient id="el-frond" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5cc079" /><stop offset="100%" stopColor="#1f7a44" />
          </linearGradient>
          <linearGradient id="el-ray" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff6cf" stopOpacity=".95" /><stop offset="100%" stopColor="#f6c945" stopOpacity=".12" />
          </linearGradient>
          <linearGradient id="el-dove" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#dbe8f5" />
          </linearGradient>
          <linearGradient id="el-book" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#cdd6e2" />
          </linearGradient>
        </defs>

        {/* BIBLE / OPEN BOOK */}
        <g className="el-bible">
          <ellipse cx="200" cy="352" rx="150" ry="16" fill="#0b2a5e" opacity=".12" />
          <path d="M200,300 L60,320 Q58,322 60,326 L200,312 L340,326 Q342,322 340,320 Z" fill="#aeb9c8" />
          <path d="M200,306 Q130,300 66,316 Q62,318 66,322 L200,314 Z" fill="url(#el-book)" />
          <path d="M200,306 Q270,300 334,316 Q338,318 334,322 L200,314 Z" fill="url(#el-book)" />
          <g stroke="#c2cbd8" strokeWidth="1.3" opacity=".8" fill="none">
            <path d="M96,312 Q142,304 186,310" /><path d="M214,310 Q258,304 304,312" />
          </g>
          <path d="M197,312 L200,296 L203,312 Z" fill="#c02a2a" />
        </g>

        {/* GLOBE */}
        <g className="el-globe">
          <circle cx="196" cy="192" r="118" fill="url(#el-ocean)" />
          <g fill="url(#el-land)">
            <path d="M150,116 Q184,106 198,130 Q212,150 190,166 Q212,180 196,206 Q174,226 148,212 Q138,194 152,180 Q130,168 138,146 Q140,126 150,116 Z" />
            <path d="M216,146 Q250,142 264,166 Q274,186 250,198 Q228,204 220,186 Q214,168 226,162 Q214,156 216,146 Z" />
            <path d="M118,196 Q102,200 106,216 Q114,228 132,222 Q140,208 130,198 Q124,192 118,196 Z" />
            <path d="M224,232 Q246,228 252,246 Q250,262 232,260 Q220,250 224,232 Z" />
          </g>
          <g fill="none" stroke="#ffffff" strokeOpacity=".22" strokeWidth="1.4">
            <ellipse cx="196" cy="192" rx="118" ry="46" /><ellipse cx="196" cy="192" rx="46" ry="118" /><ellipse cx="196" cy="192" rx="86" ry="118" />
          </g>
          <circle cx="196" cy="192" r="118" fill="url(#el-shine)" />
          <circle cx="196" cy="192" r="118" fill="url(#el-globeShadow)" />
          <circle cx="196" cy="192" r="118" fill="none" stroke="#14356f" strokeWidth="2.5" strokeOpacity=".55" />
        </g>

        {/* LIGHT RAYS (from the beak onto the globe) */}
        <g className="el-rays">
          <path d="M233.32,119.91 L126.72,261.87 L238.68,124.09 Z" fill="url(#el-ray)" />
          <path d="M234,119.25 L100.02,220.8 L238,124.75 Z" fill="url(#el-ray)" />
          <path d="M234.84,118.81 L94.42,173.53 L237.16,125.19 Z" fill="url(#el-ray)" />
          <path d="M235.76,118.61 L108.61,130.91 L236.24,125.39 Z" fill="url(#el-ray)" />
          <path d="M236.71,118.67 L135.49,100.64 L235.29,125.33 Z" fill="url(#el-ray)" />
          <path d="M237.6,119 L165.55,84.54 L234.4,125 Z" fill="url(#el-ray)" />
          <path d="M232.94,120.51 L157.75,282.43 L239.06,123.49 Z" fill="url(#el-ray)" />
          <path d="M238.36,119.55 L191.61,79.13 L233.64,124.45 Z" fill="url(#el-ray)" />
          <circle cx="236" cy="122" r="9" fill="#fff3c0" opacity=".9" />
          <circle cx="236" cy="122" r="4.5" fill="#fffbe8" />
        </g>

        {/* PALMS */}
        <g className="el-palms">
          <g className="el-palm">
            <path d="M126,322 Q139,251 140,180" fill="none" stroke="url(#el-trunk)" strokeWidth="8" strokeLinecap="round" />
            <g fill="url(#el-frond)">
              <path d="M140,180 Q114.92,169.86 86.01,177.72 Q111.09,187.86 140,180 Z" />
              <path d="M140,180 Q123.84,154.79 93.49,146.49 Q109.65,171.7 140,180 Z" />
              <path d="M140,180 Q141.97,151.26 122.94,129.34 Q120.97,158.08 140,180 Z" />
              <path d="M140,180 Q151.89,155.01 143.59,128.61 Q131.7,153.6 140,180 Z" />
              <path d="M140,180 Q165.45,161.94 172.18,132.19 Q146.73,150.24 140,180 Z" />
              <path d="M140,180 Q170.22,180.82 189.4,162.52 Q159.18,161.7 140,180 Z" />
              <path d="M140,180 Q165.67,194.83 189.41,191.37 Q163.74,176.53 140,180 Z" />
            </g>
            <circle cx="140" cy="180" r="4.14" fill="#7a4e26" />
          </g>
          <g className="el-palm el-palm2">
            <path d="M170,328 Q181,238 180,148" fill="none" stroke="url(#el-trunk)" strokeWidth="10" strokeLinecap="round" />
            <g fill="url(#el-frond)">
              <path d="M180,148 Q149.46,135.66 114.27,145.23 Q144.81,157.57 180,148 Z" />
              <path d="M180,148 Q160.33,117.31 123.37,107.21 Q143.05,137.9 180,148 Z" />
              <path d="M180,148 Q182.4,113.01 159.23,86.33 Q156.83,121.32 180,148 Z" />
              <path d="M180,148 Q194.48,117.58 184.38,85.43 Q169.9,115.86 180,148 Z" />
              <path d="M180,148 Q210.98,126.02 219.17,89.79 Q188.19,111.77 180,148 Z" />
              <path d="M180,148 Q216.79,149 240.14,126.72 Q203.35,125.72 180,148 Z" />
              <path d="M180,148 Q211.25,166.06 240.15,161.84 Q208.9,143.78 180,148 Z" />
            </g>
            <circle cx="180" cy="148" r="5.04" fill="#7a4e26" />
          </g>
        </g>

        {/* DOVE (wrapped so the swoop animation doesn't clobber its placement) */}
        <g className="el-dove-fly">
          <g transform="translate(232,60)">
            <g fill="url(#el-dove)" stroke="#c3d3e6" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M56,64 Q90,70 124,98 Q101,88 86,90 Q93,79 74,75 Q64,72 56,64 Z" />
              <path d="M10,66 Q3,60 9,55 Q20,45 40,51 Q70,46 98,55 Q116,60 108,71 Q86,80 62,78 Q42,80 32,75 Q20,79 14,73 Q8,71 10,66 Z" />
              <path d="M100,58 Q128,51 143,50 Q135,61 139,72 Q120,65 101,71 Z" />
              <path d="M40,50 Q60,6 106,-2 Q93,13 98,24 Q81,19 84,33 Q67,28 67,41 Q52,36 40,50 Z" />
            </g>
            <path d="M11,58 L-1,56 L11,63 Z" fill="#f2a933" />
            <circle cx="21" cy="59" r="2.4" fill="#2a2f3a" />
            <path d="M-1,56 Q-16,53 -25,60" fill="none" stroke="#3f9a55" strokeWidth="2" />
            <circle cx="-23" cy="60" r="2.6" fill="#5cbf78" />
            <circle cx="-16" cy="53" r="2.3" fill="#5cbf78" />
            <circle cx="-9" cy="57" r="2.1" fill="#5cbf78" />
          </g>
        </g>
      </svg>

      <style>{`
        .elim-logo { display: inline-block; }
        .elim-logo svg { display: block; overflow: visible; }
        .elim-logo g { transform-box: fill-box; }

        /* Static (no play / reduced motion): everything shown in final state. */
        .elim-logo .el-globe, .elim-logo .el-bible, .elim-logo .el-rays,
        .elim-logo .el-palm, .elim-logo .el-dove-fly { opacity: 1; transform: none; }

        /* Entrance: globe -> dove -> light touches globe -> palms grow. */
        .elim-logo--play .el-globe {
          transform-origin: 50% 50%;
          animation: elGlobeIn .75s cubic-bezier(.22,1,.36,1) .1s both;
        }
        .elim-logo--play .el-bible {
          transform-origin: 50% 100%;
          animation: elBibleIn .6s ease-out .18s both;
        }
        .elim-logo--play .el-dove-fly {
          transform-origin: 55% 45%;
          animation: elDoveFly 1.15s cubic-bezier(.16,1,.3,1) .5s both;
        }
        .elim-logo--play .el-rays {
          transform-origin: 98% 21%;
          animation: elRaysIn .8s cubic-bezier(.22,1,.36,1) 1.55s both;
        }
        .elim-logo--play .el-palm {
          transform-origin: 50% 100%;
          animation: elPalmGrow 1.05s cubic-bezier(.22,1.12,.32,1) 2.35s both;
        }
        .elim-logo--play .el-palm2 { animation-delay: 2.5s; }

        /* Gentle breathing float once assembled. */
        .elim-logo--play svg { animation: elFloat 6s ease-in-out 3.7s infinite; }

        @keyframes elGlobeIn { from { opacity:0; transform: scale(.72); } to { opacity:1; transform: scale(1); } }
        @keyframes elBibleIn { from { opacity:0; transform: translateY(10px) scale(.9); } to { opacity:1; transform: none; } }
        @keyframes elDoveFly {
          0%   { opacity:0; transform: translate(74px,-98px) rotate(-14deg) scale(1.06); }
          45%  { opacity:1; }
          100% { opacity:1; transform: translate(0,0) rotate(0) scale(1); }
        }
        @keyframes elRaysIn {
          0%   { opacity:0; transform: scale(.2); }
          55%  { opacity:1; }
          100% { opacity:1; transform: scale(1); }
        }
        @keyframes elPalmGrow {
          0%   { opacity:.4; transform: scale(.06); }
          60%  { opacity:1; }
          100% { opacity:1; transform: scale(1); }
        }
        @keyframes elFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

        @media (prefers-reduced-motion: reduce) {
          .elim-logo--play .el-globe, .elim-logo--play .el-bible, .elim-logo--play .el-rays,
          .elim-logo--play .el-palm, .elim-logo--play .el-dove-fly, .elim-logo--play svg {
            animation: none !important; opacity: 1 !important; transform: none !important;
          }
        }
      `}</style>
    </div>
  )
}
