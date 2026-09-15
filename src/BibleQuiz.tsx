import { useEffect, useMemo, useState } from 'react'
import {
  Trophy, Medal, ArrowRight, X, RotateCcw, Share2,
  ChevronLeft, Check, Loader2, BookOpen,
} from 'lucide-react'
import { Share } from '@capacitor/share'
import { useLanguage } from './i18n'
import { Portal } from './Portal'
import { useBackHandler } from './backButton'
import type { AppUser } from './types'
import {
  QUIZ_CATEGORIES, QUIZ_DIFFICULTIES, CATEGORY_META, BADGE_IDS, BADGE_EMOJI,
  QUESTIONS_PER_GAME, DAILY_BONUS,
  bankAvailable, buildGame, buildDaily, pointsFor, starsFor, levelProgress,
  applyResult, emptyProfile, todayKey,
  type QuizCategory, type QuizDifficulty, type QuizLang, type PlayQuestion,
  type QuizProfile, type GameResult, type BadgeId,
} from './quiz/engine'
import { subscribeProfile, saveProfile, fetchWeeklyLeaders, fetchTopScorer, type LeaderRow, type TopScorer } from './quiz/store'

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app'

type Screen = 'home' | 'difficulty' | 'playing' | 'results' | 'trophies'

// The game plays in French or English; every other app language uses English.
function playLang(language: string): QuizLang {
  return language === 'fr' ? 'fr' : 'en'
}

export default function BibleQuiz({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { t, language } = useLanguage()
  const lang = playLang(language)

  const [profile, setProfile] = useState<QuizProfile>(() => emptyProfile(user.uid, user.displayName, user.avatar))
  const [screen, setScreen] = useState<Screen>('home')
  const [pickedCat, setPickedCat] = useState<QuizCategory | null>(null)
  const [game, setGame] = useState<{ questions: PlayQuestion[]; category: QuizCategory | 'daily'; difficulty: QuizDifficulty } | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{ result: GameResult; unlocked: BadgeId[] } | null>(null)

  // Back button / Android hardware back closes the current screen sensibly.
  useBackHandler(true, () => {
    if (screen === 'playing') { if (confirm(t('quiz.quitConfirm'))) backToHome() }
    else if (screen === 'home') onClose()
    else backToHome()
  })

  // Live profile from Firestore (offline-friendly via the persistent cache).
  useEffect(() => {
    const unsub = subscribeProfile(user.uid, user.displayName, user.avatar, setProfile)
    return unsub
  }, [user.uid, user.displayName, user.avatar])

  const dailyDone = profile.lastDailyDate === todayKey()

  function backToHome() {
    setScreen('home'); setGame(null); setPickedCat(null); setLastResult(null)
  }

  async function startGame(cat: QuizCategory, diff: QuizDifficulty) {
    setLoading(true)
    const questions = await buildGame(cat, diff, lang)
    setLoading(false)
    if (!questions.length) return
    setGame({ questions, category: cat, difficulty: diff })
    setScreen('playing')
  }

  async function startDaily() {
    setLoading(true)
    const questions = await buildDaily(lang)
    setLoading(false)
    if (!questions.length) return
    setGame({ questions, category: 'daily', difficulty: 'medium' })
    setScreen('playing')
  }

  async function finishGame(correct: number, points: number) {
    if (!game) return
    const result: GameResult = {
      category: game.category, difficulty: game.difficulty,
      total: game.questions.length, correct, points,
    }
    const { profile: next, unlocked } = applyResult(profile, result)
    setProfile(next)
    setLastResult({ result, unlocked })
    setScreen('results')
    // Bonus for a completed daily challenge.
    if (game.category === 'daily') next.points += DAILY_BONUS
    try { await saveProfile(next) } catch { /* offline: the cache retries on reconnect */ }
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
              onTrophies={() => setScreen('trophies')} />
          )}
          {screen === 'difficulty' && pickedCat && (
            <DifficultyScreen
              category={pickedCat} profile={profile} loading={loading}
              onBack={backToHome}
              onStart={diff => startGame(pickedCat, diff)} />
          )}
          {screen === 'playing' && game && (
            <PlayScreen
              questions={game.questions} difficulty={game.difficulty}
              onQuit={() => { if (confirm(t('quiz.quitConfirm'))) backToHome() }}
              onFinish={finishGame} />
          )}
          {screen === 'results' && lastResult && game && (
            <ResultsScreen
              result={lastResult.result} unlocked={lastResult.unlocked} profile={profile}
              onReplay={() => { if (game.category === 'daily') startDaily(); else startGame(game.category, game.difficulty) }}
              onHome={backToHome}
              onTrophies={() => setScreen('trophies')} />
          )}
          {screen === 'trophies' && (
            <TrophiesScreen profile={profile} onBack={backToHome} uid={user.uid} />
          )}
        </div>
      </div>
    </Portal>
  )
}

// ---- Home -------------------------------------------------------------------
function HomeScreen({ profile, dailyDone, loading, onClose, onPickCategory, onDaily, onTrophies }: {
  profile: QuizProfile; dailyDone: boolean; loading: boolean
  onClose: () => void; onPickCategory: (c: QuizCategory) => void; onDaily: () => void; onTrophies: () => void
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
        <button onClick={champion ? onTrophies : undefined}
          className="flex-1 min-w-0 flex justify-center" aria-label={t('quiz.champion')}>
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
        <p className="text-center text-on-bg text-[11px] font-semibold -mt-1 mb-3">
          {champion.scope === 'day' ? t('quiz.championToday') : t('quiz.championWeek')}
        </p>
      )}

      <div className="text-center mb-4">
        <div className="text-5xl mb-1 quiz-anim-bounce inline-block">🏆</div>
        <h1 className="text-3xl font-extrabold text-white" translate="no">{t('quiz.title')}</h1>
        <p className="text-on-bg text-sm mt-1">{t('quiz.subtitle')}</p>
      </div>

      {/* Open-book banner: study-friendly, no timer */}
      <div className="flex items-center justify-center gap-2 mb-5 text-white/95 text-sm font-semibold">
        <BookOpen size={16} /> {t('quiz.openBookHint')}
      </div>

      {/* Player card */}
      <div className="glass rounded-3xl p-4 mb-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
          {profile.displayName?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-bold text-slate-800 truncate">{t('quiz.level')} {lvl.level}</p>
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
        className="w-full text-left rounded-3xl p-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-orange-700 to-amber-700 shadow-lg disabled:opacity-70">
        <div className="text-3xl shrink-0 quiz-anim-wiggle">⭐</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white">{t('quiz.daily')}</p>
          <p className="text-xs text-white/80">{dailyDone ? `${t('quiz.dailyDone')} ✓` : t('quiz.dailyDesc')}</p>
        </div>
        <span className="shrink-0 bg-white text-orange-700 font-bold text-sm rounded-full px-4 py-2">{t('quiz.play')}</span>
      </button>

      <h2 className="font-extrabold text-white mb-3 px-1">{t('quiz.chooseCategory')}</h2>
      <div className="grid grid-cols-2 gap-3">
        {QUIZ_CATEGORIES.map(cat => {
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

// ---- Playing ----------------------------------------------------------------
// Open-book: no timer. Each correct answer is worth its difficulty's base
// points; the player answers at their own pace, Bible in hand.
function PlayScreen({ questions, difficulty, onQuit, onFinish }: {
  questions: PlayQuestion[]; difficulty: QuizDifficulty
  onQuit: () => void; onFinish: (correct: number, points: number) => void
}) {
  const { t } = useLanguage()
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [tally, setTally] = useState({ correct: 0, points: 0 })
  const [gained, setGained] = useState(0)

  const q = questions[idx]
  const answered = picked !== null

  function lockAnswer(choice: number) {
    if (picked !== null) return
    const correct = choice === q.correct
    const pts = correct ? pointsFor(difficulty) : 0
    if (correct) setTally(prev => ({ correct: prev.correct + 1, points: prev.points + pts }))
    setGained(pts)
    setPicked(choice)
  }

  function next() {
    const totals = {
      correct: tally.correct,
      points: tally.points,
    }
    if (idx + 1 >= questions.length) {
      onFinish(totals.correct, totals.points)
      return
    }
    setIdx(i => i + 1); setPicked(null); setGained(0)
  }

  return (
    <div className="px-4 pt-4 pb-6 safe-top flex flex-col min-h-full">
      {/* Top bar: category chip + open-book chip + quit */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/30 rounded-full px-3 py-1.5 text-white text-sm font-semibold min-w-0 truncate">
          {CATEGORY_META[q.category].emoji} <span className="truncate">{t(`quiz.cat.${q.category}` as any)}</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/30 text-white rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap">
            <BookOpen size={14} /> {t('quiz.openBook')}
          </span>
          <button onClick={onQuit} className="p-2 rounded-full text-white/80 hover:bg-white/10" aria-label={t('quiz.quit')}><X size={20} /></button>
        </div>
      </div>

      {/* Progress + running score */}
      <div className="h-1.5 rounded-full bg-white/25 mb-2 overflow-hidden">
        <div className="h-full bg-white rounded-full transition-all" style={{ width: `${((idx + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-between text-white/90 text-sm font-semibold mb-3">
        <span>{t('quiz.question')} {idx + 1} / {questions.length}</span>
        <span className="relative">
          <span key={tally.points} className="quiz-anim-bump inline-block">{tally.points} {t('quiz.pts')}</span>
          {answered && gained > 0 && (
            <span key={`g${idx}`} className="quiz-anim-floatup absolute -top-4 right-0 text-emerald-200 font-extrabold whitespace-nowrap">+{gained}</span>
          )}
        </span>
      </div>

      {/* Question card */}
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
            const anim = !answered
              ? 'quiz-anim-in'
              : isCorrect ? 'quiz-anim-correct'
              : (isPicked ? 'quiz-anim-shake' : '')
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
            {gained > 0 && (
              <p className="mt-1 text-emerald-600 font-bold">+{gained} {t('quiz.pts')}</p>
            )}
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

// Smoothly counts a number up from 0 for the results score reveal.
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

// ---- Results ----------------------------------------------------------------
function ResultsScreen({ result, unlocked, profile, onReplay, onHome, onTrophies }: {
  result: GameResult; unlocked: BadgeId[]; profile: QuizProfile
  onReplay: () => void; onHome: () => void; onTrophies: () => void
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
      <button onClick={onTrophies} className="quiz-shine w-full rounded-2xl bg-gradient-to-r from-orange-700 to-amber-700 text-white font-bold py-3.5 mb-2 flex items-center justify-center gap-2"><Trophy size={17} /> {t('quiz.trophies')}</button>
      <button onClick={onHome} className="w-full py-2 text-white/80 font-semibold text-sm">{t('quiz.back')}</button>
    </div>
  )
}

// Falling ribbons plus prize emoji. `strong` (a good score) makes it rain more
// and adds trophies/medals; a weaker score still gets a gentle sprinkle.
function PrizeBurst({ strong }: { strong: boolean }) {
  const bits = useMemo(() => {
    const emojis = strong ? ['🎉', '🏆', '⭐', '✨', '🎊', '💫', '🥇'] : ['✨', '⭐']
    const colors = ['#fbbf24', '#f97316', '#34d399', '#60a5fa', '#f472b6', '#a78bfa']
    const count = strong ? 40 : 16
    return Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      dur: 1.8 + Math.random() * 1.9,
      emoji: i % 3 === 0 ? emojis[i % emojis.length] : null,
      color: colors[i % colors.length],
      size: 7 + Math.random() * 7,
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

// ---- Trophies + leaderboard -------------------------------------------------
function TrophiesScreen({ profile, onBack, uid }: { profile: QuizProfile; onBack: () => void; uid: string }) {
  const { t } = useLanguage()
  const lvl = levelProgress(profile.points)
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null)

  useEffect(() => {
    let alive = true
    fetchWeeklyLeaders(10).then(rows => { if (alive) setLeaders(rows) }).catch(() => { if (alive) setLeaders([]) })
    return () => { alive = false }
  }, [])

  const meRank = leaders?.findIndex(r => r.uid === uid) ?? -1
  const inTop = meRank >= 0

  return (
    <div className="px-4 pt-4 pb-10 safe-top">
      <button onClick={onBack} className="p-2 -ml-2 rounded-full text-white/90 hover:bg-white/10 flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft size={20} /> {t('quiz.back')}
      </button>
      <div className="text-center my-4">
        <div className="text-4xl mb-1">🏆</div>
        <h1 className="text-2xl font-extrabold text-white">{t('quiz.trophies')}</h1>
        <p className="text-on-bg text-sm mt-1">{profile.badges.length} {t('quiz.badgesOf')} {BADGE_IDS.length} · {t('quiz.level')} {lvl.level} « {t(`quiz.lvl.${lvl.level}` as any)} »</p>
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

      <div className="glass rounded-3xl p-4">
        <h2 className="font-extrabold text-slate-800 mb-3 flex items-center gap-2"><Medal size={18} className="text-amber-500" /> {t('quiz.leaderboard')}</h2>
        {leaders === null ? (
          <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : leaders.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">{t('quiz.noLeaders')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {leaders.map((r, i) => (
              <Row key={r.uid} rank={i + 1} name={r.uid === uid ? `${t('quiz.you')} (${r.displayName})` : r.displayName} pts={r.weekPoints} me={r.uid === uid} />
            ))}
            {!inTop && profile.weekPoints > 0 && (
              <Row rank={'—'} name={`${t('quiz.you')} (${profile.displayName})`} pts={profile.weekPoints} me />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ rank, name, pts, me }: { rank: number | string; name: string; pts: number; me: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2.5 px-1 ${me ? 'bg-amber-50 rounded-xl' : ''}`}>
      <span className="w-7 text-center font-bold text-slate-500">{rank === 1 ? '👑' : rank}</span>
      <span className="flex-1 font-bold text-slate-800 truncate">{name}</span>
      <span className="font-extrabold text-affirm-600">{pts.toLocaleString()}</span>
    </div>
  )
}
