import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Trophy, Medal, ArrowRight, X, RotateCcw, Share2,
  ChevronLeft, Check, Loader2, BookOpen, Crown, ScrollText, Pencil, Trash2, Lock, Star,
} from 'lucide-react'
import { Share } from '@capacitor/share'
import { useLanguage } from './i18n'
import { Portal } from './Portal'
import { useBackHandler } from './backButton'
import { storageGet, storageSet } from './safeStorage'
import type { AppUser } from './types'
import {
  QUIZ_DIFFICULTIES, ADULT_CATEGORIES, CATEGORY_META, BADGE_IDS, BADGE_EMOJI,
  QUESTIONS_PER_GAME,
  bankAvailable, buildGame, buildDaily, buildRandom, loadBank, present, pointsFor, starsFor, levelProgress,
  applyResult, emptyProfile, todayKey,
  type QuizCategory, type QuizDifficulty, type QuizLang, type PlayQuestion,
  type QuizProfile, type GameResult, type BadgeId,
} from './quiz/engine'
import {
  pickForCategory, pickReview, recordAnswer, reviewSummary,
  type DueItem, type ReviewSummary,
} from './quiz/review'
import {
  lessonsOf, lessonId, lessonStars, lessonPassed, levelState, levelUnlocked, recordLessonResult,
  type LevelState,
} from './quiz/lessons'
import type { BankQuestion } from './quiz/engine'
import { recordDailyPlayed, weekCalendar, dailyThemeIndex } from './quiz/daily'
import { emit } from './feedback'
import {
  subscribeProfile, commitAdultGame, commitKidsGame, fetchTopScorer,
  fetchGrandLeaders, fetchCategoryLeaders, fetchKidsLeaders, fetchChampions,
  deleteKidEverywhere, renameKidEverywhere, childSlug,
  type LeaderRow, type KidRow, type ChampionDoc, type TopScorer,
} from './quiz/store'

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app'
// The remembered child profiles for this device. Each kid is just a name, so a
// parent with several children can pick one or add another before playing.
// (KID_NAME_KEY is the old single-name storage, still read once for migration.)
const KID_NAME_KEY = 'elim-quiz-kidname'
const KID_NAMES_KEY = 'elim-quiz-kidnames'

// Identity key for a saved child. Delegates to the server's childSlug so the
// LOCAL name list and the SERVER score docs (keyed by childSlug) always agree -
// otherwise two locally-distinct names could share one score doc, and deleting
// one would hit the other.
function kidKey(name: string): string {
  return childSlug(name)
}

function loadKidNames(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  try {
    const raw = storageGet(KID_NAMES_KEY)
    if (raw) for (const n of JSON.parse(raw)) {
      if (typeof n === 'string' && n.trim() && !seen.has(kidKey(n))) { seen.add(kidKey(n)); out.push(n) }
    }
  } catch { /* corrupt/empty: start fresh */ }
  // Migrate the previous single-name storage so an existing kid isn't lost.
  const legacy = storageGet(KID_NAME_KEY)
  if (legacy && legacy.trim() && !seen.has(kidKey(legacy))) out.unshift(legacy)
  return out
}

function rememberKidName(name: string): void {
  const clean = name.trim()
  if (!clean) return
  const list = loadKidNames().filter(n => kidKey(n) !== kidKey(clean))
  list.unshift(clean)
  try { storageSet(KID_NAMES_KEY, JSON.stringify(list.slice(0, 12))) } catch { /* storage full/blocked */ }
}

// A child's age band → an age-appropriate difficulty. Stored per child (local),
// so a 5-year-old plays the easy kids bank and a 11-year-old the hard one.
type AgeBand = 'young' | 'mid' | 'older' // 4–6 · 7–9 · 10–12
const KID_BANDS_KEY = 'elim-quiz-kidbands'
const BAND_DIFF: Record<AgeBand, QuizDifficulty> = { young: 'easy', mid: 'medium', older: 'hard' }
function getKidBand(name: string): AgeBand {
  try {
    const o = JSON.parse(storageGet(KID_BANDS_KEY) || '{}')
    const b = o[kidKey(name)]
    if (b === 'young' || b === 'mid' || b === 'older') return b
  } catch { /* default below */ }
  return 'mid'
}
function setKidBand(name: string, band: AgeBand): void {
  let o: Record<string, string> = {}
  try { o = JSON.parse(storageGet(KID_BANDS_KEY) || '{}') } catch { /* start fresh */ }
  o[kidKey(name)] = band
  try { storageSet(KID_BANDS_KEY, JSON.stringify(o)) } catch { /* ignore */ }
}

// A child's confidence = how many distinct kids questions they've answered
// correctly, kept per child on the device (encouragement, never a ranking).
const KID_MASTERY_KEY = (name: string) => `elim-quiz-kidmastery-${kidKey(name)}`
function recordKidMastery(name: string, correctIds: string[]): void {
  if (!correctIds.length) return
  let set: string[] = []
  try { const a = JSON.parse(storageGet(KID_MASTERY_KEY(name)) || '[]'); if (Array.isArray(a)) set = a } catch { /* fresh */ }
  const merged = [...new Set([...set, ...correctIds])]
  try { storageSet(KID_MASTERY_KEY(name), JSON.stringify(merged)) } catch { /* ignore */ }
}
function kidMasteryCount(name: string): number {
  try { const a = JSON.parse(storageGet(KID_MASTERY_KEY(name)) || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 }
}

function forgetKidName(name: string): void {
  const list = loadKidNames().filter(n => kidKey(n) !== kidKey(name))
  try { storageSet(KID_NAMES_KEY, JSON.stringify(list)) } catch { /* ignore */ }
  // Also clear the legacy single-name slot when it matches - otherwise
  // loadKidNames() re-adds that child on the next read and it "comes back"
  // after deletion. (Blanking it is enough; loadKidNames ignores an empty one.)
  try {
    if (kidKey(storageGet(KID_NAME_KEY) || '') === kidKey(name)) storageSet(KID_NAME_KEY, '')
  } catch { /* ignore */ }
}

type Screen = 'home' | 'difficulty' | 'kidname' | 'playing' | 'results' | 'trophies' | 'leaders' | 'palmares'

function playLang(language: string): QuizLang {
  return language === 'fr' ? 'fr' : 'en'
}

interface Game {
  questions: PlayQuestion[]
  category: QuizCategory | 'daily' | 'random'
  difficulty: QuizDifficulty
  mode: 'adult' | 'kids'
  childName?: string
  review?: boolean   // a "revise what you missed" round (drives replay routing)
  lesson?: { cat: QuizCategory; diff: QuizDifficulty; index: number } // a Parcours lesson
}

export default function BibleQuiz({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { t, language } = useLanguage()
  const lang = playLang(language)

  const [profile, setProfile] = useState<QuizProfile>(() => emptyProfile(user.uid, user.displayName, user.avatar))
  const [screen, setScreen] = useState<Screen>('home')
  const [pickedCat, setPickedCat] = useState<QuizCategory | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{ result: GameResult; unlocked: BadgeId[] } | null>(null)
  const [kidResult, setKidResult] = useState<{ childName: string; correct: number; total: number; gained: number } | null>(null)

  useBackHandler(true, () => {
    if (screen === 'playing') { if (confirm(t('quiz.quitConfirm'))) backToHome() }
    else if (screen === 'home') onClose()
    else backToHome()
  })

  // profileReady gates starting an adult game until the real career profile has
  // loaded - otherwise a game finished on the empty placeholder would overwrite
  // the server's points on commit. A fallback flips it true so a slow/failed
  // snapshot never locks the player out.
  const [profileReady, setProfileReady] = useState(false)
  useEffect(() => {
    const unsub = subscribeProfile(user.uid, user.displayName, user.avatar,
      p => { setProfile(p); setProfileReady(true) },
      () => setProfileReady(true))
    const fallback = setTimeout(() => setProfileReady(true), 6000)
    return () => { unsub(); clearTimeout(fallback) }
  }, [user.uid, user.displayName, user.avatar])

  const dailyDone = profile.lastDailyDate === todayKey()

  // Spaced-repetition snapshot for the home "Révision" card. Recomputed on
  // every return to the home screen (a game just changed the local schedule).
  const [reviewInfo, setReviewInfo] = useState<ReviewSummary>({ due: 0, missed: 0, learning: 0 })
  useEffect(() => { if (screen === 'home') setReviewInfo(reviewSummary(user.uid)) }, [screen, user.uid])

  function backToHome() {
    setScreen('home'); setGame(null); setPickedCat(null); setLastResult(null); setKidResult(null)
  }

  // Load questions and start playing. try/finally guarantees the spinner clears
  // even if a bank chunk fails to load; an empty result shows a gentle notice
  // instead of silently doing nothing.
  async function launch(
    build: () => Promise<PlayQuestion[]>,
    make: (questions: PlayQuestion[]) => Game,
    emptyMsg?: string,
  ) {
    setLoading(true)
    let questions: PlayQuestion[] = []
    try { questions = await build() } catch { questions = [] } finally { setLoading(false) }
    if (!questions.length) { alert(emptyMsg || t('quiz.loadFailed')); return }
    setGame(make(questions))
    setScreen('playing')
  }

  // Smart selection: instead of shuffling the whole bank, pick due reviews of
  // past misses first, then unseen questions, then whatever was seen least
  // recently - so you rarely see a repeat until it's genuinely time to review
  // it. Falls back to the plain builder when a level has no dedicated bank.
  function startGame(cat: QuizCategory, diff: QuizDifficulty) {
    return launch(async () => {
      const bank = await loadBank(cat, diff)
      if (!bank.length) return buildGame(cat, diff, lang)
      return pickForCategory(bank, user.uid, QUESTIONS_PER_GAME).map(q => present(q, cat, diff, lang))
    }, q => ({ questions: q, category: cat, difficulty: diff, mode: 'adult' }))
  }

  function startDaily() {
    return launch(() => buildDaily(lang), q => ({ questions: q, category: 'daily', difficulty: 'medium', mode: 'adult' }))
  }

  // Quick game from the home level card: random questions across everything.
  function startRandom() {
    return launch(() => buildRandom(lang), q => ({ questions: q, category: 'random', difficulty: 'easy', mode: 'adult' }))
  }

  // "Révision": a round built only from questions that are DUE for review -
  // the ones you got wrong come back first - across every category. Each
  // question keeps its real category and difficulty, so points stay fair.
  function startReview() {
    return launch(async () => {
      const loaded = await Promise.all(
        ADULT_CATEGORIES.flatMap(cat => QUIZ_DIFFICULTIES.map(d => loadBank(cat, d).then(b => ({ cat, d, b }))))
      )
      const pool: DueItem[] = []
      for (const { cat, d, b } of loaded) for (const q of b) pool.push({ cat, diff: d, q })
      return pickReview(pool, user.uid, QUESTIONS_PER_GAME).map(it => present(it.q, it.cat, it.diff, lang))
    }, q => ({ questions: q, category: 'random', difficulty: 'medium', mode: 'adult', review: true }),
    t('quiz.reviewCaughtUp'))
  }

  // Delete a child everywhere (scores server-side + the local name list). Throws
  // on failure so the confirm dialog can keep itself open and show an error.
  async function deleteKid(name: string) {
    await deleteKidEverywhere(user.uid, name)
    forgetKidName(name)
  }
  // Rename a child, migrating their scores, then update the local name list.
  async function renameKid(oldName: string, newName: string) {
    await renameKidEverywhere(user.uid, oldName, newName)
    forgetKidName(oldName)
    rememberKidName(newName)
  }

  function startKids(childName: string) {
    rememberKidName(childName)
    // Age-appropriate difficulty, falling back to whatever kids bank ships.
    const want = BAND_DIFF[getKidBand(childName)]
    const diff = ([want, 'easy', 'medium', 'hard'] as QuizDifficulty[]).find(d => bankAvailable('kids', d)) || 'easy'
    return launch(() => buildGame('kids', diff, lang), q => ({ questions: q, category: 'kids', difficulty: diff, mode: 'kids', childName }))
  }

  // Parcours: play the fixed 5 questions of one lesson, in order (not random) -
  // completing a lesson is repeatable, so the set has to be stable.
  function startLesson(cat: QuizCategory, diff: QuizDifficulty, index: number) {
    return launch(async () => {
      const bank = await loadBank(cat, diff)
      const lesson = lessonsOf(bank)[index]
      if (!lesson?.length) return []
      return lesson.map(q => present(q, cat, diff, lang))
    }, q => ({ questions: q, category: cat, difficulty: diff, mode: 'adult', lesson: { cat, diff, index } }))
  }

  async function finishGame(correctQuestions: PlayQuestion[]) {
    if (!game) return
    const total = game.questions.length
    const correct = correctQuestions.length

    if (game.mode === 'kids') {
      const childName = game.childName || t('quiz.kidFriend')
      recordKidMastery(childName, correctQuestions.map(q => q.id)) // confidence count
      let gained = 0
      try { gained = await commitKidsGame(user.uid, user.displayName, childName, correctQuestions.map(q => q.id)) } catch { /* offline */ }
      setKidResult({ childName, correct, total, gained })
      setScreen('results')
      return
    }

    // Adult: career points = every correct answer; learning points = NEW ones.
    const careerPoints = correctQuestions.reduce((s, q) => s + pointsFor(q.difficulty), 0)
    const newQs = correctQuestions.filter(q => !profile.mastered?.[q.id])
    const learningTotal = newQs.reduce((s, q) => s + pointsFor(q.difficulty), 0)
    const perCat: Partial<Record<QuizCategory, number>> = {}
    for (const q of newQs) perCat[q.category] = (perCat[q.category] || 0) + pointsFor(q.difficulty)

    const result: GameResult = {
      category: game.category, difficulty: game.difficulty,
      total, correct, points: careerPoints, learningPoints: learningTotal,
      newIds: newQs.map(q => q.id),
    }
    // Parcours: record this lesson's best stars / pass locally. Completion and
    // unlock derive from `mastered` (updated below), so no score is added here.
    if (game.lesson) recordLessonResult(user.uid, lessonId(game.lesson.cat, game.lesson.diff, game.lesson.index), correct, total)
    // Daily: note today in the local streak calendar (the authoritative streak
    // count + grace day are applied on the profile by applyResult).
    if (game.category === 'daily') recordDailyPlayed(user.uid, todayKey())

    const { profile: next, unlocked } = applyResult(profile, result)
    setProfile(next)
    setLastResult({ result, unlocked })
    setScreen('results')
    try { await commitAdultGame(next, perCat, learningTotal) } catch { /* offline: cache retries */ }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] quiz-bg overflow-y-auto">
        <div className="min-h-full max-w-lg mx-auto flex flex-col">
          {screen === 'home' && (
            <HomeScreen
              profile={profile} dailyDone={dailyDone} loading={loading || !profileReady}
              reviewInfo={reviewInfo}
              onClose={onClose}
              onPickCategory={c => { setPickedCat(c); setScreen('difficulty') }}
              onDaily={startDaily}
              onContinue={startRandom}
              onReview={startReview}
              onKids={() => setScreen('kidname')}
              onLeaders={() => setScreen('leaders')}
              onPalmares={() => setScreen('palmares')}
              onTrophies={() => setScreen('trophies')} />
          )}
          {screen === 'difficulty' && pickedCat && (
            <ParcoursScreen category={pickedCat} profile={profile} uid={user.uid} loading={loading}
              onBack={backToHome}
              onStartLesson={(diff, i) => startLesson(pickedCat, diff, i)}
              onQuickPlay={diff => startGame(pickedCat, diff)} />
          )}
          {screen === 'kidname' && (
            <KidNameScreen loading={loading} onBack={backToHome} onStart={startKids}
              onDeleteKid={deleteKid} onRenameKid={renameKid} />
          )}
          {screen === 'playing' && game && (
            <PlayScreen questions={game.questions}
              kid={game.mode === 'kids'} kidName={game.childName}
              onAnswered={game.mode === 'adult'
                ? (qid, correct) => recordAnswer(user.uid, qid, correct)
                : undefined}
              onQuit={() => { if (confirm(t('quiz.quitConfirm'))) backToHome() }}
              onFinish={finishGame} />
          )}
          {screen === 'results' && kidResult && (
            <KidResults r={kidResult}
              onReplay={() => startKids(kidResult.childName)}
              onLeaders={() => setScreen('leaders')} onHome={backToHome} />
          )}
          {screen === 'results' && !kidResult && lastResult && game && (
            <ResultsScreen result={lastResult.result} unlocked={lastResult.unlocked} profile={profile}
              onReplay={() => { if (game.lesson) startLesson(game.lesson.cat, game.lesson.diff, game.lesson.index); else if (game.review) startReview(); else if (game.category === 'daily') startDaily(); else if (game.category === 'random') startRandom(); else startGame(game.category as QuizCategory, game.difficulty) }}
              onHome={backToHome} onLeaders={() => setScreen('leaders')} />
          )}
          {screen === 'trophies' && (
            <TrophiesScreen profile={profile} onBack={backToHome} onLeaders={() => setScreen('leaders')} />
          )}
          {screen === 'leaders' && (
            <LeadersScreen uid={user.uid} onBack={backToHome} onPalmares={() => setScreen('palmares')} />
          )}
          {screen === 'palmares' && (
            <PalmaresScreen onBack={backToHome} />
          )}
        </div>
      </div>
    </Portal>
  )
}

// ---- Home -------------------------------------------------------------------
// The trailing-week streak calendar under the daily card: played days are ticked,
// today is ringed, and the current streak (grace-protected) shows on the right.
function StreakStrip({ uid, streak }: { uid: string; streak: number }) {
  const { language } = useLanguage()
  const cells = weekCalendar(uid, todayKey())
  const loc = language === 'fr' ? 'fr-FR' : 'en-US'
  return (
    <div className="px-4 pb-3 pt-0.5 flex items-end justify-between gap-1">
      {cells.map(c => {
        const label = new Date(c.key + 'T00:00:00Z').toLocaleDateString(loc, { weekday: 'narrow', timeZone: 'UTC' })
        return (
          <div key={c.key} className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-white/70 font-semibold uppercase">{label}</span>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
              c.played ? 'bg-white text-orange-700'
                : c.isToday ? 'bg-white/25 text-white ring-2 ring-white/60'
                : 'bg-white/10 text-white/50'}`}>
              {c.played ? '✓' : c.isToday ? '•' : ''}
            </div>
          </div>
        )
      })}
      {streak > 0 && <span className="text-white font-extrabold text-sm ml-1 self-center">🔥{streak}</span>}
    </div>
  )
}

function HomeScreen({ profile, dailyDone, loading, reviewInfo, onClose, onPickCategory, onDaily, onContinue, onReview, onKids, onLeaders, onPalmares, onTrophies }: {
  profile: QuizProfile; dailyDone: boolean; loading: boolean; reviewInfo: ReviewSummary
  onClose: () => void; onPickCategory: (c: QuizCategory) => void; onDaily: () => void; onContinue: () => void
  onReview: () => void; onKids: () => void; onLeaders: () => void; onPalmares: () => void; onTrophies: () => void
}) {
  const { t } = useLanguage()
  const lvl = levelProgress(profile.points)
  const acc = profile.answered ? Math.round((profile.correct / profile.answered) * 100) : 0
  const [champion, setChampion] = useState<TopScorer | null>(null)
  const [top3, setTop3] = useState<LeaderRow[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchTopScorer().then(c => { if (alive) setChampion(c) }).catch(() => {})
    fetchGrandLeaders(3).then(r => { if (alive) setTop3(r) }).catch(() => { if (alive) setTop3([]) })
    return () => { alive = false }
  }, [profile.points])
  const champName = champion ? (champion.uid === profile.uid ? t('quiz.you') : champion.name) : ''
  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <div className="flex items-center justify-between gap-2 mb-2">
        <button onClick={onTrophies} className="p-2 rounded-full text-white/90 hover:bg-white/10 shrink-0" aria-label={t('quiz.trophies')}>
          <Trophy size={22} />
        </button>
        <button onClick={onLeaders} className="flex-1 min-w-0 flex justify-center" aria-label={t('quiz.champion')}>
          {champion && (
            <span className="inline-flex items-center gap-1.5 max-w-full bg-white/20 border border-white/40 rounded-full pl-2.5 pr-3 py-1.5">
              <span className="text-base leading-none">👑</span>
              <span className="min-w-0 truncate text-white font-bold text-sm leading-tight">{champName}</span>
              <span className="shrink-0 text-white/80 text-xs font-semibold">{champion.points.toLocaleString()} {t('quiz.pts')}</span>
            </span>
          )}
        </button>
        <button onClick={onClose} className="p-2 rounded-full text-white/90 hover:bg-white/10 shrink-0" aria-label={t('quiz.back')}>
          <X size={22} />
        </button>
      </div>
      {champion && (
        <p className="text-center text-on-bg text-[11px] font-semibold -mt-1 mb-3">{t('quiz.championWeek')}</p>
      )}

      <div className="text-center mb-4">
        <div className="text-5xl mb-1 quiz-anim-bounce inline-block">🏆</div>
        <h1 className="text-3xl font-extrabold text-white" translate="no">{t('quiz.title')}</h1>
        <p className="text-on-bg text-sm mt-1">{t('quiz.subtitle')}</p>
      </div>

      <div className="flex items-center justify-center gap-2 mb-4 text-white/95 text-sm font-semibold">
        <BookOpen size={16} /> {t('quiz.openBookHint')}
      </div>

      {/* Big Kids button */}
      <button onClick={onKids} disabled={loading}
        className="quiz-shine w-full text-left rounded-3xl p-5 mb-4 flex items-center gap-4 bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 shadow-xl disabled:opacity-70">
        <div className="text-5xl shrink-0 quiz-anim-bounce">🎈</div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-white text-xl leading-tight">{t('quiz.kidsTitle')}</p>
          <p className="text-sm text-white/90">{t('quiz.kidsSubtitle')}</p>
        </div>
        <span className="shrink-0 bg-white text-fuchsia-700 font-extrabold rounded-full px-5 py-2.5">{t('quiz.play')}</span>
      </button>

      {/* Player card - tap to keep playing with random questions */}
      <button onClick={onContinue} disabled={loading}
        className="w-full text-left glass glass-hover rounded-3xl p-4 mb-4 flex items-center gap-4 disabled:opacity-70">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
          {profile.displayName?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-bold text-slate-800 truncate flex items-center gap-1">
              {t('quiz.level')} {lvl.level}
              {(profile.weeksWon || 0) > 0 && <span className="text-amber-500 text-xs font-extrabold">👑{profile.weeksWon}</span>}
            </p>
            <p className="text-affirm-600 font-extrabold text-lg leading-none">{profile.points.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{t('quiz.pts')}</span></p>
          </div>
          <p className="text-xs text-slate-500 truncate mb-1.5">
            « {t(`quiz.lvl.${lvl.level}` as any)} »{profile.dailyStreak > 0 ? ` · 🔥 ${profile.dailyStreak} ${t('quiz.streakDays')}` : ''}
          </p>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all" style={{ width: `${Math.round(lvl.ratio * 100)}%` }} />
          </div>
          <p className="text-[11px] font-bold text-affirm-600 mt-1.5 flex items-center gap-1">▶ {t('quiz.continuePlay')}</p>
        </div>
      </button>

      {/* Daily challenge + streak calendar */}
      <div className="rounded-3xl mb-4 bg-gradient-to-r from-orange-700 to-amber-700 shadow-lg overflow-hidden">
        <button onClick={onDaily} disabled={loading}
          className="w-full text-left p-4 flex items-center gap-3 disabled:opacity-70">
          <div className="text-3xl shrink-0 quiz-anim-wiggle">⭐</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white">{t('quiz.daily')} · <span className="font-semibold text-white/85">{t(`quiz.theme${dailyThemeIndex(todayKey())}` as any)}</span></p>
            <p className="text-xs text-white/80">{dailyDone ? `${t('quiz.dailyDone')} ✓` : t('quiz.dailyDesc')}</p>
          </div>
          <span className="shrink-0 bg-white text-orange-700 font-bold text-sm rounded-full px-4 py-2">{t('quiz.play')}</span>
        </button>
        <StreakStrip uid={profile.uid} streak={profile.dailyStreak} />
      </div>

      {/* Spaced-repetition review: appears once the player has questions due to
          come back (mistakes first). Tapping builds a round from just those. */}
      {reviewInfo.due > 0 && (
        <button onClick={onReview} disabled={loading}
          className="w-full text-left rounded-3xl p-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-emerald-600 to-teal-700 shadow-lg disabled:opacity-70">
          <div className="text-3xl shrink-0">🎯</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white">{t('quiz.reviewTitle')}</p>
            <p className="text-xs text-white/80">
              {reviewInfo.missed > 0
                ? t('quiz.reviewMissed').replace('{n}', String(reviewInfo.missed))
                : t('quiz.reviewDue').replace('{n}', String(reviewInfo.due))}
            </p>
          </div>
          <span className="shrink-0 bg-white text-teal-700 font-bold text-sm rounded-full px-4 py-2">{t('quiz.reviewCta')}</span>
        </button>
      )}

      {/* Weekly ranking preview - the main motivation, front and centre */}
      <button onClick={onLeaders} className="w-full glass glass-hover rounded-3xl p-4 mb-3 text-left">
        <div className="flex items-center justify-between mb-2">
          <p className="font-extrabold text-slate-800 flex items-center gap-2"><Medal size={18} className="text-amber-500" /> {t('quiz.rankingWeek')}</p>
          <span className="text-affirm-600 text-sm font-bold">{t('quiz.seeAll')} →</span>
        </div>
        {top3 === null ? (
          <div className="py-3 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-300" /></div>
        ) : top3.length > 0 ? (
          <div className="space-y-1.5">
            {top3.map((r, i) => (
              <div key={r.uid} className="flex items-center gap-2">
                <span className="w-6 text-center text-lg">{['🥇', '🥈', '🥉'][i]}</span>
                <span className="flex-1 font-bold text-slate-700 truncate">{r.uid === profile.uid ? `${t('quiz.you')} (${r.name})` : r.name}</span>
                <span className="font-extrabold text-affirm-600 text-sm">{r.points.toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">🌟 {t('quiz.beFirst')}</p>
        )}
      </button>

      <button onClick={onPalmares} className="w-full glass glass-hover rounded-2xl py-3 mb-5 flex items-center justify-center gap-2 font-bold text-affirm-700">
        <ScrollText size={17} /> {t('quiz.palmares')}
      </button>

      <h2 className="font-extrabold text-white mb-3 px-1">{t('quiz.chooseCategory')}</h2>
      <div className="grid grid-cols-2 gap-3">
        {ADULT_CATEGORIES.map(cat => {
          const ready = QUIZ_DIFFICULTIES.some(d => bankAvailable(cat, d))
          const meta = CATEGORY_META[cat]
          return (
            <button key={cat} onClick={() => ready && onPickCategory(cat)} disabled={!ready}
              className={`glass rounded-2xl p-3.5 text-left transition ${ready ? 'glass-hover' : 'opacity-60'}`}>
              <div className={`w-11 h-11 rounded-xl ${meta.tint} flex items-center justify-center text-xl mb-2`}>{meta.emoji}</div>
              <p className="font-bold text-slate-800 text-sm leading-tight">{t(`quiz.cat.${cat}` as any)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{ready ? t('quiz.difficulty') : t('quiz.comingSoon')}</p>
            </button>
          )
        })}
      </div>

      {profile.gamesPlayed > 0 && (
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat n={profile.gamesPlayed} label={t('quiz.games')} />
          <Stat n={`${acc}%`} label={t('quiz.accuracy')} />
          <Stat n={profile.badges.length} label={t('quiz.trophies')} />
        </div>
      )}
    </div>
  )
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="glass rounded-2xl py-3">
      <p className="text-xl font-extrabold text-affirm-600 leading-none">{n}</p>
      <p className="text-[11px] text-slate-500 mt-1">{label}</p>
    </div>
  )
}

// ---- Difficulty picker ------------------------------------------------------
// The category screen is now the PARCOURS: three levels of five-question
// lessons, each level unlocking the next. Completion is derived from the
// player's mastered map (so it back-fills), with a local star record.
function ParcoursScreen({ category, profile, uid, loading, onBack, onStartLesson, onQuickPlay }: {
  category: QuizCategory; profile: QuizProfile; uid: string; loading: boolean
  onBack: () => void
  onStartLesson: (d: QuizDifficulty, index: number) => void
  onQuickPlay: (d: QuizDifficulty) => void
}) {
  const { t } = useLanguage()
  const meta = CATEGORY_META[category]
  const [banks, setBanks] = useState<Record<QuizDifficulty, BankQuestion[]> | null>(null)
  const [level, setLevel] = useState<QuizDifficulty>('easy')

  useEffect(() => {
    let alive = true
    Promise.all(QUIZ_DIFFICULTIES.map(d => loadBank(category, d)))
      .then(([easy, medium, hard]) => { if (alive) setBanks({ easy, medium, hard }) })
      .catch(() => { if (alive) setBanks({ easy: [], medium: [], hard: [] }) })
    return () => { alive = false }
  }, [category])

  // Level completion/unlock derive live from the current mastered map, so
  // finishing a lesson updates the map on the next screen visit.
  const states = useMemo(() => {
    const b = banks || { easy: [], medium: [], hard: [] }
    const s = {} as Record<QuizDifficulty, LevelState>
    for (const d of QUIZ_DIFFICULTIES) s[d] = levelState(b[d], profile.mastered, category, d, uid)
    return s
  }, [banks, profile.mastered, category, uid])
  const complete = { easy: states.easy.complete, medium: states.medium.complete, hard: states.hard.complete }

  // Land on the first unlocked, unfinished level.
  useEffect(() => {
    if (!banks) return
    const target = QUIZ_DIFFICULTIES.find(d => levelUnlocked(d, complete) && !complete[d])
      || [...QUIZ_DIFFICULTIES].reverse().find(d => levelUnlocked(d, complete)) || 'easy'
    setLevel(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks])

  const cur = states[level]
  const dots: Record<QuizDifficulty, string> = { easy: '●○○', medium: '●●○', hard: '●●●' }

  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="text-center my-5">
        <div className={`w-20 h-20 mx-auto rounded-3xl ${meta.tint} flex items-center justify-center text-4xl mb-3`}>{meta.emoji}</div>
        <h1 className="text-2xl font-extrabold text-white">{t(`quiz.cat.${category}` as any)}</h1>
      </div>

      {/* Level tabs */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {QUIZ_DIFFICULTIES.map(diff => {
          const unlocked = levelUnlocked(diff, complete)
          const st = states[diff]
          const active = level === diff
          return (
            <button key={diff} disabled={!unlocked} onClick={() => setLevel(diff)}
              className={`rounded-2xl px-2 py-2.5 text-center border transition ${
                active ? 'bg-white border-white shadow' : 'bg-white/10 border-white/20'} ${!unlocked ? 'opacity-50' : ''}`}>
              <div className={`text-xs tracking-widest font-bold ${active ? 'text-affirm-600' : 'text-white/90'}`}>{dots[diff]}</div>
              <div className={`text-sm font-bold ${active ? 'text-slate-800' : 'text-white'}`}>{t(`quiz.${diff}` as any)}</div>
              <div className={`text-[11px] font-semibold flex items-center justify-center gap-1 ${active ? 'text-slate-500' : 'text-white/80'}`}>
                {!unlocked ? <><Lock size={11} /> {t('quiz.locked')}</>
                  : st.complete ? <><Check size={12} className="text-emerald-500" /> {t('quiz.done')}</>
                  : st.total ? `${st.passed}/${st.total}` : '—'}
              </div>
            </button>
          )
        })}
      </div>

      {!banks ? (
        <div className="py-16 text-center"><Loader2 size={26} className="animate-spin mx-auto text-white/70" /></div>
      ) : !levelUnlocked(level, complete) ? (
        <p className="text-center text-white/80 text-sm py-10">{t('quiz.levelLocked')}</p>
      ) : cur.total === 0 ? (
        <div className="glass rounded-2xl p-5 text-center">
          <p className="text-sm text-slate-600 mb-3">{t('quiz.noLessonsYet')}</p>
          <button onClick={() => !loading && onQuickPlay(level)} disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-affirm-600 text-white font-semibold">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} {t('quiz.train10')}
          </button>
        </div>
      ) : (
        <>
          {/* Level progress */}
          <div className="glass rounded-2xl p-3.5 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('quiz.lessons')}</span>
              <span className="text-xs font-bold text-affirm-600">{cur.passed}/{cur.total}{cur.complete ? ' ✓' : ''}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(cur.passed / cur.total) * 100}%` }} />
            </div>
          </div>

          {/* Lesson grid */}
          <div className="grid grid-cols-4 gap-2.5 mb-4">
            {cur.lessons.map((lesson, i) => {
              const id = lessonId(category, level, i)
              const stars = lessonStars(uid, id)
              const isDone = lessonPassed(lesson, profile.mastered, uid, id)
              return (
                <button key={i} onClick={() => !loading && onStartLesson(level, i)} disabled={loading}
                  className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 border-2 transition ${
                    isDone ? 'bg-emerald-50 border-emerald-300' : 'glass border-white/40'}`}>
                  <span className={`text-lg font-extrabold ${isDone ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {isDone ? <Check size={20} /> : i + 1}
                  </span>
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map(s => (
                      <Star key={s} size={9} className={s < stars ? 'text-amber-400 fill-amber-400' : 'text-slate-300'} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>

          <button onClick={() => !loading && onQuickPlay(level)} disabled={loading}
            className="w-full glass glass-hover rounded-2xl p-3.5 flex items-center justify-center gap-2 text-sm font-bold text-slate-700">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} className="text-affirm-500" />} {t('quiz.train10')}
          </button>
        </>
      )}
    </div>
  )
}

// ---- Kids name entry --------------------------------------------------------
function KidNameScreen({ loading, onBack, onStart, onDeleteKid, onRenameKid }: {
  loading: boolean; onBack: () => void; onStart: (name: string) => void
  onDeleteKid: (name: string) => Promise<void>
  onRenameKid: (oldName: string, newName: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const [saved, setSaved] = useState<string[]>(() => loadKidNames())
  // Start on the "add a child" form only when there are no saved kids yet;
  // otherwise show the picker so a returning family lands on their children.
  const [adding, setAdding] = useState(() => saved.length === 0)
  const [name, setName] = useState('')
  const [band, setBand] = useState<AgeBand>('mid')
  const ok = name.trim().length >= 2

  // Long-press (or right-click) a child to open Edit / Delete. A plain tap still
  // starts the game - longPressed guards the click that follows a long press.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  // When the menu opened, so the synthetic click that follows a touch long-press
  // (which hit-tests to the just-rendered backdrop) doesn't immediately close it.
  const menuOpenedAt = useRef(0)

  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current) }, [])

  const openMenu = (n: string) => { menuOpenedAt.current = Date.now(); setMenuFor(n) }
  const closeMenu = () => { if (Date.now() - menuOpenedAt.current < 500) return; setMenuFor(null) }
  const refresh = () => { const next = loadKidNames(); setSaved(next); if (next.length === 0) setAdding(true) }
  const startPress = (n: string) => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; openMenu(n) }, 500)
  }
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  const tapKid = (n: string) => { if (longPressed.current) { longPressed.current = false; return } if (!loading) onStart(n) }

  const beginEdit = (n: string) => { setMenuFor(null); setErr(''); setEditName(n); setEditing(n) }
  const beginDelete = (n: string) => { setMenuFor(null); setErr(''); setConfirmText(''); setDeleting(n) }

  const saveEdit = async () => {
    const nn = editName.trim()
    if (!editing || nn.length < 2 || busy) return
    // Don't let a rename collide with a DIFFERENT existing child - that would
    // merge two children's scores into one. (A pure case/spacing tweak of the
    // same child has the same key and is allowed.)
    if (kidKey(nn) !== kidKey(editing) && saved.some(o => kidKey(o) === kidKey(nn))) {
      setErr(t('quiz.kidNameTaken')); return
    }
    setBusy(true); setErr('')
    try { await onRenameKid(editing, nn); setEditing(null); refresh() }
    catch (e: any) {
      // Server caught a collision the local list couldn't see (target child
      // exists only on another device).
      setErr(e?.message === 'KID_NAME_TAKEN' ? t('quiz.kidNameTaken') : t('quiz.kidActionFailed'))
    }
    finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting || busy) return
    if (kidKey(confirmText) !== kidKey(deleting)) { setErr(t('quiz.kidNameMismatch')); return }
    setBusy(true); setErr('')
    try { await onDeleteKid(deleting); setDeleting(null); refresh() }
    catch { setErr(t('quiz.kidActionFailed')) }
    finally { setBusy(false) }
  }

  return (
    <div className="px-4 pt-4 pb-10 safe-top flex flex-col min-h-full">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="text-7xl mb-3 quiz-anim-bounce">🎈</div>
        <h1 className="text-2xl font-extrabold text-white mb-1">{t('quiz.kidsTitle')}</h1>

        {!adding && saved.length > 0 ? (
          <>
            <p className="text-on-bg mb-1">{t('quiz.kidWhoPlaying')} 😊</p>
            <p className="text-on-bg text-xs opacity-80 mb-4">{t('quiz.kidLongPressHint')}</p>
            <div className="w-full max-w-xs space-y-2 mb-5">
              {saved.map(n => (
                <button key={n}
                  onClick={() => tapKid(n)}
                  onPointerDown={() => startPress(n)}
                  onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
                  onContextMenu={e => { e.preventDefault(); endPress(); openMenu(n) }}
                  disabled={loading}
                  className="quiz-shine w-full rounded-2xl bg-white text-slate-800 font-extrabold text-lg py-4 px-4 shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 select-none">
                  🎈 <span className="truncate">{n}</span>
                  {kidMasteryCount(n) > 0 && <span className="ml-1 text-xs font-bold text-violet-500 shrink-0">⭐{kidMasteryCount(n)}</span>}
                </button>
              ))}
            </div>
            <button onClick={() => { setName(''); setAdding(true) }}
              className="w-full max-w-xs rounded-2xl border-2 border-white/50 text-white font-bold text-base py-3.5 hover:bg-white/10">
              ➕ {t('quiz.kidAddAnother')}
            </button>
          </>
        ) : (
          <>
            <p className="text-on-bg mb-6">{t('quiz.kidNamePrompt')} 😊</p>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder={t('quiz.kidNamePlaceholder')} autoFocus maxLength={40}
              onKeyDown={e => { if (e.key === 'Enter' && ok && !loading) { setKidBand(name.trim(), band); onStart(name.trim()) } }}
              className="w-full max-w-xs text-center text-lg font-bold rounded-2xl bg-white text-slate-800 px-4 py-4 shadow-lg focus:outline-none focus:ring-4 focus:ring-white/50 mb-3" />
            <p className="text-on-bg text-xs font-semibold mb-2">{t('quiz.kidAge')}</p>
            <div className="w-full max-w-xs grid grid-cols-3 gap-2 mb-6">
              {(['young', 'mid', 'older'] as AgeBand[]).map(b => (
                <button key={b} onClick={() => setBand(b)}
                  className={`rounded-2xl py-2.5 text-sm font-bold border-2 transition ${
                    band === b ? 'bg-white text-violet-600 border-white' : 'bg-white/10 text-white border-white/30'}`}>
                  {t(`quiz.kidAge_${b}` as any)}
                </button>
              ))}
            </div>
            <button onClick={() => { if (ok) { setKidBand(name.trim(), band); onStart(name.trim()) } }} disabled={!ok || loading}
              className="quiz-shine w-full max-w-xs rounded-2xl bg-gradient-to-r from-pink-500 to-violet-500 text-white font-extrabold text-lg py-4 shadow-xl disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={20} /> : <>{t('quiz.kidStart')} 🎉</>}
            </button>
            {saved.length > 0 && (
              <button onClick={() => setAdding(false)}
                className="mt-3 text-white/90 text-sm font-semibold hover:underline">
                {t('quiz.kidBackToList')}
              </button>
            )}
          </>
        )}
      </div>

      {/* Long-press options: edit or delete */}
      {menuFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={closeMenu}>
          <div className="w-full max-w-xs bg-white rounded-t-3xl sm:rounded-3xl p-4 sm:m-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-center font-extrabold text-slate-800 mb-3 truncate">🎈 {menuFor}</p>
            <button onClick={() => beginEdit(menuFor)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-slate-100 text-slate-800 font-semibold">
              <Pencil size={18} /> {t('quiz.kidEdit')}
            </button>
            <button onClick={() => beginDelete(menuFor)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-red-50 text-red-600 font-semibold">
              <Trash2 size={18} /> {t('quiz.kidDelete')}
            </button>
            <button onClick={() => setMenuFor(null)} className="w-full text-center px-4 py-3 mt-1 rounded-2xl text-slate-500 font-semibold hover:bg-slate-100">
              {t('quiz.kidCancel')}
            </button>
          </div>
        </div>
      )}

      {/* Edit (rename) a child */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && setEditing(null)}>
          <div className="w-full max-w-xs bg-white rounded-3xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-extrabold text-slate-800 text-lg mb-3">{t('quiz.kidEditTitle')}</h3>
            <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={40} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
              className="w-full text-center text-lg font-bold rounded-2xl bg-slate-100 text-slate-800 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-affirm-400 mb-2" />
            {err && <p className="text-red-500 text-sm mb-1 text-center">{err}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setEditing(null)} disabled={busy} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold">{t('quiz.kidCancel')}</button>
              <button onClick={saveEdit} disabled={busy || editName.trim().length < 2} className="flex-1 py-3 rounded-2xl bg-affirm-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={18} className="animate-spin" /> : t('quiz.kidSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete a child - must retype the name first */}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && setDeleting(null)}>
          <div className="w-full max-w-xs bg-white rounded-3xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mx-auto mb-3"><Trash2 size={22} /></div>
            <h3 className="font-extrabold text-slate-800 text-lg text-center mb-1">{t('quiz.kidDeleteTitle')}</h3>
            <p className="text-slate-500 text-sm text-center mb-4">{t('quiz.kidDeleteWarn')}</p>
            <p className="text-slate-600 text-sm text-center mb-2">{t('quiz.kidDeleteRetype')} <b className="text-slate-800">{deleting}</b></p>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} maxLength={40} autoFocus
              placeholder={t('quiz.kidDeleteInputPlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
              className="w-full text-center text-base font-bold rounded-2xl bg-slate-100 text-slate-800 placeholder:font-normal placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400 mb-2" />
            {err && <p className="text-red-500 text-sm mb-1 text-center">{err}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setDeleting(null)} disabled={busy} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold">{t('quiz.kidCancel')}</button>
              <button onClick={confirmDelete} disabled={busy || kidKey(confirmText) !== kidKey(deleting)} className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={18} className="animate-spin" /> : t('quiz.kidDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Playing ----------------------------------------------------------------
function PlayScreen({ questions, kid, kidName, onAnswered, onQuit, onFinish }: {
  questions: PlayQuestion[]; kid?: boolean; kidName?: string
  onAnswered?: (qid: string, correct: boolean) => void
  onQuit: () => void; onFinish: (correct: PlayQuestion[]) => void
}) {
  const { t } = useLanguage()
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correctList, setCorrectList] = useState<PlayQuestion[]>([])
  const [points, setPoints] = useState(0)
  const [gained, setGained] = useState(0)
  // Kids only: options tried and found wrong stay disabled, but the child keeps
  // trying until they get it right — errorless learning, no penalty, no shame.
  const [tries, setTries] = useState<Set<number>>(() => new Set())

  const q = questions[idx]
  const answered = picked !== null

  function lockAnswer(choice: number) {
    if (picked !== null || tries.has(choice)) return
    const correct = choice === q.correct
    if (kid && !correct) { emit('quiz.retry'); setTries(prev => new Set(prev).add(choice)); return } // try again
    emit(correct ? 'quiz.correct' : 'quiz.wrong')
    const pts = correct ? pointsFor(q.difficulty) : 0
    if (correct) { setCorrectList(prev => [...prev, q]); setPoints(p => p + pts) }
    setGained(pts)
    setPicked(choice)
    onAnswered?.(q.id, correct)   // feed the spaced-repetition schedule
  }

  function next() {
    if (idx + 1 >= questions.length) { onFinish(correctList); return }
    setIdx(i => i + 1); setPicked(null); setGained(0); setTries(new Set())
  }

  return (
    <div className="px-4 pt-4 pb-6 safe-top flex flex-col min-h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/30 rounded-full px-3 py-1.5 text-white text-sm font-semibold min-w-0 truncate">
          {kid ? '🎈' : CATEGORY_META[q.category].emoji} <span className="truncate">{kid ? (kidName || t('quiz.kidsTitle')) : t(`quiz.cat.${q.category}` as any)}</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/30 text-white rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap">
            <BookOpen size={14} /> {t('quiz.openBook')}
          </span>
          <button onClick={onQuit} className="p-2 rounded-full text-white/80 hover:bg-white/10" aria-label={t('quiz.quit')}><X size={20} /></button>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-white/25 mb-2 overflow-hidden">
        <div className="h-full bg-white rounded-full transition-all" style={{ width: `${((idx + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-between text-white/90 text-sm font-semibold mb-3">
        <span>{t('quiz.question')} {idx + 1} / {questions.length}</span>
        <span className="relative">
          <span key={points} className="quiz-anim-bump inline-block">{points} {t('quiz.pts')}</span>
          {answered && gained > 0 && (
            <span key={`g${idx}`} className="quiz-anim-floatup absolute -top-4 right-0 text-emerald-200 font-extrabold whitespace-nowrap">+{gained}</span>
          )}
        </span>
      </div>

      <div key={idx} className="glass rounded-3xl p-5 flex-1 quiz-anim-pop">
        <h2 className="text-xl font-extrabold text-slate-800 leading-snug mb-4">{q.text}</h2>
        <div className="space-y-2.5">
          {q.options.map((opt, i) => {
            const isCorrect = i === q.correct
            const isPicked = i === picked
            const isTried = tries.has(i) // kid: tried and wrong (disabled, not fatal)
            let cls = 'border-slate-200 bg-white'
            let badge = 'bg-slate-100 text-slate-500'
            if (answered && isCorrect) { cls = 'border-emerald-400 bg-emerald-50'; badge = 'bg-emerald-500 text-white' }
            else if ((answered && isPicked && !isCorrect) || isTried) { cls = 'border-red-400 bg-red-50'; badge = 'bg-red-500 text-white' }
            else if (answered) { cls = 'border-slate-200 bg-white opacity-60' }
            const anim = isTried ? 'quiz-anim-shake' : !answered ? 'quiz-anim-in' : isCorrect ? 'quiz-anim-correct' : (isPicked ? 'quiz-anim-shake' : '')
            return (
              <button key={i} onClick={() => lockAnswer(i)} disabled={answered || isTried}
                style={!answered && !isTried ? { animationDelay: `${i * 70}ms` } : undefined}
                className={`w-full flex items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition ${cls} ${anim}`}>
                <span className={`w-8 h-8 rounded-full grid place-items-center font-bold text-sm shrink-0 ${badge}`}>
                  {answered && isCorrect ? <Check size={16} /> : (isTried || (answered && isPicked && !isCorrect)) ? <X size={16} /> : String.fromCharCode(65 + i)}
                </span>
                <span className="font-semibold text-slate-800 text-[15px]">{opt}</span>
              </button>
            )
          })}
        </div>

        {kid && tries.size > 0 && !answered && (
          <p className="mt-3 text-center text-sm font-bold text-violet-500 quiz-anim-in">{t('quiz.kidTryAgain')} 💪</p>
        )}

        {answered && (
          <div className={`mt-4 rounded-2xl p-3.5 text-sm font-medium quiz-anim-in ${gained > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            <p className="font-bold mb-0.5">
              {picked === q.correct ? `✅ ${t('quiz.correct')}` : `❌ ${t('quiz.wrong')}`}
              {q.ref ? ` — ${q.ref}` : ''}
            </p>
            <p>{q.explain}</p>
            {gained > 0 && <p className="mt-1 text-emerald-600 font-bold">+{gained} {t('quiz.pts')}</p>}
          </div>
        )}
      </div>

      {answered && (
        <button onClick={next} className="quiz-shine mt-4 w-full rounded-2xl bg-gradient-to-r from-orange-700 to-amber-700 text-white font-bold py-4 shadow-lg">
          {idx + 1 >= questions.length ? t('quiz.seeResults') : t('quiz.next')} →
        </button>
      )}
    </div>
  )
}

// ---- Results (adult) --------------------------------------------------------
function useCountUp(target: number, ms = 900): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return n
}

function ResultsScreen({ result, unlocked, profile, onReplay, onHome, onLeaders }: {
  result: GameResult; unlocked: BadgeId[]; profile: QuizProfile
  onReplay: () => void; onHome: () => void; onLeaders: () => void
}) {
  const { t } = useLanguage()
  const stars = starsFor(result.correct, result.total)
  // A celebratory earcon on landing: the bigger fanfare when a badge was
  // unlocked or the round was perfect, otherwise a warm result chord.
  useEffect(() => { emit(unlocked.length > 0 || stars >= 3 ? 'quiz.levelup' : 'quiz.result') }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const medal = stars >= 3 ? '🥇' : stars === 2 ? '🥈' : stars === 1 ? '🥉' : '🎖️'
  const good = result.correct >= result.total / 2
  const lvl = levelProgress(profile.points)
  const shownPoints = useCountUp(result.points)

  async function share() {
    const text = t('quiz.shareText').replace('{score}', String(result.correct)).replace('{total}', String(result.total))
    try { await Share.share({ title: t('quiz.title'), text: `${text} ${PLAY_URL}`, url: PLAY_URL }) }
    catch { try { if (navigator.share) await navigator.share({ title: t('quiz.title'), text, url: PLAY_URL }) } catch { /* cancelled */ } }
  }

  return (
    <div className="px-4 pt-6 pb-10 safe-top text-center relative overflow-hidden">
      <PrizeBurst strong={good} />
      <h1 className="text-3xl font-extrabold text-white mb-1">{good ? `${t('quiz.bravo')} 🎉` : t('quiz.goodTry')}</h1>
      <p className="text-on-bg">{result.category === 'daily' ? t('quiz.daily') : result.category === 'random' ? t('quiz.randomGame') : t(`quiz.cat.${result.category}` as any)} · <b className="text-white">{result.correct} / {result.total}</b> {t('quiz.rightAnswers')}</p>
      {result.learningPoints > 0 && (
        <p className="text-emerald-200 text-sm font-bold mt-1">✨ +{result.learningPoints.toLocaleString()} {t('quiz.learningPts')}</p>
      )}

      <div className="flex justify-center gap-1.5 my-4 text-4xl">
        {[0, 1, 2].map(i => (
          <span key={i} className={i < stars ? 'quiz-anim-star inline-block' : 'opacity-25 grayscale'} style={{ animationDelay: `${300 + i * 220}ms` }}>⭐</span>
        ))}
      </div>

      <div className="relative w-40 h-40 mx-auto my-2 grid place-items-center">
        <div className="absolute w-32 h-32 rounded-full bg-amber-300/50 blur-2xl quiz-anim-glow" />
        <div className="relative text-8xl quiz-anim-medal">{medal}</div>
      </div>
      <p className="text-2xl font-extrabold text-white mb-4 quiz-anim-pop">+ {shownPoints.toLocaleString()} {t('quiz.points')}</p>

      {unlocked.length > 0 && (
        <div className="glass rounded-2xl p-4 mb-4 text-left flex items-start gap-3 quiz-anim-badge">
          <div className="text-3xl quiz-anim-bounce inline-block">{BADGE_EMOJI[unlocked[0]]}</div>
          <div>
            <p className="text-xs font-semibold text-affirm-600 uppercase tracking-wide">{t('quiz.newBadge')}</p>
            <p className="font-bold text-slate-800">{t(`quiz.badge.${unlocked[0]}.name` as any)}</p>
            <p className="text-xs text-slate-500">{t(`quiz.badge.${unlocked[0]}.desc` as any)}</p>
            {unlocked.length > 1 && <p className="text-xs text-slate-400 mt-0.5">+{unlocked.length - 1}</p>}
          </div>
        </div>
      )}

      <div className="glass rounded-2xl p-4 mb-5">
        <div className="flex justify-between text-sm font-semibold text-slate-700 mb-1.5">
          <span>{t('quiz.level')} {lvl.level}{lvl.next ? ` → ${lvl.level + 1}` : ''}</span>
          <span>{Math.round(lvl.ratio * 100)}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full" style={{ width: `${Math.round(lvl.ratio * 100)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <button onClick={onReplay} className="glass rounded-2xl py-3.5 font-bold text-affirm-700 flex items-center justify-center gap-2"><RotateCcw size={17} /> {t('quiz.replay')}</button>
        <button onClick={share} className="glass rounded-2xl py-3.5 font-bold text-affirm-700 flex items-center justify-center gap-2"><Share2 size={17} /> {t('quiz.share')}</button>
      </div>
      <button onClick={onLeaders} className="quiz-shine w-full rounded-2xl bg-gradient-to-r from-orange-700 to-amber-700 text-white font-bold py-3.5 mb-2 flex items-center justify-center gap-2"><Medal size={17} /> {t('quiz.ranking')}</button>
      <button onClick={onHome} className="w-full py-2 text-white/80 font-semibold text-sm">{t('quiz.back')}</button>
    </div>
  )
}

// ---- Results (kids) ---------------------------------------------------------
function KidResults({ r, onReplay, onLeaders, onHome }: {
  r: { childName: string; correct: number; total: number; gained: number }
  onReplay: () => void; onLeaders: () => void; onHome: () => void
}) {
  const { t } = useLanguage()
  const stars = starsFor(r.correct, r.total)
  const shown = useCountUp(r.gained)
  return (
    <div className="px-4 pt-8 pb-10 safe-top text-center relative overflow-hidden">
      <PrizeBurst strong />
      <h1 className="text-3xl font-extrabold text-white mb-1">{t('quiz.bravo')} {r.childName} 🎉</h1>
      <p className="text-on-bg"><b className="text-white">{r.correct} / {r.total}</b> {t('quiz.rightAnswers')}</p>
      <div className="flex justify-center gap-1.5 my-4 text-5xl">
        {[0, 1, 2].map(i => (
          <span key={i} className={i < stars ? 'quiz-anim-star inline-block' : 'opacity-25 grayscale'} style={{ animationDelay: `${300 + i * 220}ms` }}>⭐</span>
        ))}
      </div>
      <div className="relative w-44 h-44 mx-auto my-2 grid place-items-center">
        <div className="absolute w-36 h-36 rounded-full bg-fuchsia-300/50 blur-2xl quiz-anim-glow" />
        <div className="relative text-8xl quiz-anim-medal">🎈</div>
      </div>
      <p className="text-2xl font-extrabold text-white mb-6 quiz-anim-pop">+ {shown.toLocaleString()} {t('quiz.points')}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <button onClick={onReplay} className="glass rounded-2xl py-3.5 font-bold text-fuchsia-700 flex items-center justify-center gap-2"><RotateCcw size={17} /> {t('quiz.replay')}</button>
        <button onClick={onLeaders} className="glass rounded-2xl py-3.5 font-bold text-fuchsia-700 flex items-center justify-center gap-2"><Medal size={17} /> {t('quiz.ranking')}</button>
      </div>
      <button onClick={onHome} className="w-full py-2 text-white/80 font-semibold text-sm">{t('quiz.back')}</button>
    </div>
  )
}

function PrizeBurst({ strong }: { strong: boolean }) {
  const bits = useMemo(() => {
    const emojis = strong ? ['🎉', '🏆', '⭐', '✨', '🎊', '💫', '🥇'] : ['✨', '⭐']
    const colors = ['#fbbf24', '#f97316', '#34d399', '#60a5fa', '#f472b6', '#a78bfa']
    const count = strong ? 40 : 16
    return Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 0.9, dur: 1.8 + Math.random() * 1.9,
      emoji: i % 3 === 0 ? emojis[i % emojis.length] : null,
      color: colors[i % colors.length], size: 7 + Math.random() * 7,
    }))
  }, [strong])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {bits.map((b, i) => b.emoji
        ? <span key={i} className="quiz-prize" style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, fontSize: b.size + 10 }}>{b.emoji}</span>
        : <span key={i} className="quiz-prize" style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.color, width: b.size, height: b.size, borderRadius: 2, display: 'inline-block' }} />
      )}
    </div>
  )
}

// ---- Trophies (career badges) ----------------------------------------------
function TrophiesScreen({ profile, onBack, onLeaders }: { profile: QuizProfile; onBack: () => void; onLeaders: () => void }) {
  const { t } = useLanguage()
  const lvl = levelProgress(profile.points)
  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="text-center my-4">
        <div className="text-4xl mb-1">🏆</div>
        <h1 className="text-2xl font-extrabold text-white">{t('quiz.trophies')}</h1>
        <p className="text-on-bg text-sm mt-1">
          {profile.badges.length} {t('quiz.badgesOf')} {BADGE_IDS.length} · {t('quiz.level')} {lvl.level} « {t(`quiz.lvl.${lvl.level}` as any)} »
        </p>
        {(profile.weeksWon || 0) > 0 && (
          <p className="text-amber-300 font-extrabold mt-1">👑 {profile.weeksWon} {t('quiz.weeksWon')}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {BADGE_IDS.map(id => {
          const owned = profile.badges.includes(id)
          return (
            <div key={id} className={`glass rounded-2xl p-3 text-center ${owned ? '' : 'opacity-45'}`}>
              <div className="text-3xl mb-1">{owned ? BADGE_EMOJI[id] : '🔒'}</div>
              <p className="text-[11px] font-bold text-slate-700 leading-tight">{t(`quiz.badge.${id}.name` as any)}</p>
            </div>
          )
        })}
      </div>

      <button onClick={onLeaders} className="w-full rounded-2xl bg-gradient-to-r from-orange-700 to-amber-700 text-white font-bold py-3.5 flex items-center justify-center gap-2">
        <Medal size={18} /> {t('quiz.ranking')}
      </button>
    </div>
  )
}

// ---- Leaderboards -----------------------------------------------------------
type LeagueTab = 'grand' | 'kids' | QuizCategory
function LeadersScreen({ uid, onBack, onPalmares }: { uid: string; onBack: () => void; onPalmares: () => void }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<LeagueTab>('grand')
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [kids, setKids] = useState<KidRow[] | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null); setKids(null)
    if (tab === 'kids') {
      fetchKidsLeaders(30).then(k => { if (alive) setKids(k) }).catch(() => { if (alive) setKids([]) })
    } else {
      const p = tab === 'grand' ? fetchGrandLeaders(30) : fetchCategoryLeaders(tab, 30)
      p.then(r => { if (alive) setRows(r) }).catch(() => { if (alive) setRows([]) })
    }
    return () => { alive = false }
  }, [tab])

  // Two leagues only: the general (all adults combined) live weekly score, and
  // the kids score. Per-category winners still live in the Palmarès.
  const tabs: { id: LeagueTab; label: string }[] = [
    { id: 'grand', label: t('quiz.general') },
    { id: 'kids', label: t('quiz.kidsTitle') },
  ]

  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
          <ChevronLeft size={20} /> {t('quiz.back')}
        </button>
        <button onClick={onPalmares} className="p-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
          <ScrollText size={17} /> {t('quiz.palmares')}
        </button>
      </div>
      <div className="text-center mb-3 mt-1">
        <div className="text-4xl mb-1">🏅</div>
        <h1 className="text-2xl font-extrabold text-white">{t('quiz.ranking')}</h1>
        <p className="text-on-bg text-xs mt-1">{tab === 'kids' ? t('quiz.kidsWeekNote') : t('quiz.weekNote')}</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`shrink-0 px-3.5 py-2 rounded-full text-sm font-bold transition ${tab === tb.id ? (tb.id === 'kids' ? 'bg-fuchsia-600 text-white' : 'bg-white text-orange-700') : 'bg-white/15 text-white border border-white/30'}`}>
            {tb.id === 'kids' ? '🎈 ' : ''}{tb.label}
          </button>
        ))}
      </div>

      <div className="glass rounded-3xl p-3">
        {tab === 'kids' ? (
          kids === null ? <Spinner /> : kids.length === 0 ? <Empty text={t('quiz.noLeaders')} /> : (
            <div className="divide-y divide-slate-100">
              {kids.map((k, i) => (
                <div key={k.id} className="flex items-center gap-3 py-2.5 px-1">
                  <span className="w-7 text-center font-bold text-slate-500">{i === 0 ? '👑' : i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{k.childName}</p>
                    {k.parentName && <p className="text-[11px] text-slate-400 truncate">{k.parentName}</p>}
                  </div>
                  <span className="font-extrabold text-fuchsia-600">{k.points.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          rows === null ? <Spinner /> : rows.length === 0 ? <Empty text={t('quiz.noLeaders')} /> : (
            <div className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <div key={r.uid} className={`flex items-center gap-3 py-2.5 px-1 ${r.uid === uid ? 'bg-amber-50 rounded-xl' : ''}`}>
                  <span className="w-7 text-center font-bold text-slate-500">{i === 0 ? '👑' : i + 1}</span>
                  <span className="flex-1 font-bold text-slate-800 truncate">{r.uid === uid ? `${t('quiz.you')} (${r.name})` : r.name}</span>
                  <span className="font-extrabold text-affirm-600">{r.points.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function Spinner() { return <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div> }
function Empty({ text }: { text: string }) { return <p className="text-sm text-slate-500 py-4 text-center">{text}</p> }

// ---- Palmarès (Hall of Fame) ------------------------------------------------
function PalmaresScreen({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage()
  const [champs, setChamps] = useState<ChampionDoc[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchChampions(16).then(c => { if (alive) setChamps(c) }).catch(() => { if (alive) setChamps([]) })
    return () => { alive = false }
  }, [])
  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="text-center my-4">
        <div className="text-4xl mb-1">📜</div>
        <h1 className="text-2xl font-extrabold text-white">{t('quiz.palmares')}</h1>
        <p className="text-on-bg text-sm mt-1">{t('quiz.palmaresSub')}</p>
      </div>
      {champs === null ? <Spinner /> : champs.length === 0 ? (
        <div className="glass rounded-3xl p-6"><Empty text={t('quiz.palmaresEmpty')} /></div>
      ) : (
        <div className="space-y-3">
          {champs.map(c => (
            <div key={c.id} className="glass rounded-2xl p-4">
              <p className="text-xs font-bold text-slate-400 mb-2">{c.weekLabel || c.id}</p>
              {c.kind === 'kids' && c.winner ? (
                <div className="flex items-center gap-3">
                  <Crown size={22} className="text-fuchsia-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-slate-800 truncate">🎈 {c.winner.childName}</p>
                    {c.winner.parentName && <p className="text-[11px] text-slate-400 truncate">{c.winner.parentName}</p>}
                  </div>
                  <span className="font-extrabold text-fuchsia-600">{c.winner.points.toLocaleString()}</span>
                </div>
              ) : (
                <>
                  {c.grand && (
                    <div className="flex items-center gap-2 mb-2">
                      <Crown size={20} className="text-amber-500 shrink-0" />
                      <span className="flex-1 font-extrabold text-slate-800 truncate">{c.grand.name}</span>
                      <span className="text-xs font-bold text-slate-400">{t('quiz.grand')}</span>
                    </div>
                  )}
                  {c.categories && (
                    <div className="grid grid-cols-1 gap-1">
                      {Object.entries(c.categories).map(([cat, w]) => (
                        <div key={cat} className="flex items-center gap-2 text-sm">
                          <span className="shrink-0">{CATEGORY_META[cat as QuizCategory]?.emoji || '•'}</span>
                          <span className="text-slate-500 shrink-0 w-28 truncate">{t(`quiz.cat.${cat}` as any)}</span>
                          <span className="flex-1 font-bold text-slate-800 truncate">{w.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
