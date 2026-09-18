// Built-in brand marks for the church's ministry groups. Rather than uploading
// an avatar image per group, a group whose name matches one of the ministries
// renders its designed logo (an accent tile + white icon) wherever a group
// avatar is shown — the feed post header and the admin Groups panel. A group
// with a custom uploaded avatar keeps it; an unmatched group falls back to its
// initial. Matching is accent- and case-insensitive on a keyword in the name.

type Kind = 'pastoral' | 'media' | 'sante' | 'jeunesse'

const GRADIENTS: Record<Kind, [string, string]> = {
  pastoral: ['#fb923c', '#ea580c'],
  media: ['#a78bfa', '#7c3aed'],
  sante: ['#2dd4bf', '#0d9488'],
  jeunesse: ['#fb7185', '#e11d48'],
}

// The group a name belongs to, or null when no ministry mark applies.
export function groupLogoKind(name?: string): Kind | null {
  const s = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/pastoral|pasteur|minist/.test(s)) return 'pastoral'
  if (/media/.test(s)) return 'media'
  if (/sante|health/.test(s)) return 'sante'
  if (/jeunesse|jeune|youth/.test(s)) return 'jeunesse'
  return null
}

function Icon({ kind, px }: { kind: Kind; px: number }) {
  switch (kind) {
    case 'pastoral': // open Bible + rising cross
      return (
        <svg width={px} height={px} viewBox="0 0 100 100" fill="none">
          <path d="M50 8 L50 30 M42 16 L58 16" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" />
          <path d="M50 40 C 40 33, 24 31, 12 34 L12 74 C 24 71, 40 73, 50 80 C 60 73, 76 71, 88 74 L88 34 C 76 31, 60 33, 50 40 Z" fill="#fff" />
          <path d="M50 40 L50 80" stroke="#ea580c" strokeWidth="2.6" />
          <path d="M20 45 C 30 44, 40 46, 46 49 M20 55 C 30 54, 40 56, 46 59" stroke="#f5a373" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M80 45 C 70 44, 60 46, 54 49 M80 55 C 70 54, 60 56, 54 59" stroke="#f5a373" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'media': // studio microphone + sound waves
      return (
        <svg width={px} height={px} viewBox="0 0 100 100" fill="none">
          <rect x="38" y="14" width="24" height="42" rx="12" fill="#fff" />
          <path d="M28 44 C 28 62, 40 72, 50 72 C 60 72, 72 62, 72 44" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <path d="M50 72 L50 86 M40 86 L60 86" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <path d="M20 30 C 16 36, 16 46, 20 52 M80 30 C 84 36, 84 46, 80 52" stroke="#cbb8fb" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
      )
    case 'sante': // heart + ECG pulse
      return (
        <svg width={px} height={px} viewBox="0 0 100 100" fill="none">
          <path d="M50 84 C 18 62, 8 44, 8 30 C 8 18, 17 10, 28 10 C 37 10, 45 16, 50 24 C 55 16, 63 10, 72 10 C 83 10, 92 18, 92 30 C 92 44, 82 62, 50 84 Z" fill="#fff" />
          <path d="M18 45 H33 L39 30 L49 60 L55 45 H82" stroke="#0d9488" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'jeunesse': // layered flame
      return (
        <svg width={px} height={px} viewBox="0 0 100 100" fill="none">
          <path d="M52 8 C 50 26, 30 34, 30 56 C 30 74, 43 86, 54 86 C 68 86, 78 74, 78 57 C 78 44, 70 38, 64 30 C 62 40, 54 40, 57 26 C 58 18, 56 12, 52 8 Z" fill="#fff" />
          <path d="M53 44 C 51 54, 42 57, 42 68 C 42 77, 48 82, 54 82 C 61 82, 66 76, 66 68 C 66 60, 60 55, 53 44 Z" fill="#fb7185" />
        </svg>
      )
  }
}

// A group's brand mark, sized to fill an avatar slot. Returns null when the
// name matches no ministry, so the caller can fall back to its initial.
export function GroupLogo({ name, size = 44, round = true, className = '' }: {
  name?: string; size?: number; round?: boolean; className?: string
}) {
  const kind = groupLogoKind(name)
  if (!kind) return null
  const [from, to] = GRADIENTS[kind]
  return (
    <div
      className={`shrink-0 flex items-center justify-center ${className}`}
      style={{
        width: size, height: size,
        borderRadius: round ? '50%' : Math.round(size * 0.28),
        background: `linear-gradient(140deg, ${from}, ${to})`,
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,.35)',
      }}>
      <Icon kind={kind} px={Math.round(size * 0.56)} />
    </div>
  )
}
