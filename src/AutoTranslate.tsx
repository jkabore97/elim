import { useState, useEffect } from 'react'
import { Languages } from 'lucide-react'
import { useLanguage } from './i18n'
import { detectLanguage, translateText, worthTranslating, getCachedTranslation } from './translate'

// Renders a piece of user-written content (a post body or a comment) and, when
// it's in another language, shows it ALREADY TRANSLATED into the reader's
// language - no button to press. A small "Show original" link lets them flip
// back to the source wording. The original text is never lost, just tucked
// behind that toggle.
//
// Behaviour by confidence:
//   - clearly in the reader's language  -> shown as-is, nothing added
//   - clearly in another language        -> auto-translated on load
//   - too short to be sure (some short   -> shown as-is with a one-tap
//     comments)                             "Translate" fallback link
export function AutoTranslate({
  text,
  textClass = '',
  tone = 'dark',
  toggleClass = '',
}: {
  text: string
  textClass?: string
  tone?: 'dark' | 'light'
  toggleClass?: string
}) {
  const { language, t } = useLanguage()
  const detected = detectLanguage(text)
  const confidentForeign = !!detected && detected !== language
  const uncertain = !detected && worthTranslating(text)

  // Seed from cache so a text already translated on this device shows the
  // translation instantly, with no flash of the original.
  const [translated, setTranslated] = useState<string | null>(() =>
    confidentForeign ? getCachedTranslation(text, language) : null,
  )
  const [showOriginal, setShowOriginal] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [manualState, setManualState] = useState<'idle' | 'loading' | 'error'>('idle')

  // Auto-translate anything confidently in another language.
  useEffect(() => {
    if (!confidentForeign) return
    if (getCachedTranslation(text, language) !== null) return
    let alive = true
    setAutoLoading(true)
    translateText(text, language)
      .then((out) => {
        // If the service returns effectively the same text, there's nothing to
        // show - leave the original in place.
        if (alive && out.trim() && out.trim() !== text.trim()) setTranslated(out)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setAutoLoading(false)
      })
    return () => {
      alive = false
    }
  }, [text, language, confidentForeign])

  const linkColor =
    tone === 'light' ? 'text-white/80 hover:text-white' : 'text-affirm-600 hover:text-affirm-700'
  const linkBase = `inline-flex items-center gap-1 text-[12px] font-semibold mt-1 transition disabled:opacity-60 ${linkColor} ${toggleClass}`

  const body = translated && !showOriginal ? translated : text

  const handleManual = async () => {
    setManualState('loading')
    try {
      const out = await translateText(text, language)
      if (out.trim() && out.trim() !== text.trim()) setTranslated(out)
      setManualState('idle')
    } catch {
      setManualState('error')
      setTimeout(() => setManualState('idle'), 3000)
    }
  }

  return (
    <>
      <p className={textClass}>{body}</p>

      {/* Translated automatically: offer to flip back to the source wording. */}
      {translated && (
        <button type="button" onClick={() => setShowOriginal((s) => !s)} className={linkBase}>
          <Languages size={13} />
          {showOriginal ? t('translate.showTranslation') : t('translate.showOriginal')}
        </button>
      )}

      {/* Auto-translation in flight. */}
      {!translated && autoLoading && (
        <span className={`${linkBase} opacity-70`}>
          <Languages size={13} />
          {t('translate.translating')}
        </span>
      )}

      {/* Too short to be sure of the language: a one-tap fallback. */}
      {!translated && !autoLoading && uncertain && (
        <button type="button" onClick={handleManual} disabled={manualState === 'loading'} className={linkBase}>
          <Languages size={13} />
          {manualState === 'loading'
            ? t('translate.translating')
            : manualState === 'error'
              ? t('translate.failed')
              : t('translate.action')}
        </button>
      )}
    </>
  )
}
