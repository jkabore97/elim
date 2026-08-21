import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { storageGet, storageSet } from './safeStorage'
import type { Language } from './i18n'

// On-demand translation of user-written content (posts, comments, messages).
// The UI text itself is fully pre-translated per locale; this is only for
// content a member typed in a language other than the reader's.

// --- Lightweight offline language guess ------------------------------------
// We only want to offer a "Translate" button when the content is actually in a
// different language than the reader. A full language-detection library is
// overkill (and heavy) for short posts, so we use a cheap two-step guess:
//   1. Script blocks unambiguously identify Arabic, Chinese and Hindi.
//   2. For Latin-script text we score against small stop-word sets for the
//      six Latin languages we support.
// When the guess is uncertain (very short text, no clear winner) we return
// null and the caller simply doesn't show the button.

const STOPWORDS: Record<string, Set<string>> = {
  en: new Set(['the', 'and', 'is', 'you', 'to', 'of', 'for', 'are', 'with', 'this', 'that', 'have', 'not', 'your', 'was', 'from', 'they', 'will', 'in', 'we', 'be', 'all', 'may', 'god']),
  fr: new Set(['le', 'la', 'les', 'de', 'des', 'et', 'est', 'vous', 'pour', 'dans', 'une', 'un', 'que', 'qui', 'nous', 'pas', 'sur', 'avec', 'sont', 'ce', 'en', 'au', 'aux', 'se', 'dieu', 'votre']),
  es: new Set(['el', 'la', 'los', 'las', 'de', 'y', 'es', 'para', 'con', 'que', 'una', 'por', 'del', 'como', 'más', 'pero', 'este', 'son', 'muy', 'en', 'un', 'se', 'su', 'dios', 'todos']),
  pt: new Set(['o', 'a', 'os', 'as', 'de', 'da', 'do', 'e', 'para', 'com', 'que', 'uma', 'não', 'como', 'mais', 'mas', 'este', 'são', 'seu', 'muito', 'em', 'no', 'na', 'se', 'deus', 'vocês']),
  it: new Set(['il', 'la', 'di', 'del', 'della', 'e', 'per', 'con', 'che', 'una', 'un', 'non', 'come', 'più', 'ma', 'questo', 'sono', 'gli', 'nel', 'anche', 'in', 'a', 'si', 'dio', 'vi']),
  de: new Set(['der', 'die', 'das', 'und', 'ist', 'für', 'mit', 'den', 'ein', 'eine', 'nicht', 'sie', 'auch', 'auf', 'dem', 'wir', 'von', 'sind', 'wird', 'oder', 'euch', 'uns', 'gott', 'im', 'zu', 'so', 'alle']),
}

export function detectLanguage(raw: string): Language | null {
  const text = (raw || '').trim()
  if (text.length < 4) return null

  // Script-based detection first — unambiguous for these three.
  if (/[؀-ۿ]/.test(text)) return 'ar'       // Arabic
  if (/[一-鿿]/.test(text)) return 'zh'       // CJK unified ideographs
  if (/[ऀ-ॿ]/.test(text)) return 'hi'       // Devanagari

  // Latin-script scoring.
  const words = text.toLowerCase().match(/[a-zàâäáãçéèêëíìîïñóòôöõúùûüß']+/g) || []
  if (words.length < 3) return null

  let best: Language | null = null
  let bestScore = 0
  let secondScore = 0
  for (const [lang, set] of Object.entries(STOPWORDS)) {
    let score = 0
    for (const w of words) if (set.has(w)) score++
    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      best = lang as Language
    } else if (score > secondScore) {
      secondScore = score
    }
  }

  // Require at least two stop-word hits and a clear margin over the runner-up,
  // otherwise the guess isn't trustworthy enough to act on.
  if (bestScore >= 2 && bestScore > secondScore) return best
  return null
}

// Whether a piece of text has enough substance to bother offering a
// translation for. Comments are often too short for detectLanguage to name a
// language, but we still want to offer to translate a real sentence like
// "Gloire a Dieu, alleluia" - so the button shows for anything with a few
// words, while skipping trivial reactions ("Amen", an emoji, "ok").
export function worthTranslating(text: string): boolean {
  const t = (text || '').trim()
  // Any Arabic / Chinese / Devanagari is worth offering even when very short.
  if (/[؀-ۿ一-鿿ऀ-ॿ]/.test(t)) return t.length >= 2
  const letters = (t.match(/[a-zàâäáãçéèêëíìîïñóòôöõúùûüß]/gi) || []).length
  const words = (t.match(/[a-zàâäáãçéèêëíìîïñóòôöõúùûüß']+/gi) || []).length
  return letters >= 10 && words >= 2
}

// --- Translation call ------------------------------------------------------
// Two-level cache so a given text is translated at most once per device, ever:
//   - an in-memory Map for this session (instant), and
//   - localStorage so it survives reloads (posts/comments rarely change).
// This keeps auto-translation cheap: the Cloud Translation API is only hit the
// first time anyone's device sees a particular piece of text in a given
// language.
const cache = new Map<string, string>()

// Short, stable key for a (text, language) pair - a djb2 hash keeps
// localStorage keys small even for long posts.
function cacheKey(text: string, target: Language): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `tr:${target}:${h >>> 0}`
}

// Synchronous cache read, so a component can show a cached translation
// immediately on mount with no flash of the original.
export function getCachedTranslation(text: string, target: Language): string | null {
  const key = cacheKey(text, target)
  const mem = cache.get(key)
  if (mem !== undefined) return mem
  const stored = storageGet(key)
  if (stored !== null && stored !== undefined) {
    cache.set(key, stored)
    return stored
  }
  return null
}

const callTranslate = httpsCallable<
  { text: string; target: string },
  { text: string; source: string | null }
>(functions, 'translateContent')

// Coalesce concurrent requests for the same (text, language): when a members
// list renders, many rows ask for the same profession or department at once -
// this makes that a single network call instead of dozens.
const inflight = new Map<string, Promise<string>>()

export async function translateText(text: string, target: Language): Promise<string> {
  const cached = getCachedTranslation(text, target)
  if (cached !== null) return cached
  const key = cacheKey(text, target)
  const pending = inflight.get(key)
  if (pending) return pending
  const p = callTranslate({ text, target })
    .then(res => {
      const out = res.data?.text ?? text
      cache.set(key, out)
      storageSet(key, out)
      inflight.delete(key)
      return out
    })
    .catch(err => {
      inflight.delete(key)
      throw err
    })
  inflight.set(key, p)
  return p
}
