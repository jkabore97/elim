import { useState, useEffect } from 'react'
import { useLanguage } from './i18n'
import { translateText, getCachedTranslation } from './translate'

// Renders a stored data value that comes from a fixed list authored in one
// language - a church department ("Chorale / Louange"), a profession
// ("Infirmier / Sage-femme"), a country name - translated into the reader's
// language. `source` names the language the list was written in, so a reader
// already in that language sees the value untouched with no API call. Results
// are cached per device (see translate.ts), so this is one call per distinct
// value per language, ever.
export function TValue({ text, source }: { text?: string; source: 'fr' | 'en' }) {
  const { language } = useLanguage()
  const original = (text || '').trim()

  const [val, setVal] = useState<string>(() =>
    !original || language === source
      ? original
      : getCachedTranslation(original, language) ?? original,
  )

  useEffect(() => {
    if (!original || language === source) {
      setVal(original)
      return
    }
    const cached = getCachedTranslation(original, language)
    if (cached !== null) {
      setVal(cached)
      return
    }
    let alive = true
    translateText(original, language)
      .then(out => { if (alive) setVal(out) })
      .catch(() => {})
    return () => { alive = false }
  }, [original, language, source])

  return <>{val}</>
}
