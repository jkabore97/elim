import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { storageGet, storageSet } from './safeStorage'

import en from './locales/en'
import fr from './locales/fr'
import es from './locales/es'
import pt from './locales/pt'
import it from './locales/it'
import de from './locales/de'
import ar from './locales/ar'
import zh from './locales/zh'
import hi from './locales/hi'
// To add a language: create src/locales/<code>.ts, import it here, add it to
// DICTS and to LANGUAGES below. Missing keys fall back to English automatically.

// English is the source of truth: every key exists in en, and TranslationKey
// is derived from it. Other locales are Partial - any key they're missing
// falls back to English (see `t` below), so a half-finished translation can
// never crash the app or show a blank label.
export type TranslationKey = keyof typeof en

export type Language = 'en' | 'fr' | 'es' | 'pt' | 'it' | 'de' | 'ar' | 'zh' | 'hi'

type Dict = Partial<Record<TranslationKey, string>>
const DICTS: Record<Language, Dict> = { en, fr, es, pt, it, de, ar, zh, hi }

// Shown in the Profile language picker. `native` is the language's own name so
// a speaker recognises it without reading English; `rtl` flips layout.
// Only languages with a real translation are listed here (so the picker never
// offers a language that would show as English). New ones are added as their
// locale file is filled in.
export const LANGUAGES: { code: Language; native: string; english: string; rtl?: boolean }[] = [
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'en', native: 'English', english: 'English' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'ar', native: 'العربية', english: 'Arabic', rtl: true },
  { code: 'zh', native: '中文', english: 'Chinese' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
]

const SUPPORTED = new Set<string>(LANGUAGES.map(l => l.code))
const isRtl = (lang: Language) => !!LANGUAGES.find(l => l.code === lang)?.rtl

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

// The person's saved choice wins; otherwise follow the phone/browser language
// so a Spanish or German device shows the app in that language on first open.
// Falls back to French (most of the congregation) when the device language
// isn't one we ship.
function detectDefaultLanguage(): Language {
  const stored = storageGet('elim-language')
  if (stored && SUPPORTED.has(stored)) return stored as Language
  const nav = typeof navigator !== 'undefined'
    ? (navigator.languages && navigator.languages[0]) || navigator.language || ''
    : ''
  const primary = nav.toLowerCase().split('-')[0] // "es-MX" -> "es", "zh-Hans" -> "zh"
  if (SUPPORTED.has(primary)) return primary as Language
  return 'fr'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectDefaultLanguage)

  useEffect(() => {
    storageSet('elim-language', language)
    // Reflect the language on the document so screen readers announce it and
    // Arabic lays out right-to-left.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr'
    }
  }, [language])

  const setLanguage = (lang: Language) => setLanguageState(lang)

  const t = (key: TranslationKey): string =>
    DICTS[language][key] ?? en[key] ?? (key as string)

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
