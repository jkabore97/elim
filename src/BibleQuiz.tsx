import { useEffect, useMemo, useState } from 'react'
import {
  Trophy, Medal, ArrowRight, X, RotateCcw, Share2,
  ChevronLeft, Check, Loader2, BookOpen, Crown, ScrollText,
} from 'lucide-react'
import { Share } from '@capacitor/share'
import { useLanguage } from './i18n'
import { Portal } from './Portal'
import { useBackHandler } from './backButton'
import { storageGet, storageSet } from './safeStorage'
import type { AppUser } from './types'
import {
  QUIZ_DIFFICULTIES, ADULT_CATEGORIES, CATEGORY_META, BADGE_IDS, BADGE_EMOJI,
  QUESTIONS_PER_GAME, DAILY_BONUS,
  bankAvailable, buildGame, buildDaily, pointsFor, starsFor, levelProgress,
  applyResult, emptyProfile, todayKey,
  type QuizCategory, type QuizDifficulty, type QuizLang, type PlayQuestion,
  type QuizProfile, type GameResult, type BadgeId,
} from './quiz/engine'
import {
  subscribeProfile, commitAdultGame, commitKidsGame, fetchTopScorer,
  fetchGrandLeaders, fetchCategoryLeaders, fetchKidsLeaders, fetchChampions,
  type LeaderRow, type KidRow, type ChampionDoc, type TopScorer,
} from './quiz/store'

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app'
const KID_NAME_KEY = 'elim-quiz-kidname'

type Screen = 'home' | 'difficulty' | 'kidname' | 'playing' | 'results' | 'trophies' | 'leaders' | 'palmares'

function playLang(language: string): QuizLang {
  return language === 'fr' ? 'fr' : 'en'
}

interface Game {
  questions: PlayQuestion[]
  category: QuizCategory | 'daily'
  difficulty: QuizDifficulty
  mode: 'adult' | 'kids'
  childName?: string
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

  useEffect(() => {
    const unsub = subscribeProfile(user.uid, user.displayName, user.avatar, setProfile)
    return unsub
  }, [user.uid, user.displayName, user.avatar])

  const dailyDone = profile.lastDailyDate === todayKey()

  function backToHome() {
    setScreen('home'); setGame(null); setPickedCat(null); setLastResult(null); setKidResult(null)
  }

  async function startGame(cat: QuizCategory, diff: QuizDifficulty) {
    setLoading(true)
    const questions = await buildGame(cat, diff, lang)
    setLoading(false)
    if (!questions.length) return
    setGame({ questions, category: cat, difficulty: diff, mode: 'adult' })
    setScreen('playing')
  }

  async function startDaily() {
    setLoading(true)
    const questions = await buildDaily(lang)
    setLoading(false)
    if (!questions.length) return
    setGame({ questions, category: 'daily', difficulty: 'medium', mode: 'adult' })
    setScreen('playing')
  }

  async function startKids(childName: string) {
    storageSet(KID_NAME_KEY, childName)
    setLoading(true)
    const diff: QuizDifficulty = bankAvailable('kids', 'easy') ? 'easy' : bankAvailable('kids', 'medium') ? 'medium' : 'hard'
    const questions = await buildGame('kids', diff, lang)
    setLoading(false)
    if (!questions.length) return
    setGame({ questions, category: 'kids', difficulty: diff, mode: 'kids', childName })
    setScreen('playing')
  }

  async function finishGame(correctQuestions: PlayQuestion[]) {
    if (!game) return
    const total = game.questions.length
    const correct = correctQuestions.length

    if (game.mode === 'kids') {
      const childName = game.childName || t('quiz.kidFriend')
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
    const { profile: next, unlocked } = applyResult(profile, result)
    if (game.category === 'daily') next.points += DAILY_BONUS
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
              profile={profile} dailyDone={dailyDone} loading={loading}
              onClose={onClose}
              onPickCategory={c => { setPickedCat(c); setScreen('difficulty') }}
              onDaily={startDaily}
              onKids={() => setScreen('kidname')}
              onLeaders={() => setScreen('leaders')}
              onPalmares={() => setScreen('palmares')}
              onTrophies={() => setScreen('trophies')} />
          )}
          {screen === 'difficulty' && pickedCat && (
            <DifficultyScreen category={pickedCat} profile={profile} loading={loading}
              onBack={backToHome} onStart={diff => startGame(pickedCat, diff)} />
          )}
          {screen === 'kidname' && (
            <KidNameScreen loading={loading} onBack={backToHome} onStart={startKids} />
          )}
          {screen === 'playing' && game && (
            <PlayScreen questions={game.questions} difficulty={game.difficulty}
              kid={game.mode === 'kids'} kidName={game.childName}
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
              onReplay={() => { if (game.category === 'daily') startDaily(); else startGame(game.category as QuizCategory, game.difficulty) }}
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
function HomeScreen({ profile, dailyDone, loading, onClose, onPickCategory, onDaily, onKids, onLeaders, onPalmares, onTrophies }: {
  profile: QuizProfile; dailyDone: boolean; loading: boolean
  onClose: () => void; onPickCategory: (c: QuizCategory) => void; onDaily: () => void
  onKids: () => void; onLeaders: () => void; onPalmares: () => void; onTrophies: () => void
}) {
  const { t } = useLanguage()
  const lvl = levelProgress(profile.points)
  const acc = profile.answered ? Math.round((profile.correct / profile.answered) * 100) : 0
  const [champion, setChampion] = useState<TopScorer | null>(null)
  useEffect(() => {
    let alive = true
    fetchTopScorer().then(c => { if (alive) setChampion(c) }).catch(() => {})
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
        <div className="text-5xl shrink-0 quiz-anim-bounce">🧒</div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-white text-xl leading-tight">{t('quiz.kidsTitle')}</p>
          <p className="text-sm text-white/90">{t('quiz.kidsSubtitle')}</p>
        </div>
        <span className="shrink-0 bg-white text-fuchsia-700 font-extrabold rounded-full px-5 py-2.5">{t('quiz.play')}</span>
      </button>

      {/* Player card */}
      <div className="glass rounded-3xl p-4 mb-4 flex items-center gap-4">
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
        </div>
      </div>

      {/* Daily challenge */}
      <button onClick={onDaily} disabled={loading}
        className="w-full text-left rounded-3xl p-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-orange-700 to-amber-700 shadow-lg disabled:opacity-70">
        <div className="text-3xl shrink-0 quiz-anim-wiggle">⭐</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white">{t('quiz.daily')}</p>
          <p className="text-xs text-white/80">{dailyDone ? `${t('quiz.dailyDone')} ✓` : t('quiz.dailyDesc')}</p>
        </div>
        <span className="shrink-0 bg-white text-orange-700 font-bold text-sm rounded-full px-4 py-2">{t('quiz.play')}</span>
      </button>

      {/* Classement + Palmarès */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button onClick={onLeaders} className="glass glass-hover rounded-2xl py-3 flex items-center justify-center gap-2 font-bold text-affirm-700">
          <Medal size={17} /> {t('quiz.ranking')}
        </button>
        <button onClick={onPalmares} className="glass glass-hover rounded-2xl py-3 flex items-center justify-center gap-2 font-bold text-affirm-700">
          <ScrollText size={17} /> {t('quiz.palmares')}
        </button>
      </div>

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
function DifficultyScreen({ category, profile, loading, onBack, onStart }: {
  category: QuizCategory; profile: QuizProfile; loading: boolean
  onBack: () => void; onStart: (d: QuizDifficulty) => void
}) {
  const { t } = useLanguage()
  const meta = CATEGORY_META[category]
  const dots: Record<QuizDifficulty, string> = { easy: '●○○', medium: '●●○', hard: '●●●' }
  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="text-center my-6">
        <div className={`w-20 h-20 mx-auto rounded-3xl ${meta.tint} flex items-center justify-center text-4xl mb-3`}>{meta.emoji}</div>
        <h1 className="text-2xl font-extrabold text-white">{t(`quiz.cat.${category}` as any)}</h1>
        <p className="text-on-bg text-sm mt-1 flex items-center justify-center gap-1.5"><BookOpen size={14} /> {t('quiz.openBookHint')}</p>
      </div>
      <div className="space-y-3">
        {QUIZ_DIFFICULTIES.map(diff => {
          const ready = bankAvailable(category, diff)
          const best = profile.best[`${category}-${diff}`]
          return (
            <button key={diff} onClick={() => ready && !loading && onStart(diff)} disabled={!ready || loading}
              className={`w-full glass rounded-2xl p-4 flex items-center gap-4 transition ${ready ? 'glass-hover' : 'opacity-60'}`}>
              <div className="text-affirm-500 tracking-widest text-lg font-bold w-14">{dots[diff]}</div>
              <div className="flex-1 text-left">
                <p className="font-bold text-slate-800">{t(`quiz.${diff}` as any)}</p>
                <p className="text-xs text-slate-500">
                  {ready ? `${QUESTIONS_PER_GAME} ${t('quiz.questionsCount')}${best != null ? ` · ${t('quiz.best')} ${best}/${QUESTIONS_PER_GAME}` : ''}` : t('quiz.comingSoon')}
                </p>
              </div>
              {ready && (loading ? <Loader2 size={18} className="animate-spin text-slate-400" /> : <ArrowRight size={18} className="text-affirm-500" />)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Kids name entry --------------------------------------------------------
function KidNameScreen({ loading, onBack, onStart }: {
  loading: boolean; onBack: () => void; onStart: (name: string) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(() => storageGet(KID_NAME_KEY) || '')
  const ok = name.trim().length >= 2
  return (
    <div className="px-4 pt-4 pb-10 safe-top flex flex-col min-h-full">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="text-7xl mb-3 quiz-anim-bounce">🧒</div>
        <h1 className="text-2xl font-extrabold text-white mb-1">{t('quiz.kidsTitle')}</h1>
        <p className="text-on-bg mb-6">{t('quiz.kidNamePrompt')} 😊</p>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder={t('quiz.kidNamePlaceholder')} autoFocus maxLength={40}
          className="w-full max-w-xs text-center text-lg font-bold rounded-2xl bg-white text-slate-800 px-4 py-4 shadow-lg focus:outline-none focus:ring-4 focus:ring-white/50 mb-2" />
        <p className="text-on-bg text-xs mb-6">{t('quiz.kidNameHint')}</p>
        <button onClick={() => ok && onStart(name.trim())} disabled={!ok || loading}
          className="quiz-shine w-full max-w-xs rounded-2xl bg-gradient-to-r from-pink-500 to-violet-500 text-white font-extrabold text-lg py-4 shadow-xl disabled:opacity-60 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="animate-spin" size={20} /> : <>{t('quiz.kidStart')} 🎉</>}
        </button>
      </div>
    </div>
  )
}

// ---- Playing ----------------------------------------------------------------
function PlayScreen({ questions, difficulty, kid, kidName, onQuit, onFinish }: {
  questions: PlayQuestion[]; difficulty: QuizDifficulty; kid?: boolean; kidName?: string
  onQuit: () => void; onFinish: (correct: PlayQuestion[]) => void
}) {
  const { t } = useLanguage()
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correctList, setCorrectList] = useState<PlayQuestion[]>([])
  const [points, setPoints] = useState(0)
  const [gained, setGained] = useState(0)

  const q = questions[idx]
  const answered = picked !== null

  function lockAnswer(choice: number) {
    if (picked !== null) return
    const correct = choice === q.correct
    const pts = correct ? pointsFor(difficulty) : 0
    if (correct) { setCorrectList(prev => [...prev, q]); setPoints(p => p + pts) }
    setGained(pts)
    setPicked(choice)
  }

  function next() {
    if (idx + 1 >= questions.length) { onFinish(correctList); return }
    setIdx(i => i + 1); setPicked(null); setGained(0)
  }

  return (
    <div className="px-4 pt-4 pb-6 safe-top flex flex-col min-h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/30 rounded-full px-3 py-1.5 text-white text-sm font-semibold min-w-0 truncate">
          {kid ? '🧒' : CATEGORY_META[q.category].emoji} <span className="truncate">{kid ? (kidName || t('quiz.kidsTitle')) : t(`quiz.cat.${q.category}` as any)}</span>
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
            let cls = 'border-slate-200 bg-white'
            let badge = 'bg-slate-100 text-slate-500'
            if (answered && isCorrect) { cls = 'border-emerald-400 bg-emerald-50'; badge = 'bg-emerald-500 text-white' }
            else if (answered && isPicked && !isCorrect) { cls = 'border-red-400 bg-red-50'; badge = 'bg-red-500 text-white' }
            else if (answered) { cls = 'border-slate-200 bg-white opacity-60' }
            const anim = !answered ? 'quiz-anim-in' : isCorrect ? 'quiz-anim-correct' : (isPicked ? 'quiz-anim-shake' : '')
            return (
              <button key={i} onClick={() => lockAnswer(i)} disabled={answered}
                style={!answered ? { animationDelay: `${i * 70}ms` } : undefined}
                className={`w-full flex items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition ${cls} ${anim}`}>
                <span className={`w-8 h-8 rounded-full grid place-items-center font-bold text-sm shrink-0 ${badge}`}>
                  {answered && isCorrect ? <Check size={16} /> : answered && isPicked && !isCorrect ? <X size={16} /> : String.fromCharCode(65 + i)}
                </span>
                <span className="font-semibold text-slate-800 text-[15px]">{opt}</span>
              </button>
            )
          })}
        </div>

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
      <p className="text-on-bg">{result.category === 'daily' ? t('quiz.daily') : t(`quiz.cat.${result.category}` as any)} · <b className="text-white">{result.correct} / {result.total}</b> {t('quiz.rightAnswers')}</p>
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
        <div className="relative text-8xl quiz-anim-medal">🧒</div>
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

  const tabs: { id: LeagueTab; label: string }[] = [
    { id: 'grand', label: t('quiz.grand') },
    ...ADULT_CATEGORIES.map(c => ({ id: c as LeagueTab, label: t(`quiz.cat.${c}` as any) })),
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
            {tb.id === 'kids' ? '🧒 ' : ''}{tb.label}
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
                    <p className="font-extrabold text-slate-800 truncate">🧒 {c.winner.childName}</p>
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
