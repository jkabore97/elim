import { useState, useEffect, useMemo } from 'react'
import {
  Home, Church, PlusCircle, User, MessageCircle, Heart, Share2,
  Image as ImageIcon, Video, Mic, X, Send, LogOut,
  Youtube, Facebook, CheckCircle2, Clock, ArrowRight, ShieldCheck, UserX, Sparkles,
  Trash2, Camera, FileText, Upload, Pencil, Globe, Eye, EyeOff, Search, Bell, ScrollText
} from 'lucide-react'
import {
  collection, addDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, doc, updateDoc, deleteDoc, increment, setDoc, getDoc, getDocs, limit
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  sendEmailVerification, sendPasswordResetEmail
} from 'firebase/auth'
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { auth, db, storage } from './firebase'
import { enableNotifications, disableNotifications, listenForForegroundMessages, checkNotificationPermission, reconcileNotificationState } from './notifications'
import { logActivity } from './activityLog'
import { AnimatedSplash } from './AnimatedSplash'
import { attachMediaSession, updateMediaSessionState } from './mediaSession'
import type { Post, Comment, AppUser, ActivityLog } from './types'
import { LanguageProvider, useLanguage, type Language } from './i18n'

function timeAgo(date: any) {
  if (!date) return ''
  const d = date?.toDate ? date.toDate() : new Date(date)
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function getYoutubeId(url: string) {
  const reg = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  const match = url.match(reg)
  return match ? match[1] : null
}

function isFacebookVideo(url: string) {
  return url.includes('facebook.com') || url.includes('fb.watch')
}

// Members authenticate with phone number + a 6-digit PIN, not email/password.
// Firebase Auth still needs *an* email string under the hood, so this builds
// a synthetic, never-emailed-to one from their (country code + number) —
// entirely invisible to the person, who only ever sees "phone number".
function sanitizeDigits(str: string) {
  return str.replace(/\D/g, '')
}
function memberAuthEmail(countryCode: string, phone: string) {
  return `${sanitizeDigits(countryCode)}${sanitizeDigits(phone)}@elim-member.app`
}

function Logo({ size = 36, variant = 'mark' }: { size?: number; variant?: 'mark' | 'full' }) {
  return (
    <img
      src={variant === 'full' ? '/elim-logo-full.png' : '/elim-logo-mark.png'}
      alt="ELIM"
      style={{ height: size }}
      className="object-contain"
    />
  )
}

// Small EN/FR toggle. `dark` picks the variant meant to sit on dark
// surfaces (auth screens, sidebar) vs. light ones (landing page nav).
function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { language, setLanguage } = useLanguage()
  const base = dark
    ? 'bg-white/5 border-white/10'
    : 'bg-slate-100 border-transparent'
  const inactive = dark ? 'text-slate-400' : 'text-slate-500'
  const active = dark ? 'bg-white/10 text-white' : 'bg-white text-slate-900 shadow-sm'

  return (
    <div className={`inline-flex items-center gap-0.5 p-1 rounded-full border ${base}`}>
      <Globe size={13} className={`ml-1.5 mr-0.5 ${inactive}`} />
      {(['fr', 'en'] as Language[]).map(lang => (
        <button key={lang} onClick={() => setLanguage(lang)}
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide transition ${
            language === lang ? active : `${inactive} hover:text-slate-300`}`}>
          {lang}
        </button>
      ))}
    </div>
  )
}

// ==================== SHARED AUTH FORM ====================
// Used inside both the mobile/tablet full-screen AuthScreen and the
// desktop AuthModal, so the login/register logic lives in one place.
function AuthForm({ onSuccess, initialMode = 'login' }: {
  onSuccess: (user: AppUser) => void
  initialMode?: 'login' | 'register'
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [accountType, setAccountType] = useState<'member' | 'church'>('member')

  // Shared name fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // Phone — used by: member signup, member login, church signup
  const [countryCode, setCountryCode] = useState('+226')
  const [phone, setPhone] = useState('')

  // Member-only
  const [selectedChurchId, setSelectedChurchId] = useState('other')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [churches, setChurches] = useState<{ id: string; name: string }[]>([])

  // Church-only
  const [churchName, setChurchName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)

  const inputClass = "w-full px-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/60 text-[15px]"
  const selectClass = inputClass + " appearance-none"

  // The church picker needs to be readable before anyone is signed in —
  // fetched once when member+register is selected (churchDirectory is a
  // public-read collection specifically for this).
  useEffect(() => {
    if (mode === 'register' && accountType === 'member' && churches.length === 0) {
      getDocs(collection(db, 'churchDirectory')).then(snap => {
        setChurches(snap.docs.map(d => ({ id: d.id, name: (d.data() as any).name })))
      }).catch(() => {})
    }
  }, [mode, accountType])

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    setError('')
    setResetSent(false)
    setRegisterSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setRegisterSuccess(false)

    if (accountType === 'member') {
      if (!sanitizeDigits(phone)) { setError(t('auth.phoneInvalid')); return }
      if (!/^\d{6}$/.test(pin)) { setError(t('auth.pinMustBe6Digits')); return }
      if (mode === 'register' && pin !== confirmPin) { setError(t('auth.pinsDontMatch')); return }
    } else if (mode === 'register') {
      if (!sanitizeDigits(phone)) { setError(t('auth.phoneInvalid')); return }
      if (password.length < 8) { setError(t('auth.passwordTooShort')); return }
      if (password !== confirmPassword) { setError(t('auth.passwordsDontMatch')); return }
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        const loginEmail = accountType === 'member' ? memberAuthEmail(countryCode, phone) : email
        const loginPassword = accountType === 'member' ? pin : password
        const cred = await signInWithEmailAndPassword(auth, loginEmail, loginPassword)
        const snap = await getDoc(doc(db, 'users', cred.user.uid))
        if (snap.exists()) {
          const profile = snap.data() as AppUser
          logActivity(profile, 'signin')
          onSuccess(profile)
        }
        else throw new Error('User profile not found')
      } else {
        const fullName = `${firstName} ${lastName}`.trim()
        if (accountType === 'member') {
          const authEmail = memberAuthEmail(countryCode, phone)
          const cred = await createUserWithEmailAndPassword(auth, authEmail, pin)
          await updateProfile(cred.user, { displayName: fullName })
          const selectedChurch = churches.find(c => c.id === selectedChurchId)
          const profile: AppUser = {
            uid: cred.user.uid,
            email: authEmail,
            displayName: fullName,
            firstName, lastName,
            role: 'member',
            phone: `${countryCode} ${phone.trim()}`,
            createdAt: serverTimestamp(),
            ...(selectedChurch ? { memberChurchId: selectedChurch.id, memberChurchName: selectedChurch.name } : {})
          }
          await setDoc(doc(db, 'users', cred.user.uid), profile)
          // Must log before signOut - the rules require request.auth.uid to
          // match the entry's userId, which is only true while signed in.
          logActivity(profile, 'signup', selectedChurch ? `Member - ${selectedChurch.name}` : 'Member - no church')
          await signOut(auth)
          setMode('login')
          setPin(''); setConfirmPin('')
          setRegisterSuccess(true)
        } else {
          const cred = await createUserWithEmailAndPassword(auth, email, password)
          await updateProfile(cred.user, { displayName: fullName })
          sendEmailVerification(cred.user).catch(() => {})
          const profile: AppUser = {
            uid: cred.user.uid,
            email,
            displayName: fullName,
            firstName, lastName,
            role: 'pending_church',
            phone: `${countryCode} ${phone.trim()}`,
            churchName,
            createdAt: serverTimestamp()
          }
          await setDoc(doc(db, 'users', cred.user.uid), profile)
          logActivity(profile, 'signup', `Church - ${churchName}`)
          await signOut(auth)
          setMode('login')
          setPassword(''); setConfirmPassword('')
          setRegisterSuccess(true)
        }
      }
    } catch (err: any) {
      const code = err.code || ''
      if (code === 'auth/email-already-in-use' && accountType === 'member') {
        setError(t('auth.phoneAlreadyRegistered'))
      } else if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code) && accountType === 'member') {
        setError(t('auth.wrongPhoneOrPin'))
      } else {
        setError(err.message?.replace('Firebase: ', '') || t('auth.somethingWrong'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t('auth.enterEmailFirst'))
      return
    }
    setError('')
    setResetSent(false)
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || t('auth.somethingWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1 mb-5">
        <button onClick={() => switchMode('login')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'login' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
          {t('auth.signIn')}
        </button>
        <button onClick={() => switchMode('register')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'register' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
          {t('auth.createAccount')}
        </button>
      </div>

      <p className="text-xs font-semibold text-slate-500 mb-2 px-1">{t('auth.iAmA')}</p>
      <div className="flex gap-3 mb-6">
        <button onClick={() => { setAccountType('member'); setError('') }}
          className={`flex-1 py-3 rounded-2xl border-2 text-sm font-medium transition ${
            accountType === 'member' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-400'}`}>
          {t('auth.memberSignIn')}
        </button>
        <button onClick={() => { setAccountType('church'); setError('') }}
          className={`flex-1 py-3 rounded-2xl border-2 text-sm font-medium transition ${
            accountType === 'church' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-400'}`}>
          {t('auth.churchSignIn')}
        </button>
      </div>

      {registerSuccess && (
        <p className="mb-4 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          {t('auth.accountCreated')}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <div className="flex gap-3">
            <input required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t('auth.firstName')}
              className={inputClass} />
            <input required value={lastName} onChange={e => setLastName(e.target.value)} placeholder={t('auth.lastName')}
              className={inputClass} />
          </div>
        )}

        {mode === 'register' && accountType === 'member' && (
          <select required value={selectedChurchId} onChange={e => setSelectedChurchId(e.target.value)} className={selectClass}>
            <option value="other">{t('auth.otherNoChurch')}</option>
            {churches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {mode === 'register' && accountType === 'church' && (
          <input required value={churchName} onChange={e => setChurchName(e.target.value)} placeholder={t('auth.newChurchName')}
            className={inputClass} />
        )}

        {(accountType === 'member' || mode === 'register') && (
          <div className="flex gap-2">
            <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
              className="w-[92px] shrink-0 px-2 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/60 text-[15px] appearance-none">
              {COUNTRY_CODES.map(c => <option key={c.name} value={c.code}>{c.code}</option>)}
            </select>
            <input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('auth.phoneNumber')}
              className={inputClass} />
          </div>
        )}

        {accountType === 'member' ? (
          <>
            <div className="relative">
              <input required type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={6}
                value={pin} onChange={e => setPin(sanitizeDigits(e.target.value).slice(0, 6))} placeholder={t('auth.pin')}
                className={inputClass + " pr-12"} />
              <button type="button" onClick={() => setShowPin(s => !s)}
                aria-label={showPin ? t('auth.hidePassword') : t('auth.showPassword')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {mode === 'register' && (
              <input required type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={6}
                value={confirmPin} onChange={e => setConfirmPin(sanitizeDigits(e.target.value).slice(0, 6))} placeholder={t('auth.confirmPin')}
                className={inputClass} />
            )}
          </>
        ) : (
          <>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('auth.email')}
              className={inputClass} />
            <div className="relative">
              <input required type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={t('auth.password')} minLength={mode === 'register' ? 8 : undefined}
                className={inputClass + " pr-12"} />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {mode === 'register' && (
              <input required type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t('auth.confirmPassword')} minLength={8}
                className={inputClass} />
            )}
          </>
        )}

        {mode === 'login' && accountType === 'church' && (
          <div className="text-right -mt-2">
            <button type="button" onClick={handleForgotPassword}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">
              {t('auth.forgotPassword')}
            </button>
          </div>
        )}

        {resetSent && (
          <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
            {t('auth.resetSent')}
          </p>
        )}
        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-emerald-500/20">
          {loading ? t('auth.pleaseWait') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      {mode === 'register' && accountType === 'church' && (
        <p className="mt-5 text-xs text-center text-slate-500 leading-relaxed">
          {t('auth.churchApprovalNote')}
        </p>
      )}
    </div>
  )
}

// ==================== AUTH SCREENS ====================
// Full-screen version — shown on phone & tablet (the "app style" experience).
function AuthScreen({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  const { t } = useLanguage()
  const [showWelcome, setShowWelcome] = useState(true)

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex flex-col relative overflow-hidden">
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex justify-end px-6 pt-6">
        <LanguageSwitcher dark />
      </div>

      {showWelcome ? (
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-md text-center">
            <Logo size={110} variant="full" />
            <h1 className="mt-8 text-3xl font-bold text-white tracking-tight">{t('auth.welcomeTo')}</h1>
            <p className="mt-3 text-slate-400 leading-relaxed">{t('auth.peacefulPlace')}</p>

            <div className="mt-10 grid grid-cols-2 gap-4">
              {[
                { icon: ImageIcon, label: t('landing.valueProp.photos') },
                { icon: Mic, label: t('landing.valueProp.audio') },
                { icon: Video, label: t('landing.valueProp.video') },
                { icon: ShieldCheck, label: t('landing.valueProp.verified') },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white/[0.03] border border-white/10">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <item.icon size={18} />
                  </div>
                  <span className="text-xs font-medium text-slate-300 text-center px-1">{item.label}</span>
                </div>
              ))}
            </div>

            <button onClick={() => setShowWelcome(false)}
              className="mt-10 w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
              {t('landing.getStarted')} <ArrowRight size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <Logo size={64} />
            </div>
            <div className="bg-white/[0.03] backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-8">
              <AuthForm onSuccess={onSuccess} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Modal version — opened from the desktop landing page.
function AuthModal({ onClose, onSuccess, initialMode }: {
  onClose: () => void
  onSuccess: (user: AppUser) => void
  initialMode: 'login' | 'register'
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d1424] w-full max-w-md rounded-3xl shadow-2xl border border-white/10 p-8 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-white/5 text-slate-400">
          <X size={20} />
        </button>
        <div className="flex justify-center mb-2">
          <LanguageSwitcher dark />
        </div>
        <div className="text-center mb-6 mt-4">
          <Logo size={40} />
        </div>
        <AuthForm onSuccess={onSuccess} initialMode={initialMode} />
      </div>
    </div>
  )
}

// ==================== DESKTOP LANDING PAGE ====================
// The "big for computer browsers" experience — shown on lg+ screens only.
function LandingPage({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  const { t } = useLanguage()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center justify-between">
          <Logo size={36} />
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button onClick={() => setAuthMode('login')}
              className="px-5 py-2.5 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
              {t('auth.signIn')}
            </button>
            <button onClick={() => setAuthMode('register')}
              className="px-5 py-2.5 rounded-full text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-lg shadow-emerald-200">
              {t('landing.getStarted')}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 heavenly-bg" />
        <div className="absolute -top-20 left-1/4 w-[500px] h-[500px] bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-10 right-1/4 w-[400px] h-[400px] bg-emerald-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 left-1/3 w-[350px] h-[350px] bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-8 pt-20 pb-28 text-center">
          <Logo size={128} variant="full" />
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 border border-emerald-100 text-xs font-semibold text-emerald-700 tracking-wide mt-8 mb-8">
            <Sparkles size={14} /> {t('landing.badge')}
          </div>
          <h1 className="text-5xl lg:text-6xl xl:text-7xl font-extrabold text-slate-900 tracking-tight leading-[1.05]">
            {t('landing.heroLine1')}<br />
            <span className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-amber-500 bg-clip-text text-transparent">
              {t('landing.heroLine2')}
            </span>
          </h1>
          <p className="mt-8 text-lg xl:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            {t('landing.heroSubtitle')}
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <button onClick={() => setAuthMode('register')}
              className="px-8 py-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition shadow-xl shadow-emerald-200 flex items-center gap-2">
              {t('landing.getStarted')} <ArrowRight size={18} />
            </button>
            <button onClick={() => setAuthMode('login')}
              className="px-8 py-4 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[15px] transition">
              {t('auth.signIn')}
            </button>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-6xl mx-auto px-8 py-10 grid grid-cols-4 gap-8">
          {[
            { icon: ImageIcon, label: t('landing.valueProp.photos') },
            { icon: Mic, label: t('landing.valueProp.audio') },
            { icon: Video, label: t('landing.valueProp.video') },
            { icon: ShieldCheck, label: t('landing.valueProp.verified') },
          ].map((item, i) => (
            <div key={i} className="flex flex-col items-center text-center gap-2.5">
              <div className="w-11 h-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-emerald-600 shadow-sm">
                <item.icon size={20} />
              </div>
              <span className="text-sm font-semibold text-slate-600">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* For Churches / For Members */}
      <section className="max-w-6xl mx-auto px-8 py-24">
        <div className="text-center mb-14">
          <p className="text-xs font-bold tracking-widest text-amber-600 mb-3">{t('landing.whoItsFor')}</p>
          <h2 className="text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight">{t('landing.builtForBoth')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="rounded-3xl p-8 bg-gradient-to-br from-emerald-50 to-white border border-emerald-100">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mb-6 shadow-lg shadow-emerald-200">
              <Church size={22} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">{t('landing.forChurches')}</h3>
            <ul className="space-y-3 text-slate-500 text-[15px]">
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> {t('landing.forChurches.1')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> {t('landing.forChurches.2')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> {t('landing.forChurches.3')}</li>
            </ul>
          </div>
          <div className="rounded-3xl p-8 bg-gradient-to-br from-blue-50 to-white border border-blue-100">
            <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white flex items-center justify-center mb-6 shadow-lg shadow-blue-200">
              <User size={22} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">{t('landing.forMembers')}</h3>
            <ul className="space-y-3 text-slate-500 text-[15px]">
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> {t('landing.forMembers.1')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> {t('landing.forMembers.2')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> {t('landing.forMembers.3')}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-8 py-24">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest text-emerald-600 mb-3">{t('landing.gettingStarted')}</p>
            <h2 className="text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight">{t('landing.threeSteps')}</h2>
          </div>
          <div className="grid grid-cols-3 gap-8">
            {[
              { n: '1', title: t('landing.step1.title'), desc: t('landing.step1.desc'), color: 'border-emerald-500 text-emerald-600' },
              { n: '2', title: t('landing.step2.title'), desc: t('landing.step2.desc'), color: 'border-blue-600 text-blue-700' },
              { n: '3', title: t('landing.step3.title'), desc: t('landing.step3.desc'), color: 'border-amber-500 text-amber-600' },
            ].map(step => (
              <div key={step.n} className="text-left">
                <div className={`w-11 h-11 rounded-full bg-white border-2 font-bold flex items-center justify-center mb-5 ${step.color}`}>
                  {step.n}
                </div>
                <h3 className="font-bold text-slate-900 mb-2">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-8 py-24 text-center">
        <h2 className="text-3xl xl:text-5xl font-bold text-slate-900 tracking-tight mb-6">
          {t('landing.finalCta1')}{' '}
          <span className="bg-gradient-to-r from-emerald-600 to-amber-500 bg-clip-text text-transparent">{t('landing.finalCta2')}</span>
        </h2>
        <button onClick={() => setAuthMode('register')}
          className="mt-4 px-10 py-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base transition shadow-xl shadow-emerald-200 inline-flex items-center gap-2">
          {t('landing.getStartedFree')} <ArrowRight size={18} />
        </button>
      </section>

      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-8 py-10 flex items-center justify-between gap-4">
          <Logo size={26} />
          <p className="text-sm text-slate-400">{t('landing.footerTagline')}</p>
        </div>
      </footer>

      {authMode && (
        <AuthModal initialMode={authMode} onClose={() => setAuthMode(null)} onSuccess={onSuccess} />
      )}
    </div>
  )
}

function PendingScreen({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
          <Clock size={36} className="text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">{t('pending.title')}</h1>
        <p className="text-slate-500 mb-2">{t('pending.yourChurchAccount')} <strong>{user.churchName}</strong> {t('pending.underReview')}</p>
        <p className="text-slate-400 text-sm mb-8">{t('pending.note')}</p>
        <button onClick={onLogout} className="text-sm text-slate-500 underline">{t('pending.signOut')}</button>
      </div>
    </div>
  )
}

// ==================== MAIN APP ====================
function AppInner() {
  const { t } = useLanguage()
  const [user, setUser] = useState<AppUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('feed')
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [activeCommentsPost, setActiveCommentsPost] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingChurches, setPendingChurches] = useState<AppUser[]>([])
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const [feedFilter, setFeedFilter] = useState<'all' | 'video' | 'audio' | 'posts'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // The whole app is dark-themed on native (both the auth screens and the
  // main shell), so this is applied once, unconditionally, rather than
  // switching per-screen. Native-only: these APIs don't exist on web, where
  // the browser's own chrome is what's visible instead of a device status bar.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {})
      EdgeToEdge.setBackgroundColor({ color: '#0f172a' }).catch(() => {})
    }
    // Web only (no-ops on native) - lets an already-open browser tab show a
    // notification for a new post without needing to reload.
    listenForForegroundMessages()
  }, [])

  // Reconcile our stored notificationsEnabled flag against what the OS
  // actually reports whenever a user loads. Handles the case where someone
  // granted permission in-app but later revoked it in system settings -
  // previously the app kept showing the toggle as on while notifications
  // silently didn't arrive.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const actuallyEnabled = await reconcileNotificationState(user.uid, !!user.notificationsEnabled)
      if (cancelled) return
      if (actuallyEnabled !== !!user.notificationsEnabled) {
        setUser(prev => prev ? { ...prev, notificationsEnabled: actuallyEnabled } : prev)
      }
      // Prompt anyone who hasn't made a decision yet - but only once per
      // session, and never for someone who explicitly denied it (that would
      // be nagging, and the OS won't re-prompt after a denial anyway).
      if (!actuallyEnabled) {
        const perm = await checkNotificationPermission()
        if (!cancelled && perm === 'prompt' && !sessionStorage.getItem('elim-notif-prompted')) {
          sessionStorage.setItem('elim-notif-prompted', '1')
          setShowNotifPrompt(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [user?.uid])

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (snap.exists()) setUser(snap.data() as AppUser)
        else setUser(null)
      } else {
        setUser(null)
      }
      setAuthLoading(false)
    })
    return unsub
  }, [])

  // Posts
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)))
      setLoading(false)
    })
    return unsub
  }, [user])

  // The current user's likes — kept as its own collection (one doc per
  // postId+userId) rather than a field on the post itself, since a post
  // has no way to know "did *this* user like it" otherwise. This is what
  // was actually broken before: `liked` lived only in local state and got
  // wiped by the very next posts snapshot.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'likes'), where('userId', '==', user.uid))
    const unsub = onSnapshot(q, (snap) => {
      setLikedPostIds(new Set(snap.docs.map(d => d.data().postId as string)))
    })
    return unsub
  }, [user])

  // Comments
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'comments'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment)))
    })
    return unsub
  }, [user])

  // Pending church signups (admin only)
  useEffect(() => {
    if (!user || user.role !== 'admin') return
    const q = query(collection(db, 'users'), where('role', '==', 'pending_church'))
    const unsub = onSnapshot(q, (snap) => {
      setPendingChurches(snap.docs.map(d => ({ ...d.data() } as AppUser)))
    })
    return unsub
  }, [user])

  const canPost = user?.role === 'church' || user?.role === 'admin'

  const handleLogout = async () => {
    await signOut(auth)
    setUser(null)
  }

  const handleDeletePost = async (id: string) => {
    const post = posts.find(p => p.id === id)
    await deleteDoc(doc(db, 'posts', id))
    logActivity(user, 'post_deleted', post?.content?.slice(0, 80))
  }

  const handleEditPost = async (id: string, content: string) => {
    await updateDoc(doc(db, 'posts', id), { content })
    logActivity(user, 'post_edited', content.slice(0, 80))
  }

  const handleCreatePost = async (data: { type: Post['type']; content: string; mediaUrl?: string; coverUrl?: string; fileName?: string }) => {
    let finalType = data.type
    // Only auto-detect YouTube/Facebook links when the user didn't explicitly pick
    // a distinct media type (audio/document posts can otherwise get silently reclassified).
    if (data.mediaUrl && !['audio', 'document'].includes(data.type)) {
      if (getYoutubeId(data.mediaUrl)) finalType = 'youtube'
      else if (isFacebookVideo(data.mediaUrl)) finalType = 'facebook'
    }
    await addDoc(collection(db, 'posts'), {
      churchId: user!.uid,
      churchName: user!.churchName || user!.displayName,
      churchAvatar: user!.avatar || null,
      type: finalType,
      content: data.content,
      mediaUrl: data.mediaUrl || null,
      coverUrl: data.coverUrl || null,
      fileName: data.fileName || null,
      likes: 0,
      commentsCount: 0,
      createdAt: serverTimestamp()
    })
    logActivity(user, 'post_created', `${finalType} - ${data.content.slice(0, 60)}`)
  }

  const handleAddComment = async (text: string) => {
    if (!activeCommentsPost || !user) return
    await addDoc(collection(db, 'comments'), {
      postId: activeCommentsPost,
      userName: user.displayName,
      userId: user.uid,
      text,
      createdAt: serverTimestamp()
    })
    await updateDoc(doc(db, 'posts', activeCommentsPost), { commentsCount: increment(1) })
  }

  const handleLike = async (postId: string) => {
    if (!user) return
    const likeDocId = `${postId}_${user.uid}`
    const alreadyLiked = likedPostIds.has(postId)
    if (alreadyLiked) {
      await deleteDoc(doc(db, 'likes', likeDocId))
      await updateDoc(doc(db, 'posts', postId), { likes: increment(-1) })
    } else {
      await setDoc(doc(db, 'likes', likeDocId), {
        postId, userId: user.uid, createdAt: serverTimestamp()
      })
      await updateDoc(doc(db, 'posts', postId), { likes: increment(1) })
    }
  }

  const handleApproveChurch = async (uid: string) => {
    const church = pendingChurches.find(c => c.uid === uid)
    await updateDoc(doc(db, 'users', uid), { role: 'church' })
    // Mirror into the public directory so the member-signup dropdown can
    // read it without needing an authenticated session.
    if (church) {
      await setDoc(doc(db, 'churchDirectory', uid), { name: church.churchName || church.displayName })
    }
    logActivity(user, 'church_approved', church?.churchName || church?.displayName || uid)
  }

  const handleDenyChurch = async (uid: string) => {
    const church = pendingChurches.find(c => c.uid === uid)
    // Deny doesn't delete the account — it just drops them back to a normal
    // member so they aren't stuck pending forever and can still use the app.
    await updateDoc(doc(db, 'users', uid), { role: 'member' })
    logActivity(user, 'church_denied', church?.churchName || church?.displayName || uid)
  }

  // Filtering and search run client-side over the already-loaded feed. At
  // congregation scale this is instant and avoids extra Firestore reads or
  // composite indexes; if the post count ever grows large enough for this to
  // lag, it'd move to server-side queries with pagination.
  const visiblePosts = useMemo(() => {
    let result = posts

    if (feedFilter === 'video') {
      result = result.filter(p => p.type === 'video' || p.type === 'youtube' || p.type === 'facebook')
    } else if (feedFilter === 'audio') {
      result = result.filter(p => p.type === 'audio')
    } else if (feedFilter === 'posts') {
      result = result.filter(p => p.type === 'text-image' || p.type === 'document')
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(p =>
        (p.content || '').toLowerCase().includes(q) ||
        (p.churchName || '').toLowerCase().includes(q) ||
        (p.fileName || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [posts, feedFilter, searchQuery])

  // The animated intro runs ahead of everything, including the auth check -
  // so the app feels like it's presenting itself rather than making the
  // person watch a loading spinner. Auth resolves in the background during
  // the animation, so this usually costs no extra wait at all.
  if (!splashDone) {
    return <AnimatedSplash onDone={() => setSplashDone(true)} />
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Logged out: phone & tablet get the compact app-style auth screen,
  // computer browsers (lg+) get the full marketing landing page.
  if (!user) {
    return (
      <>
        <div className="lg:hidden"><AuthScreen onSuccess={setUser} /></div>
        <div className="hidden lg:block"><LandingPage onSuccess={setUser} /></div>
      </>
    )
  }

  if (user.role === 'pending_church') return <PendingScreen user={user} onLogout={handleLogout} />

  const navItems = [
    { id: 'feed', icon: Home, label: t('nav.feed') },
    { id: 'profile', icon: User, label: t('nav.profile') },
    ...(user.role === 'admin' ? [
      { id: 'admin', icon: ShieldCheck, label: t('nav.admin') },
      { id: 'logs', icon: ScrollText, label: t('nav.logs') }
    ] : [])
  ]

  return (
    <div className="min-h-screen bg-[#0f172a] max-w-lg mx-auto lg:max-w-none lg:mx-0 relative">
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-0 lg:right-1/4 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="lg:flex">
        {/* Sidebar — desktop only */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-r border-white/10 bg-[#1e293b] px-6 py-8">
          <div className="flex items-center justify-between">
            <Logo size={34} />
          </div>
          <div className="mt-4"><LanguageSwitcher dark /></div>
          <nav className="mt-6 flex-1 space-y-1">
            {navItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition ${
                    active ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
                  <Icon size={19} />
                  {item.label}
                  {item.id === 'admin' && pendingChurches.length > 0 && (
                    <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {pendingChurches.length}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
          {canPost && (
            <button onClick={() => setShowCreate(true)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition shadow-lg shadow-emerald-500/30 mb-4">
              <PlusCircle size={18} /> {t('nav.newPost')}
            </button>
          )}
          <div className="pt-4 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 truncate">{user.displayName}</span>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-white/5 text-slate-400">
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {/* Header — mobile & tablet only */}
          <header className="lg:hidden sticky top-0 z-40 bg-[#0f172a]/80 backdrop-blur-xl border-b border-white/10">
            <div className="px-5 h-14 flex items-center justify-between">
              <Logo size={32} />
              <div className="flex items-center gap-2.5">
                <LanguageSwitcher dark />
                <span className="text-xs font-medium text-slate-400 truncate max-w-[80px]">{user.displayName}</span>
                <button onClick={handleLogout} className="p-2 rounded-full hover:bg-white/5 text-slate-400">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </header>

          <main className="pb-28 lg:pb-16 px-4 lg:px-10 pt-4 lg:pt-10 lg:max-w-3xl xl:max-w-4xl lg:mx-auto">
            {activeTab === 'feed' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('feed.searchPlaceholder')}
                    className="w-full pl-11 pr-10 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10">
                      <X size={15} />
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {([
                    { id: 'all', label: t('feed.all') },
                    { id: 'video', label: t('feed.videos') },
                    { id: 'audio', label: t('feed.audios') },
                    { id: 'posts', label: t('feed.posts') },
                  ] as const).map(tab => (
                    <button key={tab.id} onClick={() => setFeedFilter(tab.id)}
                      className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition ${
                        feedFilter === tab.id
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/40'
                          : 'bg-white/5 text-slate-400 border border-white/10 hover:text-slate-200'}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {loading && <p className="text-center text-slate-400 py-16">{t('app.loading')}</p>}
                {!loading && visiblePosts.length === 0 && (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                      <Church size={28} className="text-emerald-400" />
                    </div>
                    <p className="text-slate-300 font-medium">
                      {searchQuery || feedFilter !== 'all' ? t('feed.noMatches') : t('app.noPostsYet')}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {searchQuery || feedFilter !== 'all' ? t('feed.tryDifferent') : t('app.beFirstToShare')}
                    </p>
                  </div>
                )}
                {visiblePosts.map(post => (
                  <PostCard key={post.id} post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost}
                    currentUserUid={user.uid} isLiked={likedPostIds.has(post.id)} onEdit={setEditingPost} onDelete={handleDeletePost} />
                ))}
              </div>
            )}

            {activeTab === 'profile' && (
              <ProfileTab user={user} onProfileUpdated={(updates) => setUser(prev => prev ? { ...prev, ...updates } : prev)} />
            )}

            {activeTab === 'admin' && user.role === 'admin' && (
              <AdminPanel pendingChurches={pendingChurches} onApprove={handleApproveChurch} onDeny={handleDenyChurch} currentUser={user} />
            )}

            {activeTab === 'logs' && user.role === 'admin' && (
              <LogsPanel />
            )}
          </main>
        </div>

        {/* Bottom Nav — mobile & tablet only */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#0f172a]/90 backdrop-blur-xl border-t border-white/10 safe-bottom z-50">
          <div className="max-w-lg mx-auto flex items-center h-16 px-1">
            {navItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`relative flex flex-col items-center justify-center flex-1 min-w-0 h-full transition ${
                    active ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <Icon size={21} strokeWidth={active ? 2.5 : 2} />
                  {item.id === 'admin' && pendingChurches.length > 0 && (
                    <span className="absolute top-1.5 right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {pendingChurches.length}
                    </span>
                  )}
                  <span className="text-[10px] mt-1 font-medium truncate max-w-full px-0.5">{item.label}</span>
                </button>
              )
            })}
            {canPost && (
              <button onClick={() => setShowCreate(true)}
                className="flex flex-col items-center justify-center flex-1 min-w-0 h-full text-emerald-400">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/40 -mt-4">
                  <PlusCircle size={22} />
                </div>
                <span className="text-[10px] mt-1 font-medium">{t('nav.post')}</span>
              </button>
            )}
          </div>
        </nav>
      </div>

      {showNotifPrompt && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-96 z-50 bg-[#1e293b] border border-white/10 rounded-3xl shadow-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
              <Bell size={19} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white text-[15px]">{t('notifPrompt.title')}</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('notifPrompt.body')}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={async () => {
              setShowNotifPrompt(false)
              const ok = await enableNotifications(user.uid)
              if (ok) setUser(prev => prev ? { ...prev, notificationsEnabled: true } : prev)
            }}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition">
              {t('notifPrompt.enable')}
            </button>
            <button onClick={() => setShowNotifPrompt(false)}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold transition">
              {t('notifPrompt.later')}
            </button>
          </div>
        </div>
      )}

      {showCreate && canPost && (
        <CreatePostModal onClose={() => setShowCreate(false)} onSubmit={handleCreatePost} uploaderUid={user.uid} />
      )}
      {editingPost && (
        <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSave={handleEditPost} />
      )}
      {activeCommentsPost && (
        <CommentsSheet postId={activeCommentsPost} comments={comments}
          onClose={() => setActiveCommentsPost(null)} onAdd={handleAddComment} />
      )}
    </div>
  )
}

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia',
  'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
  'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad',
  'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Brazzaville)', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
  'Czechia', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji',
  'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala',
  'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran',
  'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya',
  'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein',
  'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
  'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger',
  'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia',
  'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore',
  'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain',
  'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania',
  'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan',
  'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay',
  'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
]

// Calling codes for the phone input's country picker. Not exhaustive (that's
// what COUNTRIES above is for) - just a curated, sensible set prioritizing
// Burkina Faso and neighboring West African countries first, since that's
// this app's primary user base, followed by other common ones.
const COUNTRY_CODES = [
  { name: 'Burkina Faso', code: '+226' },
  { name: "Côte d'Ivoire", code: '+225' },
  { name: 'Mali', code: '+223' },
  { name: 'Niger', code: '+227' },
  { name: 'Senegal', code: '+221' },
  { name: 'Ghana', code: '+233' },
  { name: 'Togo', code: '+228' },
  { name: 'Benin', code: '+229' },
  { name: 'Guinea', code: '+224' },
  { name: 'Guinea-Bissau', code: '+245' },
  { name: 'Sierra Leone', code: '+232' },
  { name: 'Liberia', code: '+231' },
  { name: 'The Gambia', code: '+220' },
  { name: 'Mauritania', code: '+222' },
  { name: 'Nigeria', code: '+234' },
  { name: 'Cameroon', code: '+237' },
  { name: 'Chad', code: '+235' },
  { name: 'Gabon', code: '+241' },
  { name: 'Congo (Brazzaville)', code: '+242' },
  { name: 'DR Congo', code: '+243' },
  { name: 'Central African Republic', code: '+236' },
  { name: 'Morocco', code: '+212' },
  { name: 'Algeria', code: '+213' },
  { name: 'Tunisia', code: '+216' },
  { name: 'France', code: '+33' },
  { name: 'Belgium', code: '+32' },
  { name: 'Switzerland', code: '+41' },
  { name: 'Italy', code: '+39' },
  { name: 'Germany', code: '+49' },
  { name: 'Spain', code: '+34' },
  { name: 'United Kingdom', code: '+44' },
  { name: 'Canada', code: '+1' },
  { name: 'United States', code: '+1' },
]

// ==================== COMPONENTS ====================
function ProfileTab({ user, onProfileUpdated }: {
  user: AppUser
  onProfileUpdated: (updates: Partial<AppUser>) => void
}) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  const [churchName, setChurchName] = useState(user.churchName || '')
  const [country, setCountry] = useState(user.country || '')
  const [city, setCity] = useState(user.city || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifError, setNotifError] = useState('')

  const handleToggleNotifications = async () => {
    setNotifError('')
    if (user.notificationsEnabled) {
      await disableNotifications(user.uid)
      onProfileUpdated({ notificationsEnabled: false })
      return
    }
    setNotifLoading(true)
    const ok = await enableNotifications(user.uid)
    setNotifLoading(false)
    if (ok) onProfileUpdated({ notificationsEnabled: true })
    else setNotifError(t('profile.notificationsPermissionDenied'))
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) {
      setAvatarError(t('profile.imageTypeError'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError(t('profile.imageSizeError'))
      return
    }
    setUploading(true)
    try {
      const storageRef = ref(storage, `profile-pictures/${user.uid}/${Date.now()}-${file.name}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(db, 'users', user.uid), { avatar: url })
      onProfileUpdated({ avatar: url })
    } catch (err: any) {
      setAvatarError(err.message?.replace('Firebase: ', '') || t('profile.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const updates = { churchName, country, city, phone }
      await updateDoc(doc(db, 'users', user.uid), updates)
      onProfileUpdated(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setSaveError(err.message?.replace('Firebase: ', '') || t('profile.couldNotSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 text-center">
        <div className="relative w-24 h-24 mx-auto mb-4">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-24 h-24 rounded-full object-cover shadow-lg shadow-emerald-200" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-emerald-200">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white border-2 border-emerald-500 text-emerald-600 flex items-center justify-center cursor-pointer shadow-md hover:bg-emerald-50 transition">
            {uploading ? (
              <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera size={14} />
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} disabled={uploading} />
          </label>
        </div>
        <h2 className="text-xl font-bold text-slate-900">{user.displayName}</h2>
        <p className="text-slate-400 text-sm mt-1">{user.email}</p>
        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
          {user.role === 'church' ? <><CheckCircle2 size={14} /> {t('app.verifiedChurch')}</> : user.role === 'admin' ? <><ShieldCheck size={14} /> {t('app.admin')}</> : t('app.member')}
        </div>
        {avatarError && <p className="mt-4 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 inline-block">{avatarError}</p>}
      </div>

      <form onSubmit={handleSaveProfile} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
        <h3 className="font-bold text-slate-900 px-1">{t('profile.details')}</h3>

        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.church')}</label>
          <input value={churchName} onChange={e => setChurchName(e.target.value)} placeholder={t('profile.churchPlaceholder')}
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.country')}</label>
            <select value={country} onChange={e => setCountry(e.target.value)}
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px] bg-white">
              <option value="">{t('profile.selectCountry')}</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.city')}</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Ouagadougou"
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.phoneNumber')}</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +226 70 00 00 00"
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        </div>

        {saveError && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{saveError}</p>}
        {saved && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{t('profile.updated')}</p>}

        <button type="submit" disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition disabled:opacity-60">
          {saving ? t('profile.saving') : t('profile.saveChanges')}
        </button>
      </form>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-900">{t('profile.notifications')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('profile.notificationsNote')}</p>
          </div>
          <button onClick={handleToggleNotifications} disabled={notifLoading}
            role="switch" aria-checked={!!user.notificationsEnabled}
            className={`relative shrink-0 w-12 h-7 rounded-full transition disabled:opacity-60 ${
              user.notificationsEnabled ? 'bg-emerald-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              user.notificationsEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {notifError && <p className="mt-3 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{notifError}</p>}
      </div>
    </div>
  )
}

function LogsPanel() {
  const { t } = useLanguage()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'auth' | 'posts' | 'admin'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Capped at 300 - enough to troubleshoot recent issues without pulling
    // an unbounded collection into memory as the log grows over time.
    const q = query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(300))
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  const ACTION_META: Record<string, { label: string; color: string }> = {
    signin: { label: t('logs.signin'), color: 'bg-blue-50 text-blue-700' },
    signup: { label: t('logs.signup'), color: 'bg-emerald-50 text-emerald-700' },
    post_created: { label: t('logs.postCreated'), color: 'bg-emerald-50 text-emerald-700' },
    post_edited: { label: t('logs.postEdited'), color: 'bg-amber-50 text-amber-700' },
    post_deleted: { label: t('logs.postDeleted'), color: 'bg-red-50 text-red-700' },
    church_approved: { label: t('logs.churchApproved'), color: 'bg-emerald-50 text-emerald-700' },
    church_denied: { label: t('logs.churchDenied'), color: 'bg-red-50 text-red-700' },
    directory_synced: { label: t('logs.directorySynced'), color: 'bg-slate-100 text-slate-600' },
  }

  const visible = useMemo(() => {
    let result = logs
    if (filter === 'auth') result = result.filter(l => ['signin', 'signup'].includes(l.action))
    else if (filter === 'posts') result = result.filter(l => l.action.startsWith('post_'))
    else if (filter === 'admin') result = result.filter(l => l.action.startsWith('church_') || l.action === 'directory_synced')

    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(l =>
        (l.userName || '').toLowerCase().includes(q) ||
        (l.detail || '').toLowerCase().includes(q) ||
        (ACTION_META[l.action]?.label || l.action).toLowerCase().includes(q)
      )
    }
    return result
  }, [logs, filter, search])

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('logs.searchPlaceholder')}
          className="w-full pl-11 pr-10 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]" />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          { id: 'all', label: t('logs.all') },
          { id: 'auth', label: t('logs.authFilter') },
          { id: 'posts', label: t('logs.postsFilter') },
          { id: 'admin', label: t('logs.adminFilter') },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setFilter(tab.id)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition ${
              filter === tab.id
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/40'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:text-slate-200'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-center text-slate-400 py-16">{t('app.loading')}</p>}

      {!loading && visible.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <ScrollText size={28} className="text-emerald-400" />
          </div>
          <p className="text-slate-300 font-medium">{t('logs.empty')}</p>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          {visible.map((log, i) => {
            const meta = ACTION_META[log.action] || { label: log.action, color: 'bg-slate-100 text-slate-600' }
            return (
              <div key={log.id} className={`px-5 py-3.5 ${i !== visible.length - 1 ? 'border-b border-slate-50' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                  <span className="text-sm font-semibold text-slate-800">{log.userName}</span>
                  <span className="text-[11px] text-slate-400">({log.userRole})</span>
                  <span className="text-[11px] text-slate-400 ml-auto">{timeAgo(log.createdAt)}</span>
                </div>
                {log.detail && <p className="text-xs text-slate-500 mt-1.5 break-words">{log.detail}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AdminPanel({ pendingChurches, onApprove, onDeny, currentUser }: {
  pendingChurches: AppUser[]
  onApprove: (uid: string) => void
  onDeny: (uid: string) => void
  currentUser: AppUser
}) {
  const { t } = useLanguage()
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; count?: number; total?: number; error?: string } | null>(null)

  const handle = async (uid: string, action: 'approve' | 'deny') => {
    setBusyUid(uid)
    try {
      if (action === 'approve') await onApprove(uid)
      else await onDeny(uid)
    } finally {
      setBusyUid(null)
    }
  }

  const handleSyncDirectory = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'church')))
      const results = await Promise.allSettled(snap.docs.map(d => {
        const data = d.data() as AppUser
        // Firestore rejects `undefined` field values outright, so this needs
        // an actual fallback string, not just `a || b` with both possibly
        // undefined (this was the likely cause of the previous failure).
        const name = data.churchName || data.displayName || 'Church'
        return setDoc(doc(db, 'churchDirectory', d.id), { name })
      }))
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const firstFailure = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
      if (firstFailure) {
        setSyncResult({
          ok: succeeded > 0, count: succeeded, total: results.length,
          error: firstFailure.reason?.message || firstFailure.reason?.code || String(firstFailure.reason)
        })
      } else {
        setSyncResult({ ok: true, count: succeeded, total: results.length })
        logActivity(currentUser, 'directory_synced', `${succeeded} church(es)`)
      }
    } catch (err: any) {
      setSyncResult({ ok: false, error: err.message || err.code || String(err) })
    } finally {
      setSyncing(false)
    }
  }

  const syncSection = (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
      <button onClick={handleSyncDirectory} disabled={syncing}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition disabled:opacity-50">
        {syncing ? t('admin.syncing') : t('admin.syncDirectory')}
      </button>
      <p className="text-xs text-slate-400 mt-2 text-center">{t('admin.syncDirectoryNote')}</p>
      {syncResult && (
        <p className={`text-xs mt-2 text-center font-medium ${syncResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
          {syncResult.ok
            ? `${t('admin.synced')} ${syncResult.count}${syncResult.total ? `/${syncResult.total}` : ''} ${t('admin.churchesSelectable')}`
            : `${t('admin.syncFailed')}${syncResult.error ? ': ' + syncResult.error : ''}`}
        </p>
      )}
    </div>
  )

  if (pendingChurches.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={28} className="text-emerald-500" />
          </div>
          <p className="text-slate-500 font-medium">{t('admin.noPending')}</p>
          <p className="text-sm text-slate-400 mt-1">{t('admin.noPendingNote')}</p>
        </div>
        {syncSection}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 px-1">{t('admin.pendingChurches')} ({pendingChurches.length})</h2>
      {pendingChurches.map(church => (
        <div key={church.uid} className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-white font-bold shrink-0">
              {(church.churchName || church.displayName).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate">{church.churchName || church.displayName}</h3>
              <p className="text-xs text-slate-400 truncate">{church.email}</p>
              {church.location && <p className="text-xs text-slate-400">{church.location}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handle(church.uid, 'approve')} disabled={busyUid === church.uid}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition disabled:opacity-50">
              <CheckCircle2 size={16} /> {t('admin.approve')}
            </button>
            <button onClick={() => handle(church.uid, 'deny')} disabled={busyUid === church.uid}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition disabled:opacity-50">
              <UserX size={16} /> {t('admin.deny')}
            </button>
          </div>
        </div>
      ))}
      {syncSection}
    </div>
  )
}

function PostCard({ post, onLike, onOpenComments, currentUserUid, isLiked, onEdit, onDelete }: {
  post: Post
  onLike: (id: string) => Promise<void>
  onOpenComments: (id: string) => void
  currentUserUid: string
  isLiked: boolean
  onEdit: (post: Post) => void
  onDelete: (id: string) => void
}) {
  const { t } = useLanguage()
  const ytId = post.mediaUrl ? getYoutubeId(post.mediaUrl) : null
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [likeError, setLikeError] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const handleShare = async () => {
    const shareUrl = `https://ccelim.com/?post=${post.id}`
    const shareTitle = post.churchName || 'ELIM'
    const shareText = (post.content || '').slice(0, 160)

    try {
      // Native share sheet on Android/iOS.
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: shareTitle, text: shareText, url: shareUrl })
        return
      }
      // Web Share API where supported (most mobile browsers).
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl })
        return
      }
      // Desktop browsers: copy to clipboard and confirm visually.
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      // User dismissing the share sheet throws too - not worth surfacing
      // as an error, so this stays silent.
    }
  }

  const isOwner = post.churchId === currentUserUid

  const handleLikeClick = async () => {
    setLikeError(false)
    try {
      await onLike(post.id)
    } catch {
      // Surface the failure instead of the button silently doing nothing —
      // most commonly this means the Firestore rules for the likes
      // collection haven't been published yet.
      setLikeError(true)
      setTimeout(() => setLikeError(false), 4000)
    }
  }

  return (
    <article className="bg-white rounded-3xl shadow-sm border border-slate-100/80 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        {post.churchAvatar ? (
          <img src={post.churchAvatar} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {(post.churchName || 'C').charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">{post.churchName || t('common.church')}</h3>
          <p className="text-xs text-slate-400">{timeAgo(post.createdAt)}</p>
        </div>
        {isOwner && (
          confirmingDelete ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => onDelete(post.id)}
                className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-full transition">
                {t('post.delete')}
              </button>
              <button onClick={() => setConfirmingDelete(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2">
                {t('post.cancel')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => onEdit(post)}
                className="p-2 rounded-full text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition">
                <Pencil size={16} />
              </button>
              <button onClick={() => setConfirmingDelete(true)}
                className="p-2 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition">
                <Trash2 size={17} />
              </button>
            </div>
          )
        )}
      </div>

      {post.content && (
        <div className="px-4 pb-3">
          <p className="text-slate-800 text-[15px] leading-relaxed whitespace-pre-wrap">{post.content}</p>
        </div>
      )}

      {/* Media */}
      {post.type === 'text-image' && post.mediaUrl && (
        <img src={post.mediaUrl} alt="" className="w-full max-h-80 object-cover" />
      )}

      {post.type === 'youtube' && ytId && (
        <div className="relative aspect-video bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${ytId}`}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {post.type === 'youtube' && post.mediaUrl && !ytId && (
        <div className="bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-red-600 mb-2">
            <Youtube size={18} />
            <span className="text-sm font-medium">YouTube Video</span>
          </div>
          <a href={post.mediaUrl} target="_blank" rel="noreferrer"
            className="text-sm text-emerald-600 underline break-all">{post.mediaUrl}</a>
        </div>
      )}

      {post.type === 'facebook' && post.mediaUrl && (
        <div>
          <div className="relative aspect-video bg-black">
            <iframe
              src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(post.mediaUrl)}&show_text=false`}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <a href={post.mediaUrl} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-blue-600 hover:bg-slate-50 border-t border-slate-50">
            <Facebook size={13} /> {t('post.watchOnFacebook')}
          </a>
        </div>
      )}

      {post.type === 'video' && post.mediaUrl && !ytId && (
        <video src={post.mediaUrl} controls playsInline preload="metadata" className="w-full max-h-72 bg-black" />
      )}

      {post.type === 'audio' && post.mediaUrl && (
        <div className="px-4 pb-4">
          {post.coverUrl && (
            <img src={post.coverUrl} alt="" className="w-full h-40 object-cover rounded-2xl mb-3" />
          )}
          <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Mic size={16} />
            </div>
            <audio
              src={post.mediaUrl}
              controls
              preload="metadata"
              className="w-full h-9"
              onPlay={e => {
                attachMediaSession(e.currentTarget, {
                  title: post.content?.slice(0, 60) || 'Audio',
                  artist: post.churchName || 'ELIM',
                  artwork: post.coverUrl || undefined
                })
                updateMediaSessionState(true)
              }}
              onPause={() => updateMediaSessionState(false)}
            />
          </div>
        </div>
      )}

      {post.type === 'document' && post.mediaUrl && (
        <div className="px-4 pb-4">
          <a href={post.mediaUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 bg-slate-50 hover:bg-slate-100 rounded-2xl px-4 py-3.5 transition">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
              <FileText size={19} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{post.fileName || t('post.document.fallback')}</p>
              <p className="text-xs text-slate-400">{t('post.tapToOpen')}</p>
            </div>
          </a>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-50">
        <div className="flex items-center gap-5 relative">
          <button onClick={handleLikeClick}
            className={`flex items-center gap-1.5 text-sm font-medium transition ${
              isLiked ? 'text-red-500' : 'text-slate-400 hover:text-red-500'}`}>
            <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
            {post.likes || 0}
          </button>
          {likeError && (
            <span className="absolute -top-7 left-0 text-[11px] font-medium text-red-500 bg-red-50 rounded-full px-2.5 py-1 whitespace-nowrap">
              {t('post.couldntUpdate')}
            </span>
          )}
          <button onClick={() => onOpenComments(post.id)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-emerald-600">
            <MessageCircle size={18} />
            {post.commentsCount || 0}
          </button>
        </div>
        <button onClick={handleShare} className="relative text-slate-300 hover:text-emerald-600">
          <Share2 size={18} />
          {shareCopied && (
            <span className="absolute -top-8 right-0 text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1 whitespace-nowrap">
              {t('post.linkCopied')}
            </span>
          )}
        </button>
      </div>
    </article>
  )
}

const UPLOAD_RULES: Record<string, { accept: string; maxMB: number; check: (f: File) => boolean; label: string }> = {
  'text-image': { accept: 'image/jpeg,image/png,image/webp,image/gif', maxMB: 10, check: f => f.type.startsWith('image/'), label: 'a photo' },
  audio: { accept: 'audio/*,.m4a', maxMB: 50, check: f => f.type.startsWith('audio/'), label: 'an audio file' },
  video: { accept: 'video/mp4,video/webm,video/quicktime', maxMB: 200, check: f => f.type.startsWith('video/'), label: 'a video' },
  document: { accept: 'application/pdf', maxMB: 20, check: f => f.type === 'application/pdf', label: 'a PDF' },
}

function CreatePostModal({ onClose, onSubmit, uploaderUid }: {
  onClose: () => void
  onSubmit: (data: { type: Post['type']; content: string; mediaUrl?: string; coverUrl?: string; fileName?: string }) => void
  uploaderUid: string
}) {
  const { t } = useLanguage()
  const [type, setType] = useState<Post['type']>('text-image')
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState('')

  const canUploadDirectly = type === 'text-image' || type === 'audio' || type === 'video' || type === 'document'
  const rule = UPLOAD_RULES[type]

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !rule) return
    setUploadError('')
    if (!rule.check(file)) {
      setUploadError("That doesn't look like a supported file for this post type.")
      return
    }
    if (file.size > rule.maxMB * 1024 * 1024) {
      setUploadError(`File is too large — max ${rule.maxMB}MB for this type.`)
      return
    }
    setUploading(true)
    setUploadProgress(0)
    const storageRef = ref(storage, `post-media/${uploaderUid}/${Date.now()}-${file.name}`)
    const task = uploadBytesResumable(storageRef, file)
    task.on('state_changed',
      snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      err => {
        setUploadError(err.message || 'Upload failed')
        setUploading(false)
      },
      async () => {
        const url = await getDownloadURL(storageRef)
        setMediaUrl(url)
        setFileName(file.name)
        setUploading(false)
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
          <h2 className="font-bold text-lg">{t('post.new')}</h2>
          <button onClick={() => {
            if (content.trim() && !uploading) {
              onSubmit({
                type, content: content.trim(),
                mediaUrl: mediaUrl || undefined,
                coverUrl: (type === 'audio' && coverUrl) ? coverUrl : undefined,
                fileName: (type === 'document' && fileName) ? fileName : undefined
              })
              onClose()
            }
          }}
            disabled={!content.trim() || uploading}
            className="text-emerald-600 font-semibold disabled:opacity-40">{t('post.publish')}</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {[{
              id: 'text-image', icon: ImageIcon, label: t('post.photo')
            }, {
              id: 'audio', icon: Mic, label: t('post.audio')
            }, {
              id: 'document', icon: FileText, label: t('post.document')
            }, {
              id: 'youtube', icon: Youtube, label: 'YouTube'
            }, {
              id: 'facebook', icon: Facebook, label: 'Facebook'
            }, {
              id: 'video', icon: Video, label: t('post.video')
            }].map(opt => (
              <button key={opt.id} onClick={() => { setType(opt.id as Post['type']); setMediaUrl(''); setFileName(''); setUploadError('') }}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition ${
                  type === opt.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-100 text-slate-400'}`}>
                <opt.icon size={20} />
                <span className="text-[11px] font-medium">{opt.label}</span>
              </button>
            ))}
          </div>

          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder={t('post.contentPlaceholder')}
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-[15px]" />

          {canUploadDirectly && rule && (
            <div>
              <label className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed transition cursor-pointer ${
                mediaUrl && fileName ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'}`}>
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-500">{t('post.uploading')} {uploadProgress}%</span>
                  </>
                ) : mediaUrl && fileName ? (
                  <>
                    <CheckCircle2 size={22} className="text-emerald-500" />
                    <span className="text-xs text-slate-600 font-medium px-4 text-center break-all">{fileName}</span>
                    <span className="text-[11px] text-emerald-600">{t('post.tapToReplace')}</span>
                  </>
                ) : (
                  <>
                    <Upload size={22} className="text-slate-400" />
                    <span className="text-xs text-slate-500 font-medium">
                      {t(`post.upload${type === 'text-image' ? 'Photo' : type === 'audio' ? 'Audio' : type === 'video' ? 'Video' : 'Pdf'}` as any)}
                    </span>
                    <span className="text-[11px] text-slate-400">{t('post.maxSize')} {rule.maxMB}MB</span>
                  </>
                )}
                <input type="file" accept={rule.accept} className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
              {uploadError && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{uploadError}</p>}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="h-px bg-slate-100 flex-1" />
            <span className="text-xs text-slate-400 font-medium">{canUploadDirectly ? t('post.orPasteLinkInstead') : t('post.pasteLink')}</span>
            <div className="h-px bg-slate-100 flex-1" />
          </div>

          <input value={mediaUrl} onChange={e => { setMediaUrl(e.target.value); setFileName('') }}
            placeholder={
              type === 'youtube' ? t('post.pasteYoutube') :
              type === 'facebook' ? t('post.pasteFacebook') :
              type === 'audio' ? t('post.pasteAudioUrl') :
              type === 'document' ? t('post.pasteDocUrl') :
              t('post.pasteImageVideoUrl')
            }
            className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />

          {type === 'audio' && (
            <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)}
              placeholder={t('post.pasteCoverUrl')}
              className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          )}
        </div>
      </div>
    </div>
  )
}

function EditPostModal({ post, onClose, onSave }: {
  post: Post
  onClose: () => void
  onSave: (id: string, content: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const [content, setContent] = useState(post.content)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      await onSave(post.id, content.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
          <h2 className="font-bold text-lg">{t('post.edit')}</h2>
          <button onClick={handleSave} disabled={!content.trim() || saving}
            className="text-emerald-600 font-semibold disabled:opacity-40">
            {saving ? t('post.saving') : t('post.save')}
          </button>
        </div>
        <div className="p-5">
          <textarea value={content} onChange={e => setContent(e.target.value)}
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-[15px]" />
          {post.mediaUrl && (
            <p className="mt-3 text-xs text-slate-400">
              {t('post.editNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CommentsSheet({ postId, comments, onClose, onAdd }: {
  postId: string; comments: Comment[]; onClose: () => void; onAdd: (text: string) => void
}) {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const list = comments.filter(c => c.postId === postId)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl max-h-[75vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold">{t('comments.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {list.length === 0 && <p className="text-center text-slate-400 text-sm py-10">{t('comments.none')}</p>}
          {list.map(c => (
            <div key={c.id} className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm shrink-0">
                {c.userName.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="bg-slate-50 rounded-2xl px-3.5 py-2.5">
                  <p className="text-sm font-semibold text-slate-800">{c.userName}</p>
                  <p className="text-sm text-slate-600">{c.text}</p>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 ml-1">{timeAgo(c.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-100 flex gap-2">
          <input value={text} onChange={e => setText(e.target.value)} placeholder={t('comments.writePlaceholder')}
            className="flex-1 bg-slate-100 rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText('') } }} />
          <button onClick={() => { if (text.trim()) { onAdd(text.trim()); setText('') } }}
            className="w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-200">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== ROOT EXPORT ====================
// Wraps the actual app in the language provider so every component above
// can call useLanguage(). Kept as a thin wrapper here rather than moving
// this into main.tsx, so App.tsx stays fully self-contained.
export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  )
}
