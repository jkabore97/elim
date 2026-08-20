import { useState } from 'react'
import { Languages } from 'lucide-react'
import { useLanguage } from './i18n'
import { detectLanguage, translateText } from './translate'

// A subtle "Translate" link shown under a piece of user-written content when it
// looks like it's in a language other than the reader's. Tapping translates to
// the reader's current language and shows the result below the original, with a
// "Show original" toggle. The original text is never replaced — it's always
// still there above this control.
export function TranslateToggle({ text, className = '', tone = 'dark' }: { text: string; className?: string; tone?: 'dark' | 'light' }) {
  const { language, t } = useLanguage()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [translated, setTranslated] = useState('')
  const [shown, setShown] = useState(false)

  // Only offer translation when we're fairly sure the content is in a
  // different language than the reader's. Uncertain guesses show nothing.
  const detected = detectLanguage(text)
  if (!detected || detected === language) return null

  const handleTranslate = async () => {
    if (state === 'done') {
      setShown(s => !s)
      return
    }
    setState('loading')
    try {
      const out = await translateText(text, language)
      setTranslated(out)
      setState('done')
      setShown(true)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const label =
    state === 'loading' ? t('translate.translating')
    : state === 'error' ? t('translate.failed')
    : state === 'done' ? (shown ? t('translate.showOriginal') : t('translate.action'))
    : t('translate.action')

  const btnColor = tone === 'light'
    ? 'text-white/80 hover:text-white'
    : 'text-affirm-600 hover:text-affirm-700'
  const bodyColor = tone === 'light'
    ? 'text-white/90 border-white/30'
    : 'text-slate-700 border-affirm-200'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleTranslate}
        disabled={state === 'loading'}
        className={`inline-flex items-center gap-1 text-[12px] font-semibold disabled:opacity-60 transition ${btnColor}`}
      >
        <Languages size={13} />
        {label}
      </button>
      {state === 'done' && shown && (
        <p className={`mt-1 whitespace-pre-wrap border-l-2 pl-3 ${bodyColor}`}>
          {translated}
        </p>
      )}
    </div>
  )
}
