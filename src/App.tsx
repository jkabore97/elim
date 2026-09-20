import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Home, Church, PlusCircle, User, MessageCircle, Heart, Share2,
  Image as ImageIcon, Video, Mic, X, Send, LogOut,
  Youtube, Facebook, CheckCircle2, Clock, ArrowRight, ShieldCheck, UserX, Sparkles,
  Trash2, Camera, FileText, Upload, Pencil, Globe, Eye, EyeOff, Search, Bell, ScrollText, Mail, Play, Pause, HeartPulse, Download, AlertTriangle, BookOpen, Music, LifeBuoy,
  HandCoins, Copy, Check, Plus, Flag, Users, CreditCard, Loader2, Trophy, ChevronDown, Megaphone, AtSign
} from 'lucide-react'
import {
  collection, addDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, doc, updateDoc, deleteDoc, increment, setDoc, getDoc, getDocs, limit, writeBatch, Timestamp
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  sendEmailVerification, sendPasswordResetEmail,
  EmailAuthProvider, linkWithCredential
} from 'firebase/auth'
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { auth, db, storage, functions } from './firebase'
import { enableNotifications, disableNotifications, listenForForegroundMessages, checkNotificationPermission, reconcileNotificationState, initNativeNotifications, sendTestNotification, notificationDiagnostics, onNotificationRoute, consumeLaunchUrlRoute, openNotificationSettings, cleanupPushForLogout } from './notifications'
import { storageGet, storageSet } from './safeStorage'
import { StarField } from './StarField'
import { ReportSheet } from './ReportSheet'
import { AutoTranslate } from './AutoTranslate'
import { MembersTab } from './MembersTab'
import { OfflineButton } from './OfflineButton'
import { getOfflineSrc, removeOffline } from './offline'
import { logActivity } from './activityLog'
import { AnimatedSplash } from './AnimatedSplash'
import { MediaPlayerProvider, useMediaPlayer } from './MediaPlayer'
import { ImageLightbox } from './ImageLightbox'
import { initBackButton, useBackHandler } from './backButton'
import { MessagesTab, useUnreadCount } from './Messages'
import { playMessageAlert, isAlertMuted, setAlertMuted } from './messageAlert'
import { getSoundSettings, setSoundSettings, setEventSounds, getEventSound, emit as playFeedback, QUIZ_EVENTS, type SoundChannel, type QuizEvent } from './feedback'
import { SOUND_IDS, SOUND_NAMES, playSound } from './quiz/soundlib'
import { DataManagementTab } from './DataManagement'
import { LibraryTab } from './Library'
import BibleQuiz from './BibleQuiz'
import { App as CapApp } from '@capacitor/app'
import { subscribeProfile as subscribeQuizProfile } from './quiz/store'
import { todayKey as quizTodayKey } from './quiz/engine'
import { subscribeGroups } from './groups'
import { GroupsPanel } from './Groups'
import { GroupLogo, groupLogoKind } from './GroupLogo'
import type { Post, Comment, AppUser, ActivityLog, AppNotification, Announcement, ScheduledBroadcast, DonationConfig, DonationProvider, Report, DonationType, Donation, Group } from './types'
import { LanguageProvider, useLanguage, LANGUAGES, type Language } from './i18n'
import { FR_COUNTRY, EN_PROFESSION, EN_INTEREST } from './labels'
import { dialFor } from './countries'
import { recordPostView, recordPostShare } from './engagement'
import { PullToRefresh } from './PullToRefresh'
import { fetchMemberNames, fetchMemberProfile, type MemberProfile } from './members'
import { TValue } from './TValue'

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

// A playlist link carries a list= parameter. Supporting these turns one post
// into an entire album or choir collection: YouTube's own player handles
// next/previous, and every title comes from YouTube rather than being typed
// in by hand.
function getYoutubePlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/)
  if (!match) return null
  // 'RD' and 'LL' prefixes are auto-generated mixes and personal Liked lists -
  // neither is a real shared playlist and neither embeds for other people.
  if (/^(RD|LL|WL)/.test(match[1])) return null
  return match[1]
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

// Single source of truth for the copyright line, so the year and wording
// never drift between the landing page, auth screens, sidebar, and splash.
const COPYRIGHT = `© ${new Date().getFullYear()} Centre Chrétien E.L.I.M. All rights reserved.`

// Groups log entries under Today / Yesterday / an explicit date.
function dayLabel(date: any, t: (k: any) => string): string {
  if (!date) return t('logs.unknownDate')
  const d = date.toDate ? date.toDate() : new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return t('logs.today')
  if (sameDay(d, yesterday)) return t('logs.yesterday')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Exact wall-clock time - for troubleshooting, "14:32" is far more useful
// than a relative "2 hours ago".
function clockTime(date: any): string {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}


async function downloadMedia(url: string, suggestedName: string) {
  try {
    if (Capacitor.isNativePlatform()) {
      // In the app, hand off to the system browser/downloader rather than
      // trying to write to the filesystem ourselves - it lands in Downloads
      // where people expect it, with no extra permission prompt.
      window.open(url, '_blank')
      return
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
  } catch {
    // If the fetch is blocked (CORS, offline), opening the file directly is
    // still better than the button appearing to do nothing.
    window.open(url, '_blank')
  }
}

// Storage URLs carry query tokens, so the extension has to be recovered from
// the path portion rather than the whole string.
function fileNameFor(post: Post): string {
  if (post.fileName) return post.fileName
  const path = (post.mediaUrl || '').split('?')[0]
  const ext = path.includes('.') ? path.split('.').pop()!.slice(0, 5) : 'file'
  const base = (post.content || 'elim').slice(0, 40).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
  return `${base || 'elim'}.${ext}`
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

// Animated emerald-glass hero shown above the sign-in card. Pure CSS motion
// (see index.css .banner-*): a floating logo in a pulsing halo, drifting aura
// blobs, a shining title and rising sparks. Respects prefers-reduced-motion.
function AuthBanner({ subtitle }: { subtitle?: string }) {
  // Fixed spark positions/delays so the animation is deterministic (no random).
  const sparks = [
    { left: '20%', delay: '0s', dur: '7s' },
    { left: '38%', delay: '2.4s', dur: '8s' },
    { left: '54%', delay: '4.1s', dur: '6.5s' },
    { left: '72%', delay: '1.2s', dur: '7.6s' },
    { left: '84%', delay: '3.3s', dur: '8.4s' },
  ]
  return (
    <div className="banner-hero px-6 py-8 mb-8">
      <div className="banner-aura" aria-hidden="true" />
      <div className="banner-aura banner-aura-2" aria-hidden="true" />
      {sparks.map((s, i) => (
        <span key={i} className="banner-spark" aria-hidden="true"
          style={{ left: s.left, animationDelay: s.delay, animationDuration: s.dur }} />
      ))}
      <div className="relative flex flex-col items-center text-center">
        <div className="banner-logo-wrap">
          <div className="banner-halo" aria-hidden="true" />
          <Logo size={76} variant="mark" />
        </div>
        <h1 translate="no" className="notranslate banner-title mt-4 text-3xl font-extrabold tracking-tight">ELIM</h1>
        {subtitle && <p className="mt-1 text-[13px] font-semibold text-white/90">{subtitle}</p>}
      </div>
    </div>
  )
}

// Small EN/FR toggle. `dark` picks the variant meant to sit on dark
// surfaces (auth screens, sidebar) vs. light ones (landing page nav).
// Compact all-languages dropdown (globe + native <select>). A native select
// scales cleanly to any number of languages and is fully accessible. Used on
// the pre-login auth/landing screens (where there's no Profile tab yet); the
// logged-in app puts the picker under Profile instead.
function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage()
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-100 border border-transparent">
      <Globe size={14} className="text-slate-500 shrink-0" />
      <select value={language} onChange={e => setLanguage(e.target.value as Language)}
        aria-label="Language"
        className="bg-transparent text-[13px] font-semibold text-slate-700 focus:outline-none appearance-none pr-1 cursor-pointer">
        {LANGUAGES.map(l => (
          <option key={l.code} value={l.code}>{l.native}</option>
        ))}
      </select>
    </div>
  )
}

// The full language picker shown under Profile: one tappable row per language,
// its own name shown, a check on the active one.
function LanguagePicker() {
  const { language, setLanguage, t } = useLanguage()
  return (
    <div className="glass rounded-3xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-2">
        <Globe size={18} className="text-affirm-600" />
        <h3 className="font-bold text-slate-900">{t('profile.language')}</h3>
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{t('profile.languageNote')}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {LANGUAGES.map(l => {
          const on = language === l.code
          return (
            <button key={l.code} type="button" onClick={() => setLanguage(l.code)}
              dir={l.rtl ? 'rtl' : 'ltr'}
              className={`flex items-center justify-between gap-2 px-4 py-3 rounded-2xl border text-[15px] font-semibold transition ${
                on ? 'border-affirm-500 bg-affirm-50 text-affirm-700' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
              <span className="truncate">{l.native}</span>
              {on && <Check size={16} className="text-affirm-600 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ==================== SHARED AUTH FORM ====================
// Used inside both the mobile/tablet full-screen AuthScreen and the
// desktop AuthModal, so the login/register logic lives in one place.
// Whole years between a date and today. Compares month/day rather than
// dividing by 365.25 so someone whose birthday is later this month isn't
// counted as already having had it.
function ageFrom(isoDate: string): number {
  const dob = new Date(isoDate)
  if (isNaN(dob.getTime())) return -1
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--
  return age
}

// A searchable country picker. A plain <select> of ~195 countries is a long
// scroll on a phone; this lets people type to filter (accent/case-insensitive)
// and pick from the short matching list. `options` are pre-localized + sorted.
function CountryCombobox({ value, onChange, options, placeholder, className, noMatch }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
  className: string
  noMatch: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const selectedLabel = options.find(o => o.value === value)?.label || ''

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(query.trim())
  const filtered = q ? options.filter(o => norm(o.label).includes(q)) : options

  return (
    <div ref={boxRef} className="relative">
      <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input type="text" value={open ? query : selectedLabel}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setQuery(''); setOpen(true) }}
        placeholder={placeholder} role="combobox" aria-expanded={open} autoComplete="off"
        className={className + ' pl-11'} />
      {open && (
        <ul className="absolute z-40 mt-1 w-full max-h-64 overflow-auto rounded-2xl glass-input shadow-xl py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-2.5 text-sm text-slate-400">{noMatch}</li>
          ) : filtered.map(o => (
            <li key={o.value}>
              <button type="button"
                onMouseDown={e => { e.preventDefault(); onChange(o.value); setQuery(''); setOpen(false) }}
                className={`w-full text-left px-4 py-2.5 text-[15px] hover:bg-affirm-500/10 ${
                  o.value === value ? 'font-bold text-affirm-700' : 'text-slate-700'}`}>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AuthForm({ onSuccess, initialMode = 'login' }: {
  onSuccess: (user: AppUser) => void
  initialMode?: 'login' | 'register'
}) {
  const { t, language } = useLanguage()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [accountType, setAccountType] = useState<'member' | 'church'>('member')

  // Shared name fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // Phone — used by: member signup, member login, church signup.
  // Defaults to the device's country so a member abroad (or in a neighbouring
  // country) isn't stuck on +226 and forced to hunt for their own code.
  const localeDefault = useMemo(() => defaultCountryEntry(), [])
  const [countryCode, setCountryCode] = useState(localeDefault.code)
  const [phone, setPhone] = useState('')

  // Member-only
  // Empty, not 'other': with the "no church" option gone there is no valid
  // default, so this starts blank and the field is required.
  // Birthday is entered as three separate day/month/year pickers (typeable
  // and unambiguous for everyone) and composed into an ISO date.
  const [dobDay, setDobDay] = useState('')
  const [dobMonth, setDobMonth] = useState('')
  const [dobYear, setDobYear] = useState('')
  const dateOfBirth = (dobDay && dobMonth && dobYear)
    ? `${dobYear}-${dobMonth.padStart(2, '0')}-${dobDay.padStart(2, '0')}`
    : ''
  const [gender, setGender] = useState<'homme' | 'femme' | ''>('')
  const [profession, setProfession] = useState('')
  const [signupCountry, setSignupCountry] = useState(localeDefault.country)
  const [signupCity, setSignupCity] = useState('')
  const [quartier, setQuartier] = useState('')
  const [interests, setInterests] = useState<string[]>([])

  const [confirmPhone, setConfirmPhone] = useState('')

  // Password reset lives in its own dialog rather than acting on the login
  // field. Previously the link required an email to already be typed above,
  // and if it wasn't, the only response was a small line of text further down
  // the form - which reads as the button doing nothing at all.
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [resetError, setResetError] = useState('')

  const openReset = () => {
    setResetEmail(email)      // carry over whatever they already typed
    setResetDone(false)
    setResetError('')
    setShowReset(true)
  }

  const submitReset = async () => {
    const target = resetEmail.trim()
    if (!target) { setResetError(t('auth.enterEmailFirst')); return }
    setResetBusy(true); setResetError('')
    try {
      await sendPasswordResetEmail(auth, target)
      setResetDone(true)
    } catch (err: any) {
      const code = err?.code || ''
      setResetError(
        code === 'auth/invalid-email' ? t('auth.resetInvalidEmail')
        : code === 'auth/user-not-found' ? t('auth.resetNoAccount')
        : code === 'auth/too-many-requests' ? t('auth.resetTooMany')
        : err?.message?.replace('Firebase: ', '') || t('auth.somethingWrong')
      )
    } finally { setResetBusy(false) }
  }

  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [churches, setChurches] = useState<{ id: string; name: string }[]>([])

  // Church-only
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)

  const inputClass = "w-full px-4 py-3.5 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 focus:border-affirm-400/60 text-[15px]"
  const selectClass = inputClass + " appearance-none"

  // Birthday pickers. Three plain selects (day / month / year) instead of a
  // single native date field: on the low-end Android phones most members use,
  // the date popup is fiddly and only reaches back a few years by default, so
  // people couldn't get to their birth year at all. Selects are typeable,
  // never locale-ambiguous (no DD/MM vs MM/DD), and everyone understands them.
  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language || 'fr', { month: 'long' })
    return Array.from({ length: 12 }, (_, i) => {
      const label = fmt.format(new Date(2000, i, 1))
      return { value: String(i + 1), label: label.charAt(0).toUpperCase() + label.slice(1) }
    })
  }, [language])
  const dobYears = useMemo(() => {
    const max = new Date().getFullYear() - 13   // 13+ rule, matches the check below
    const years: number[] = []
    for (let y = max; y >= 1900; y--) years.push(y)
    return years
  }, [])
  const dobDays = useMemo(() => Array.from({ length: 31 }, (_, i) => i + 1), [])

  // French display name for the full country list. The device country is used
  // as the default, but people still need to recognise their own country in
  // the list rather than hunting for an English name.
  const countryLabel = (name: string) => (language === 'fr' || !language)
    ? (FR_COUNTRY[name] || name) : name
  const countryOptions = useMemo(() => {
    return [...COUNTRIES]
      .map(name => ({ value: name, label: countryLabel(name) }))
      .sort((a, b) => a.label.localeCompare(b.label, language || 'fr'))
  }, [language])
  // Profession / interest labels: French list is the stored value, English
  // labels shown only when the UI language is English.
  const isEn = language === 'en'
  const professionLabel = (p: string) => isEn ? (EN_PROFESSION[p] || p) : p
  const interestLabel = (i: string) => isEn ? (EN_INTEREST[i] || i) : i

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

  // The dial code always follows the selected country — the member never picks
  // it by hand. (dialFor falls back to the device default for the rare country
  // with no code in the map.)
  useEffect(() => {
    setCountryCode(dialFor(signupCountry, localeDefault.code))
  }, [signupCountry, localeDefault.code])

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

    if (mode === 'register') {
      // Belt and braces: the date input's max attribute already blocks this,
      // but a typed-in date bypasses the picker entirely.
      if (!dateOfBirth || ageFrom(dateOfBirth) < 13) { setError(t('auth.tooYoung')); return }
      if (!gender) { setError(t('auth.genderRequired')); return }
      // Chips can't carry the browser's `required`, so this is checked here
      // for the same reason gender is.
      if (interests.length === 0) { setError(t('auth.interestsRequired')); return }
    }

    if (mode === 'register' && sanitizeDigits(phone) !== sanitizeDigits(confirmPhone)) {
      setError(t('auth.phonesDontMatch')); return
    }

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
        // Collected identically for both account types, so it lives in one
        // place rather than being duplicated into each branch below.
        const commonProfile = {
          country: signupCountry,
          city: signupCity.trim(),
          quartier: quartier.trim(),
          dateOfBirth,
          gender: gender as 'homme' | 'femme',
          profession,
          ...(interests.length > 0 ? { interests } : {})
        }
        if (accountType === 'member') {
          const authEmail = memberAuthEmail(countryCode, phone)
          // The SMS step already signed them in as a phone-auth user. Linking
          // the email/PIN credential onto THAT account (rather than creating a
          // second one) is what lets the existing phone+PIN sign-in keep
          // working while the number is genuinely verified.
          const current = auth.currentUser
          const cred = current
            ? await linkWithCredential(current, EmailAuthProvider.credential(authEmail, pin))
            : await createUserWithEmailAndPassword(auth, authEmail, pin)
          await updateProfile(cred.user, { displayName: fullName })
          const profile: AppUser = {
            uid: cred.user.uid,
            email: authEmail,
            displayName: fullName,
            firstName, lastName,
            role: 'member',
            phone: `${countryCode} ${phone.trim()}`,
            createdAt: serverTimestamp(),
            ...commonProfile,
            memberChurchName: CHURCH_NAME
          }
          await setDoc(doc(db, 'users', cred.user.uid), profile)
          // Must log before signOut - the rules require request.auth.uid to
          // match the entry's userId, which is only true while signed in.
          logActivity(profile, 'signup', 'Member')
          await signOut(auth)
          setMode('login')
          setPin(''); setConfirmPin('')
          setRegisterSuccess(true)
        } else {
          const current = auth.currentUser
          const cred = current
            ? await linkWithCredential(current, EmailAuthProvider.credential(email, password))
            : await createUserWithEmailAndPassword(auth, email, password)
          await updateProfile(cred.user, { displayName: fullName })
          sendEmailVerification(cred.user).catch(() => {})
          const profile: AppUser = {
            uid: cred.user.uid,
            email,
            displayName: fullName,
            firstName, lastName,
            role: 'pending_church',
            phone: `${countryCode} ${phone.trim()}`,
            churchName: CHURCH_NAME,
            ...commonProfile,
            createdAt: serverTimestamp()
          }
          await setDoc(doc(db, 'users', cred.user.uid), profile)
          logActivity(profile, 'signup', 'Lead')
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

  return (
    <div>
      <div className="flex seg-track rounded-2xl p-1 mb-5">
        <button onClick={() => switchMode('login')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'login' ? 'seg-item-active' : 'seg-item'}`}>
          {t('auth.signIn')}
        </button>
        <button onClick={() => switchMode('register')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'register' ? 'seg-item-active' : 'seg-item'}`}>
          {t('auth.createAccount')}
        </button>
      </div>

      <p className="text-xs font-semibold field-label mb-2 px-1">{t('auth.iAmA')}</p>
      <div className="flex gap-3 mb-6">
        <button onClick={() => { setAccountType('member'); setError('') }}
          className={`flex-1 py-3 rounded-2xl text-sm font-medium transition ${
            accountType === 'member' ? 'opt-btn-active' : 'opt-btn'}`}>
          {t('auth.memberSignIn')}
        </button>
        <button onClick={() => { setAccountType('church'); setError('') }}
          className={`flex-1 py-3 rounded-2xl text-sm font-medium transition ${
            accountType === 'church' ? 'opt-btn-active' : 'opt-btn'}`}>
          {t('auth.churchSignIn')}
        </button>
      </div>

      {registerSuccess && (
        <p className="mb-4 text-sm text-affirm-700 bg-affirm-500/10 border border-affirm-500/20 rounded-xl px-4 py-3">
          {t('auth.accountCreated')}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <p className="text-[11px] field-hint px-1 -mb-1">{t('auth.allRequired')}</p>
        )}

        {mode === 'register' && (
          <div className="flex gap-3">
            <input required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t('auth.firstName')}
              className={inputClass} />
            <input required value={lastName} onChange={e => setLastName(e.target.value)} placeholder={t('auth.lastName')}
              className={inputClass} />
          </div>
        )}

        {mode === 'register' && (
          <>
            <div>
              <label className="text-xs font-semibold field-label px-1 mb-1.5 block">
                {t('auth.dateOfBirth')} <span className="text-affirm-400">*</span>
              </label>
              {/* Day / Month / Year — see monthNames/dobYears above for why. */}
              <div className="flex gap-2">
                <select required aria-label={t('auth.dobDay')} value={dobDay}
                  onChange={e => setDobDay(e.target.value)}
                  className={selectClass + " flex-[0_0_28%]"}>
                  <option value="" disabled>{t('auth.dobDay')}</option>
                  {dobDays.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select required aria-label={t('auth.dobMonth')} value={dobMonth}
                  onChange={e => setDobMonth(e.target.value)}
                  className={selectClass + " flex-1"}>
                  <option value="" disabled>{t('auth.dobMonth')}</option>
                  {monthNames.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select required aria-label={t('auth.dobYear')} value={dobYear}
                  onChange={e => setDobYear(e.target.value)}
                  className={selectClass + " flex-[0_0_28%]"}>
                  <option value="" disabled>{t('auth.dobYear')}</option>
                  {dobYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <p className="text-[11px] field-hint mt-1.5 px-1 leading-relaxed">
                {t('auth.ageNotice')}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold field-label px-1 mb-1.5 block">
                {t('auth.gender')} <span className="text-affirm-400">*</span>
              </label>
              <div className="flex gap-3">
                {(['homme', 'femme'] as const).map(g => (
                  <button key={g} type="button" onClick={() => setGender(g)}
                    className={`flex-1 py-3 rounded-2xl text-sm font-medium transition ${
                      gender === g ? 'opt-btn-active' : 'opt-btn'}`}>
                    {t(g === 'homme' ? 'auth.male' : 'auth.female')}
                  </button>
                ))}
              </div>
            </div>

            <select required value={profession} onChange={e => setProfession(e.target.value)} className={selectClass}>
              <option value="" disabled>{t('auth.selectProfession')}</option>
              {PROFESSIONS.map(p => <option key={p} value={p}>{professionLabel(p)}</option>)}
            </select>

            <CountryCombobox value={signupCountry} onChange={setSignupCountry}
              options={countryOptions} placeholder={t('auth.countrySearch')}
              className={inputClass} noMatch={t('auth.countryNoMatch')} />

            <div className="flex gap-3">
              <input required value={signupCity} onChange={e => setSignupCity(e.target.value)}
                placeholder={t('auth.city')} className={inputClass} />
              <input required value={quartier} onChange={e => setQuartier(e.target.value)}
                placeholder={t('auth.quartier')} className={inputClass} />
            </div>

            <div>
              <label className="text-xs font-semibold field-label px-1 mb-1.5 block">
                {t('auth.interests')} <span className="text-affirm-400">*</span>
              </label>
              {/* Multi-select as chips rather than a <select multiple>, which is
                  close to unusable on a phone. */}
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map(item => {
                  const on = interests.includes(item)
                  return (
                    <button key={item} type="button"
                      onClick={() => setInterests(prev =>
                        on ? prev.filter(i => i !== item) : [...prev, item])}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                        on ? 'chip-btn-active' : 'chip-btn'}`}>
                      {interestLabel(item)}
                    </button>
                  )
                })}
              </div>
              <p className={`text-[11px] mt-2 px-1 ${
                interests.length === 0 ? 'text-amber-600' : 'field-hint'}`}>
                {interests.length === 0 ? t('auth.interestsRequired') : t('auth.interestsHint')}
              </p>
            </div>
          </>
        )}



        {(accountType === 'member' || mode === 'register') && (
          <div className="space-y-2">
            {mode === 'register' && (
              <label className="text-xs font-semibold field-label px-1 block">
                {t('auth.phoneLabel')}
              </label>
            )}
            {/* At login the profile country field isn't shown, so the member
                picks their country here to set the dial code. At register the
                country chosen above already drives it — no code picker at all. */}
            {mode === 'login' && accountType === 'member' && (
              <CountryCombobox value={signupCountry} onChange={setSignupCountry}
                options={countryOptions} placeholder={t('auth.countrySearch')}
                className={inputClass} noMatch={t('auth.countryNoMatch')} />
            )}
            {/* National number only — the derived code shows as a fixed badge
                so people don't retype it. If they paste a full +226… number
                anyway, stripDialCode drops the code for them. */}
            <div className="flex gap-2">
              <span className="code-badge shrink-0 flex items-center px-3 rounded-2xl font-medium text-[15px]">
                {countryCode}
              </span>
              <input required type="tel" inputMode="tel" value={phone}
                onChange={e => setPhone(stripDialCode(e.target.value, countryCode))}
                placeholder={t('auth.phoneNumber')} className={inputClass} />
            </div>

            {mode === 'register' && (
              <>
                {/* Typed twice on purpose, and paste is blocked. For a member
                    the phone number IS the login, so one typo locks them out of
                    the account they just made with no email to recover it. */}
                <div className="flex gap-2">
                  <span className="code-badge shrink-0 flex items-center px-3 rounded-2xl font-medium text-[15px]">
                    {countryCode}
                  </span>
                  <input required type="tel" inputMode="tel" value={confirmPhone}
                    onChange={e => setConfirmPhone(stripDialCode(e.target.value, countryCode))}
                    onPaste={e => e.preventDefault()}
                    placeholder={t('auth.confirmPhone')}
                    className={inputClass} />
                </div>
                {confirmPhone.trim() !== '' && sanitizeDigits(phone) !== sanitizeDigits(confirmPhone) && (
                  <p className="text-[11px] text-amber-600 px-1">{t('auth.phonesDontMatch')}</p>
                )}
              </>
            )}
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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
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
            <button type="button" onClick={openReset}
              className="text-xs font-semibold text-affirm-600 hover:text-affirm-700">
              {t('auth.forgotPassword')}
            </button>
          </div>
        )}

        {resetSent && (
          <p className="text-sm text-affirm-700 bg-affirm-500/10 border border-affirm-500/20 rounded-xl px-4 py-3">
            {t('auth.resetSent')}
          </p>
        )}
        {error && <p className="text-sm text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full py-4 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-[15px] transition flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-affirm-500/20">
          {loading ? t('auth.pleaseWait') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      {mode === 'register' && accountType === 'church' && (
        <p className="mt-5 text-xs text-center text-slate-500 leading-relaxed">
          {t('auth.churchApprovalNote')}
        </p>
      )}

      {showReset && (
        <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d1424] w-full max-w-sm rounded-3xl border border-white/10 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-bold text-white">{t('auth.resetTitle')}</h2>
              <button onClick={() => setShowReset(false)}
                className="p-1 -mr-1 rounded-full hover:bg-white/5 text-slate-400 shrink-0">
                <X size={18} />
              </button>
            </div>

            {resetDone ? (
              <>
                <div className="mt-4 flex items-start gap-2.5 bg-affirm-500/10 border border-affirm-500/20 rounded-2xl p-4">
                  <CheckCircle2 size={17} className="text-affirm-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-affirm-700 leading-relaxed">{t('auth.resetSent')}</p>
                    <p className="text-[11px] text-slate-400 mt-1.5 break-words">{resetEmail.trim()}</p>
                  </div>
                </div>
                {/* Firebase sends from a no-reply address, which very often
                    lands in spam. Saying so up front saves the "nothing
                    arrived" round trip. */}
                <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{t('auth.resetSpamHint')}</p>
                <button onClick={() => setShowReset(false)}
                  className="mt-5 w-full py-3 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-sm transition">
                  {t('auth.resetClose')}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{t('auth.resetIntro')}</p>

                <input type="email" value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitReset() }}
                  placeholder={t('auth.email')}
                  autoFocus
                  className="w-full mt-4 px-4 py-3.5 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />

                {resetError && (
                  <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 break-words">
                    {resetError}
                  </p>
                )}

                <button onClick={submitReset} disabled={resetBusy || !resetEmail.trim()}
                  className="mt-4 w-full py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 disabled:opacity-40 text-white font-semibold text-sm transition">
                  {resetBusy ? t('auth.resetSending') : t('auth.resetSend')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== AUTH SCREENS ====================
// Full-screen version — shown on phone & tablet (the "app style" experience).
// "Get it on Google Play" button. Shown on the web welcome/landing pages only -
// never inside the native app, where downloading the app makes no sense.
function GooglePlayBadge({ className = '' }: { className?: string }) {
  const { t } = useLanguage()
  if (Capacitor.isNativePlatform()) return null
  return (
    <a href="https://play.google.com/store/apps/details?id=com.elim.app"
      target="_blank" rel="noopener noreferrer"
      aria-label={t('landing.downloadApp')}
      className={`inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white shadow-lg transition ${className}`}>
      <Play size={22} fill="currentColor" className="shrink-0" />
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-wide opacity-80">{t('landing.getItOn')}</span>
        <span className="block text-base font-bold -mt-0.5">Google Play</span>
      </span>
    </a>
  )
}

function AuthScreen({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  const { t } = useLanguage()
  const [showWelcome, setShowWelcome] = useState(true)
  // Which tab the auth form opens on. A first-time visitor should land on
  // "Create account", not on a phone+PIN login for an account they don't
  // have yet, so the welcome screen sets this explicitly.
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const openAuth = (m: 'login' | 'register') => { setAuthMode(m); setShowWelcome(false) }

  return (
    <div className="min-h-screen heavenly-bg flex flex-col relative overflow-hidden">
      <StarField />
      <div className="relative flex justify-end px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}>
        <LanguageSwitcher />
      </div>

      {showWelcome ? (
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-md text-center">
            <Logo size={110} variant="full" />
            <h1 translate="no" className="notranslate mt-8 text-3xl font-bold text-white tracking-tight drop-shadow-[0_2px_10px_rgba(124,45,18,0.4)]">ELIM</h1>
            <p className="mt-2 text-[13px] text-white/90 font-medium leading-relaxed px-4">
              Centre Chrétien d'Enseignement, de Libéralité,<br />d'Intercession et de Moisson
            </p>
            <p className="mt-4 text-white/75 leading-relaxed">{t('auth.peacefulPlace')}</p>

            {/* The two actions come first, above the feature preview, so the
                way in is never below the fold. Creating an account is the
                dominant, primary button; signing in is the quieter option for
                people who already have one. */}
            <div className="mt-8 space-y-3">
              <button onClick={() => openAuth('register')}
                className="w-full py-4 rounded-2xl bg-white hover:bg-white/95 text-affirm-700 font-bold text-[15px] transition flex items-center justify-center gap-2 shadow-xl shadow-orange-900/20">
                {t('auth.createAccount')} <ArrowRight size={18} />
              </button>
              <button onClick={() => openAuth('login')}
                className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold text-[15px] transition">
                {t('landing.haveAccount')}
              </button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              {[
                { icon: ImageIcon, label: t('landing.valueProp.photos') },
                { icon: Mic, label: t('landing.valueProp.audio') },
                { icon: Video, label: t('landing.valueProp.video') },
                { icon: ShieldCheck, label: t('landing.valueProp.verified') },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-2 py-4 rounded-2xl glass">
                  <div className="w-10 h-10 rounded-xl bg-affirm-500/10 flex items-center justify-center text-affirm-400">
                    <item.icon size={18} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 text-center px-1">{item.label}</span>
                </div>
              ))}
            </div>

            {!Capacitor.isNativePlatform() && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="text-white/70 text-xs">{t('landing.downloadHint')}</p>
                <GooglePlayBadge />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <AuthBanner subtitle="Centre Chrétien E.L.I.M." />
            <div className="glass rounded-3xl shadow-2xl p-8">
              <AuthForm onSuccess={onSuccess} initialMode={authMode} />
            </div>
          </div>
        </div>
      )}

      <div className="relative pb-6 px-6 text-center flex flex-col items-center gap-3">
        {/* Reachable BEFORE sign-in, so anyone stuck at login can message the
            technical team by email. */}
        <a href={`mailto:hello@kaj-consulting.com?subject=${encodeURIComponent('ELIM — Support technique')}&body=${encodeURIComponent('\n\n(Décrivez votre problème ici / Describe your problem here)')}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/12 hover:bg-white/20 border border-white/25 text-white text-sm font-semibold transition">
          <Mail size={15} /> {t('landing.contactSupport')}
        </a>
        <p className="text-[11px] text-white/70">{COPYRIGHT}</p>
      </div>
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
      <div className="glass-bar w-full max-w-md rounded-3xl shadow-2xl p-8 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-white/5 text-slate-400">
          <X size={20} />
        </button>
        <div className="flex justify-center mb-2">
          <LanguageSwitcher />
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
              className="px-5 py-2.5 rounded-full text-sm font-semibold bg-affirm-600 hover:bg-affirm-700 text-white transition shadow-lg shadow-affirm-200">
              {t('landing.getStarted')}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 heavenly-bg" />
        <div className="absolute -top-20 left-1/4 w-[500px] h-[500px] bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-10 right-1/4 w-[400px] h-[400px] bg-affirm-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 left-1/3 w-[350px] h-[350px] bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-8 pt-20 pb-28 text-center">
          <Logo size={128} variant="full" />
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 border border-affirm-100 text-xs font-semibold text-affirm-700 tracking-wide mt-8 mb-8">
            <Sparkles size={14} /> {t('landing.badge')}
          </div>
          <h1 className="text-5xl lg:text-6xl xl:text-7xl font-extrabold text-slate-900 tracking-tight leading-[1.05]">
            {t('landing.heroLine1')}<br />
            <span className="bg-gradient-to-r from-affirm-600 via-affirm-500 to-amber-500 bg-clip-text text-transparent">
              {t('landing.heroLine2')}
            </span>
          </h1>
          <p className="mt-8 text-lg xl:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            {t('landing.heroSubtitle')}
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <button onClick={() => setAuthMode('register')}
              className="px-8 py-4 rounded-full bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-[15px] transition shadow-xl shadow-affirm-200 flex items-center gap-2">
              {t('landing.getStarted')} <ArrowRight size={18} />
            </button>
            <button onClick={() => setAuthMode('login')}
              className="px-8 py-4 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[15px] transition">
              {t('auth.signIn')}
            </button>
          </div>
          {!Capacitor.isNativePlatform() && (
            <div className="mt-8 flex flex-col items-center gap-2.5">
              <p className="text-slate-500 text-sm">{t('landing.downloadHint')}</p>
              <GooglePlayBadge />
            </div>
          )}
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
              <div className="w-11 h-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-affirm-600 shadow-sm">
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
          <div className="rounded-3xl p-8 bg-gradient-to-br from-affirm-50 to-white border border-affirm-100">
            <div className="w-12 h-12 rounded-2xl bg-affirm-600 text-white flex items-center justify-center mb-6 shadow-lg shadow-affirm-200">
              <Church size={22} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">{t('landing.forChurches')}</h3>
            <ul className="space-y-3 text-slate-500 text-[15px]">
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-affirm-500 shrink-0 mt-0.5" /> {t('landing.forChurches.1')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-affirm-500 shrink-0 mt-0.5" /> {t('landing.forChurches.2')}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-affirm-500 shrink-0 mt-0.5" /> {t('landing.forChurches.3')}</li>
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
            <p className="text-xs font-bold tracking-widest text-affirm-600 mb-3">{t('landing.gettingStarted')}</p>
            <h2 className="text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight">{t('landing.threeSteps')}</h2>
          </div>
          <div className="grid grid-cols-3 gap-8">
            {[
              { n: '1', title: t('landing.step1.title'), desc: t('landing.step1.desc'), color: 'border-affirm-500 text-affirm-600' },
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
          <span className="bg-gradient-to-r from-affirm-600 to-amber-500 bg-clip-text text-transparent">{t('landing.finalCta2')}</span>
        </h2>
        <button onClick={() => setAuthMode('register')}
          className="mt-4 px-10 py-4 rounded-full bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-base transition shadow-xl shadow-affirm-200 inline-flex items-center gap-2">
          {t('landing.getStartedFree')} <ArrowRight size={18} />
        </button>
      </section>

      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between gap-4">
            <Logo size={26} />
            <p className="text-sm text-slate-400">{t('landing.footerTagline')}</p>
          </div>
          <div className="mt-6 pt-6 border-t border-slate-50 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">{COPYRIGHT}</p>
            <div className="flex items-center gap-4">
              <a href="/child-safety.html" className="text-xs text-slate-400 hover:text-affirm-600 underline mr-3">
                {t('footer.childSafety')}
              </a>
              <a href="/privacy.html" className="text-xs text-slate-400 hover:text-affirm-600 underline">
                {t('footer.privacy')}
              </a>
              <a href="mailto:hello@kaj-consulting.com?subject=ELIM%20App%20Support"
                className="text-xs text-slate-400 hover:text-affirm-600 underline">
                {t('support.title')}
              </a>
            </div>
          </div>
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
  // Persisted in sessionStorage so a pull-to-refresh reload returns to the same
  // tab instead of jumping back to the feed.
  const [activeTab, setActiveTab] = useState(() => storageGet('elim_activeTab', true) || 'feed')
  useEffect(() => { storageSet('elim_activeTab', activeTab, true) }, [activeTab])
  // When a support button deep-links into a messaging channel, this tells the
  // Messages tab which channel to open on arrival (cleared once consumed).
  const [msgChannel, setMsgChannel] = useState<'tech' | 'pastor' | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  // undefined = loading, null = not managed (grandfathered), object = enforced caps
  const [myGroupCaps, setMyGroupCaps] = useState<Partial<Record<'post' | 'sante' | 'books' | 'transcribe', boolean>> | null | undefined>(undefined)
  const [comments, setComments] = useState<Comment[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [activeCommentsPost, setActiveCommentsPost] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingChurches, setPendingChurches] = useState<AppUser[]>([])
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set())
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  // Broadcast announcements (shared docs) + the ids this device has already
  // seen. Read state is per-device (localStorage), since announcements are one
  // shared doc for everyone rather than a per-user record we could flag read.
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [seenAnnounceIds, setSeenAnnounceIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(storageGet('elim_seen_announce') || '[]')) } catch { return new Set() }
  })
  // Announcements a user chose to remove from their own bell. Shared docs can't
  // be deleted per-user server-side, so this is a per-device hide list.
  const [dismissedAnnounceIds, setDismissedAnnounceIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(storageGet('elim_dismissed_announce') || '[]')) } catch { return new Set() }
  })
  const dismissAnnouncement = (id: string) => {
    setDismissedAnnounceIds(prev => {
      const next = new Set(prev); next.add(id)
      try { storageSet('elim_dismissed_announce', JSON.stringify([...next].slice(-200))) } catch { /* storage blocked */ }
      return next
    })
  }
  // Authoritative "already seen" marker: the last time this account opened the
  // bell, persisted per uid in localStorage. Anything older is treated as seen,
  // so a notification/announcement that was already seen never comes back as
  // "new" after a reload or re-login — even if the per-doc read write didn't
  // land (offline) or the WebView dropped its storage between sessions. Keyed
  // by uid so a different account on the same device starts fresh.
  const [notifSeenAt, setNotifSeenAt] = useState<number>(0)
  useEffect(() => {
    if (!user?.uid) return
    const key = 'elim_notifSeen_' + user.uid
    const v = storageGet(key)
    const parsed = v ? parseInt(v, 10) : NaN
    if (Number.isFinite(parsed)) { setNotifSeenAt(parsed); return }
    const now = Date.now()   // first time for this account: don't flag the back catalogue
    setNotifSeenAt(now)
    storageSet(key, String(now))
  }, [user?.uid])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showQuiz, setShowQuiz] = useState(false)
  // When set, the tap-to-view profile popup is open for this member's uid.
  const [profileUid, setProfileUid] = useState<string | null>(null)
  // When set, the tap-to-view GROUP popup is open for this group's id.
  const [groupPopupId, setGroupPopupId] = useState<string | null>(null)
  // Red dot on the Game button while today's daily challenge is unplayed.
  const [quizDailyPending, setQuizDailyPending] = useState(false)
  // Set to the store URL when a newer app version is available (native only).
  const [updateUrl, setUpdateUrl] = useState<string | null>(null)
  const [donation, setDonation] = useState<DonationConfig | null>(null)
  const [showDonation, setShowDonation] = useState(false)
  const [seenNewPosts, setSeenNewPosts] = useState<Post[]>([])
  // "New posts since you last looked" is derived from this timestamp rather
  // than stored server-side, so a new post costs zero writes. Per-device via
  // localStorage; defaults to now so a first-time user isn't shown the entire
  // back catalogue as "new".
  const [lastSeenFeed, setLastSeenFeed] = useState<number>(() => {
    // Via storageGet: a bare read here throws SecurityError when the browser
    // blocks site data, and a throw in a useState initializer kills the whole
    // app at boot rather than just losing this one preference.
    const v = storageGet('elim_lastSeenFeed')
    const parsed = v ? parseInt(v, 10) : NaN
    return Number.isFinite(parsed) ? parsed : Date.now()
  })
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null)
  const [santeCategory, setSanteCategory] = useState('all')
  const [showCreateSante, setShowCreateSante] = useState(false)
  const [musiqueCategory, setMusiqueCategory] = useState('all')
  const [musiqueSearch, setMusiqueSearch] = useState('')
  const [showCreateMusique, setShowCreateMusique] = useState(false)
  const [showBulkMusique, setShowBulkMusique] = useState(false)
  const [adminSection, setAdminSection] = useState<'approvals' | 'groups' | 'passwords' | 'reports' | 'broadcast' | 'dons' | 'logs' | 'data' | 'quizsounds'>(
    user?.role === 'church' ? 'data' : 'approvals'
  )
  // user is null at mount, so the initializer above always resolves to
  // 'approvals'. A church lead only has the "Données" section, so once their
  // profile loads move them onto it - otherwise their Admin panel is blank
  // until they tap the chip.
  useEffect(() => {
    if (user?.role === 'church') setAdminSection('data')
  }, [user?.role])
  const { track: playerTrack } = useMediaPlayer()
  const unreadMessages = useUnreadCount(user as AppUser)
  const [messageToast, setMessageToast] = useState(false)
  const prevUnread = useRef<number | null>(null)
  const likeInFlight = useRef<Set<string>>(new Set())
  const commentLikeInFlight = useRef<Set<string>>(new Set())

  // Alert only when the count RISES. Firing on any change would sound again
  // every time someone reads a thread and the number drops.
  useEffect(() => {
    const previous = prevUnread.current
    prevUnread.current = unreadMessages
    // The first value after mount is the existing backlog, not new arrivals.
    if (previous === null) return
    if (unreadMessages <= previous) return

    if (!isAlertMuted()) playMessageAlert()
    // No banner while the person is already looking at Messages - they can
    // see it arrive.
    if (activeTab !== 'messages') {
      setMessageToast(true)
      setTimeout(() => setMessageToast(false), 5000)
    }
  }, [unreadMessages, activeTab])
  // Skip the animated splash when this load is a pull-to-refresh reload (a flag
  // set just before reload), so refreshing doesn't replay the splash each time.
  const [splashDone, setSplashDone] = useState(() => {
    try {
      if (sessionStorage.getItem('elim-skip-splash')) { sessionStorage.removeItem('elim-skip-splash'); return true }
    } catch { /* storage blocked: fall back to showing the splash */ }
    return false
  })
  const [feedFilter, setFeedFilter] = useState<'all' | 'video' | 'audio' | 'posts'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Keep the native system bars in step with the phone's own light/dark
  // setting, the same signal the CSS theme follows. Without this the status
  // bar would stay a light strip with dark icons while the app itself goes
  // dark. Re-applied whenever the system flips, so turning on dark/bedtime
  // mode changes the bars live rather than only on next launch.
  // Native-only: these APIs don't exist on web, where the browser's own
  // chrome is what's visible instead of a device status bar.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      // SystemBarsStyle.Dark means light icons (for a dark background) and
      // .Light means dark icons - named for the content, not the backdrop.
      SystemBars.setStyle({ style: mq.matches ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {})
      EdgeToEdge.setBackgroundColor({ color: mq.matches ? '#14110e' : '#fff2e0' }).catch(() => {})
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    // Web only (no-ops on native) - lets an already-open browser tab show a
    // notification for a new post without needing to reload.
    listenForForegroundMessages()
    // Native only - creates the Android notification channel (required on
    // Android 8+) and handles foreground pushes, which FCM won't display.
    initNativeNotifications()

    // A tapped notification should land on what it was about.
    const off = onNotificationRoute(route => {
      if (route.kind === 'quiz') {
        setShowQuiz(true)
      } else if (route.kind === 'message') {
        setActiveTab('messages')
      } else if (route.kind === 'feed') {
        setActiveTab('feed')
      } else if (route.kind === 'url') {
        if (route.url && /^https?:\/\//i.test(route.url)) window.open(route.url, '_blank', 'noopener,noreferrer')
      } else {
        setActiveTab('feed')
        if (route.postId) {
          setHighlightPostId(route.postId)
          // Clear the highlight after a moment so it reads as "here it is"
          // rather than leaving a post permanently marked.
          setTimeout(() => setHighlightPostId(null), 4000)
        }
      }
    })
    // Web: read any target off the launch URL the service worker opened.
    consumeLaunchUrlRoute()
    // Hardware/browser back closes what's open instead of leaving the app.
    initBackButton()
    return () => off()
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
      // Notifications are meant to be ON for everyone. If they aren't actually
      // enabled (OS permission not granted), nudge on EVERY app open - not just
      // once - so the reminder keeps coming back until the person allows them.
      if (!actuallyEnabled) {
        const perm = await checkNotificationPermission()
        if (!cancelled && perm !== 'granted') {
          setShowNotifPrompt(true)
        }
      }
    })()
    // Re-check whenever the app regains focus: someone can revoke or grant
    // notification permission in system settings while the app sits in the
    // background, and nothing tells the app that happened.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && user) {
        reconcileNotificationState(user.uid, !!user.notificationsEnabled)
          .then(actual => setUser(prev => prev && prev.notificationsEnabled !== actual
            ? { ...prev, notificationsEnabled: actual } : prev))
          .catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [user?.uid])

  // Bible quiz: light up the Game button while today's daily challenge is
  // still unplayed (mirrors the dot the daily-reminder push nudges toward).
  useEffect(() => {
    if (!user) return
    const unsub = subscribeQuizProfile(user.uid, user.displayName, user.avatar, p => {
      setQuizDailyPending(p.lastDailyDate !== quizTodayKey())
    }, () => {})
    return unsub
  }, [user?.uid])

  // App-update prompt (native only). A single config doc, config/app, holds the
  // latest PUBLISHED build, set explicitly by an admin (Admin -> the "Published
  // version" control) when they release to the store. We no longer bump it
  // automatically from whichever staff device opens a newer build: a staffer
  // side-loading an internal-testing APK would otherwise nag the whole
  // congregation to "update" to a build the store doesn't yet offer.
  useEffect(() => {
    if (!user || !Capacitor.isNativePlatform()) return
    let cancelled = false
    let myBuild = 0
    const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app'
    const unsub = onSnapshot(doc(db, 'config', 'app'), async snap => {
      try {
        if (myBuild === 0) {
          const info = await CapApp.getInfo()
          myBuild = parseInt(String(info.build || '0'), 10) || 0
        }
      } catch { myBuild = 0 }
      if (cancelled) return
      const data = snap.exists() ? snap.data() : null
      const latest = Number(data?.latestBuild || 0)
      const url = (data?.updateUrl && String(data.updateUrl)) || PLAY_URL
      // Older than what's published -> offer the update.
      setUpdateUrl(myBuild > 0 && latest > myBuild ? url : null)
    }, () => {})
    return () => { cancelled = true; unsub() }
  }, [user?.uid, user?.role])

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) { setUser(null); return }
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        // Guard against a sign-out (or account switch) that lands while this
        // profile read is still in flight: if the current user is no longer
        // the one we fetched for, drop the stale result rather than
        // resurrecting a signed-out session.
        if (auth.currentUser?.uid !== firebaseUser.uid) return
        setUser(snap.exists() ? (snap.data() as AppUser) : null)
      } catch {
        // A failed profile read (offline launch, expired token, transient
        // Firestore error) must never leave the app stuck on the splash
        // spinner. Fall back to signed-out and let the person retry.
        setUser(null)
      } finally {
        setAuthLoading(false)
      }
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
    }, () => {
      // A listener error (rules/index/offline) must still clear the spinner,
      // otherwise the feed hangs on "Loading…" forever with no way out.
      setLoading(false)
    })
    return unsub
  }, [user?.uid, user?.role])

  // Publishing groups (ministries/departments). Small collection, world-
  // readable; needed by the composer (a lead's "my groups") and the admin panel.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    return subscribeGroups(setGroups, () => setGroups([]))
  }, [user?.uid, user?.role])

  // The account's own group capabilities, stamped by the syncGroupCaps function.
  // Live-subscribed so a permission change reaches the lead quickly. `undefined`
  // = still loading, `null` = never placed in a group (grandfathered = full
  // publishing rights, mirroring the server), an object = enforced caps.
  useEffect(() => {
    if (!user || user.role === 'pending_church') { setMyGroupCaps(undefined); return }
    return onSnapshot(doc(db, 'users', user.uid), snap => {
      const d = snap.exists() ? (snap.data() as any) : null
      setMyGroupCaps(d && 'groupCaps' in d ? (d.groupCaps || {}) : null)
    }, () => setMyGroupCaps(null))
  }, [user?.uid, user?.role])

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
    }, () => { /* offline/rules: keep whatever we have rather than crash */ })
    return unsub
  }, [user?.uid, user?.role])

  // The current user's comment likes — same one-doc-per-user pattern as post
  // likes, so we can show which comments this person has already liked.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'commentLikes'), where('userId', '==', user.uid))
    const unsub = onSnapshot(q, (snap) => {
      setLikedCommentIds(new Set(snap.docs.map(d => d.data().commentId as string)))
    }, () => { /* offline/rules: keep current state */ })
    return unsub
  }, [user?.uid, user?.role])

  // Bell notifications addressed to this user (likes/comments/replies on their
  // own posts and comments). Newest first, capped so the list stays bounded.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    )
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification)))
    }, () => { /* index still building or offline - the bell just stays empty */ })
    return unsub
  }, [user?.uid, user?.role])

  // Broadcast announcements shared with everyone (quiz reminders, champions,
  // app-update notices). Shown in the bell so a missed system push isn't lost.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(30))
    const unsub = onSnapshot(q, (snap) => {
      setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() } as Announcement)))
    }, () => { /* offline/rules - the bell just shows personal notifs */ })
    return unsub
  }, [user?.uid, user?.role])

  // Donation details (mobile-money numbers), maintained by an admin.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const unsub = onSnapshot(doc(db, 'config', 'donation'), (snap) => {
      setDonation(snap.exists() ? (snap.data() as DonationConfig) : { providers: [] })
    }, () => setDonation({ providers: [] }))
    return unsub
  }, [user?.uid, user?.role])

  // Admin-chosen quiz sounds → the feedback service (cached locally so they
  // apply instantly). config/quizSounds is written by the admin sound picker.
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const unsub = onSnapshot(doc(db, 'config', 'quizSounds'), (snap) => {
      if (snap.exists()) setEventSounds(snap.data() as Partial<Record<QuizEvent, string>>)
    }, () => { /* offline: cached map still applies */ })
    return unsub
  }, [user?.uid, user?.role])

  // Comments — only for the post whose sheet is open, not the whole app. The
  // old global listener streamed and held every comment on every post in memory
  // (unbounded). Sorted client-side to avoid needing a composite index.
  useEffect(() => {
    if (!user || user.role === 'pending_church' || !activeCommentsPost) { setComments([]); return }
    const q = query(collection(db, 'comments'), where('postId', '==', activeCommentsPost))
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment))
      rows.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      setComments(rows)
    }, () => setComments([]))
  }, [user?.uid, user?.role, activeCommentsPost])

  // Pending church signups (staff only - admins AND pastors, who both process
  // approvals and are both shown the Approvals section).
  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'pastor')) return
    const q = query(collection(db, 'users'), where('role', '==', 'pending_church'))
    const unsub = onSnapshot(q, (snap) => {
      setPendingChurches(snap.docs.map(d => ({ ...d.data() } as AppUser)))
    }, () => { /* offline/rules: leave the last known list rather than silently emptying */ })
    return unsub
  }, [user?.uid, user?.role])

  // Capabilities mirror the server's database-level enforcement exactly, so a
  // button never disagrees with what the rules will allow:
  //  - admins/pastors always have everything;
  //  - an account never placed in a group (myGroupCaps null/undefined) is
  //    grandfathered with full publishing rights (matches managedByGroups());
  //  - a managed account uses its stamped groupCaps (post/sante/books/transcribe).
  const caps = useMemo(() => {
    const staff = user?.role === 'admin' || user?.role === 'pastor'
    if (staff) return { post: true, sante: true, books: true, transcribe: true }
    // Only publisher accounts (church/admin/pastor) may publish at all — this
    // mirrors the server's canPublish(). A simple member is NEVER shown a
    // publishing surface, even if they were never placed in a group (the
    // grandfather clause below is for legacy publishers, not for members).
    if (user?.role !== 'church') return { post: false, sante: false, books: false, transcribe: false }
    // A church/lead account never placed in a group is grandfathered to full
    // rights (it predates the groups system); once assigned, its stamped caps
    // are what apply.
    if (myGroupCaps == null) return { post: true, sante: true, books: true, transcribe: true }
    return {
      post: !!myGroupCaps.post, sante: !!myGroupCaps.sante,
      books: !!myGroupCaps.books, transcribe: !!myGroupCaps.transcribe,
    }
  }, [user?.role, myGroupCaps])
  const canPost = caps.post
  // Groups this account may publish under: its own lead groups, plus every
  // group for staff (admins/pastors can post as any group). Drives the
  // composer's "publish under" picker.
  const myGroups = useMemo(() => {
    if (!user) return []
    const staff = user.role === 'admin' || user.role === 'pastor'
    return groups.filter(g => staff || !!g.leads[user.uid])
  }, [groups, user])

  const handleLogout = async () => {
    // Detach this device's push token BEFORE signing out (the write needs the
    // still-authenticated session), so the next person to log in on a shared
    // phone doesn't inherit this user's notifications.
    if (user) await cleanupPushForLogout(user.uid)
    await signOut(auth)
    setUser(null)
  }

  const handleDeletePost = async (id: string) => {
    const post = posts.find(p => p.id === id)
    await deleteDoc(doc(db, 'posts', id))
    // Reclaim any offline copy of this post's audio (best-effort).
    removeOffline(id).catch(() => {})
    // Remove the uploaded media so a deleted image/audio/video/PDF doesn't
    // linger in Storage forever (up to 200 MB for video). Best-effort: a
    // missing object or an external (YouTube/Facebook) link is simply skipped.
    for (const u of [post?.mediaUrl, post?.coverUrl]) {
      if (u && u.includes('firebasestorage')) {
        deleteObject(ref(storage, u)).catch(() => {})
      }
    }
    logActivity(user, 'post_deleted', post?.content?.slice(0, 80))
  }

  const handleEditPost = async (id: string, content: string) => {
    await updateDoc(doc(db, 'posts', id), { content })
    logActivity(user, 'post_edited', content.slice(0, 80))
  }

  const handleCreatePost = async (data: { type: Post['type']; content: string; mediaUrl?: string; coverUrl?: string; fileName?: string; section?: 'feed' | 'sante' | 'musique'; category?: string; groupId?: string }) => {
    let finalType = data.type
    // Only auto-detect YouTube/Facebook links when the user didn't explicitly pick
    // a distinct media type (audio/document posts can otherwise get silently reclassified).
    if (data.mediaUrl && !['audio', 'document'].includes(data.type)) {
      if (getYoutubeId(data.mediaUrl)) finalType = 'youtube'
      else if (isFacebookVideo(data.mediaUrl)) finalType = 'facebook'
    }
    // Attribute to a group only if the author actually leads it (or is staff);
    // a featured lead's own name shows big, everyone else shows group-first.
    const group = data.groupId ? groups.find(g => g.id === data.groupId) : undefined
    const canUseGroup = group && (group.leads[user!.uid] || user!.role === 'admin' || user!.role === 'pastor')
    const groupFields = canUseGroup
      ? {
          groupId: group!.id,
          groupName: group!.name,
          groupAvatar: group!.avatar || null,
          featured: !!group!.leads[user!.uid]?.featured,
          authorTitle: group!.leads[user!.uid]?.title || null,
        }
      : {}
    await addDoc(collection(db, 'posts'), {
      churchId: user!.uid,
      churchName: user!.churchName || CHURCH_NAME,
      authorId: user!.uid,
      authorName: user!.displayName,
      churchAvatar: user!.avatar || null,
      ...groupFields,
      type: finalType,
      content: data.content,
      mediaUrl: data.mediaUrl || null,
      coverUrl: data.coverUrl || null,
      fileName: data.fileName || null,
      likes: 0,
      commentsCount: 0,
      section: data.section || 'feed',
      ...(data.category ? { category: data.category } : {}),
      createdAt: serverTimestamp()
    })
    logActivity(user, 'post_created',
      `${data.section === 'sante' ? 'Santé' : 'Fil'} · ${finalType} - ${data.content.slice(0, 60)}`)
  }

  const handleAddComment = async (text: string, parentId?: string, mentions?: { uid: string; name: string }[]) => {
    if (!activeCommentsPost || !user) return
    // Commenting means they've seen the post — count the view too.
    recordPostView(activeCommentsPost, user.uid)
    // Write the comment and bump the post's counter atomically, so a failure
    // can't leave the count out of step with the actual comments.
    const tagged = (mentions || []).filter(m => m.uid && m.uid !== user.uid)
    const batch = writeBatch(db)
    batch.set(doc(collection(db, 'comments')), {
      postId: activeCommentsPost,
      userName: user.displayName,
      userId: user.uid,
      ...(user.avatar ? { userAvatar: user.avatar } : {}),
      ...(parentId ? { parentId } : {}),
      ...(tagged.length ? { mentions: tagged.map(m => m.uid), mentionNames: tagged.map(m => m.name) } : {}),
      text,
      likes: 0,
      createdAt: serverTimestamp()
    })
    batch.update(doc(db, 'posts', activeCommentsPost), { commentsCount: increment(1) })
    await batch.commit()
    const commented = posts.find(p => p.id === activeCommentsPost)
    logActivity(user, 'comment_added',
      `${commented?.churchName || ''}: "${text.slice(0, 60)}"`.trim())
  }

  const handleLikeComment = async (commentId: string) => {
    if (!user) return
    // Same in-flight guard and one-doc-per-user pattern as post likes.
    if (commentLikeInFlight.current.has(commentId)) return
    commentLikeInFlight.current.add(commentId)
    const likeDocId = `${commentId}_${user.uid}`
    const alreadyLiked = likedCommentIds.has(commentId)
    try {
      const batch = writeBatch(db)
      if (alreadyLiked) {
        batch.delete(doc(db, 'commentLikes', likeDocId))
        batch.update(doc(db, 'comments', commentId), { likes: increment(-1) })
      } else {
        batch.set(doc(db, 'commentLikes', likeDocId), {
          commentId, userId: user.uid, createdAt: serverTimestamp()
        })
        batch.update(doc(db, 'comments', commentId), { likes: increment(1) })
      }
      await batch.commit()
    } finally {
      commentLikeInFlight.current.delete(commentId)
    }
    // Errors propagate to the caller so the UI can revert its optimistic state
    // and show a message (e.g. if the commentLikes rules aren't deployed yet).
  }

  // Posts published since the user last opened the bell - excluding their own
  // and the hidden Musique imports. Derived, not stored (see lastSeenFeed).
  const toMs = (ts: any) => (ts?.toMillis ? ts.toMillis() : 0)
  const newPosts = posts.filter(p =>
    p.section !== 'musique' && p.churchId !== user?.uid && toMs(p.createdAt) > lastSeenFeed)
  // "New" also requires being newer than the last time the bell was opened, so
  // a seen item can't reappear after a reload/re-login if its read/seen write
  // didn't persist.
  const unreadNotifs = notifications.filter(n => !n.read && toMs(n.createdAt) > notifSeenAt).length
  const visibleAnnouncements = announcements.filter(a => !dismissedAnnounceIds.has(a.id))
  const unseenAnnounce = visibleAnnouncements.filter(a =>
    !seenAnnounceIds.has(a.id) && toMs(a.createdAt) > notifSeenAt).length
  const bellCount = unreadNotifs + newPosts.length + unseenAnnounce

  // Opening the bell clears every signal: personal notifications are marked
  // read, announcements are marked seen (per device), and the feed "last seen"
  // marker moves to now. The new-post list is snapshotted first so the panel
  // can still show it after the marker has moved.
  const openNotifications = () => {
    setSeenNewPosts(newPosts)
    setShowNotifications(true)
    const unread = notifications.filter(n => !n.read)
    unread.forEach(n => { updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {}) })
    if (announcements.length) {
      // Keep the stored set bounded so it can't grow forever on a device.
      const ids = [...new Set([...seenAnnounceIds, ...announcements.map(a => a.id)])].slice(-100)
      const next = new Set(ids)
      setSeenAnnounceIds(next)
      try { storageSet('elim_seen_announce', JSON.stringify(ids)) } catch { /* storage blocked */ }
    }
    const now = Date.now()
    setLastSeenFeed(now)
    storageSet('elim_lastSeenFeed', String(now))
    // The authoritative per-account seen marker (survives reload / re-login /
    // a failed per-doc read write).
    setNotifSeenAt(now)
    if (user?.uid) storageSet('elim_notifSeen_' + user.uid, String(now))
  }

  // Tapping a notification lands the person on the relevant post - opening its
  // comments when the notification is about a comment/reply/comment-like.
  // Tapping a broadcast announcement routes by its kind (or opens its link).
  const handleAnnouncementTap = (a: Announcement) => {
    setShowNotifications(false)
    const safeUrl = a.url && /^https?:\/\//i.test(a.url) ? a.url : null
    if (a.kind === 'quiz') { setShowQuiz(true); return }
    if (a.kind === 'message') { setActiveTab('messages'); return }
    if (a.kind === 'feed') { setActiveTab('feed'); return }
    if (safeUrl) { window.open(safeUrl, '_blank', 'noopener,noreferrer'); return }
    setActiveTab('feed')
  }

  const handleNotificationTap = (n: AppNotification) => {
    setShowNotifications(false)
    // A transcript-ready notification downloads the .txt via its link.
    if (n.type === 'transcript') { if (n.url && /^https?:\/\//i.test(n.url)) window.open(n.url, '_blank', 'noopener,noreferrer'); return }
    // A message notification lands on Messages (no post to open).
    if (n.type === 'message') { setActiveTab('messages'); return }
    if (!n.postId) return
    const pid = n.postId
    setActiveTab('feed')
    setHighlightPostId(pid)
    // Clear the highlight after a beat so the post doesn't stay outlined until
    // the next tap (matches the deep-link route behavior).
    setTimeout(() => setHighlightPostId(prev => prev === pid ? null : prev), 4000)
    if (n.type !== 'post_like') setActiveCommentsPost(pid)
  }

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
    deleteDoc(doc(db, 'notifications', id)).catch(() => {})
  }

  // Pull-to-refresh: a full reload re-establishes every realtime listener and
  // re-fetches content. The active tab is restored from sessionStorage, so the
  // reload is seamless. We set a flag so the reload SKIPS the animated splash
  // (it shouldn't replay on every refresh). The short delay lets the spinner
  // paint first.
  const handlePullRefresh = useCallback(() => new Promise<void>(() => {
    try { sessionStorage.setItem('elim-skip-splash', '1') } catch { /* storage blocked */ }
    setTimeout(() => window.location.reload(), 350)
  }), [])

  const handleLike = async (postId: string) => {
    if (!user) return
    // Liking means they've seen it — make sure the view is counted too, so a
    // post can never show more likes/comments than views.
    recordPostView(postId, user.uid)
    // Guard against a double-tap racing two writes: both would read the same
    // "not yet liked" state and each fire increment(1), permanently inflating
    // the counter against a single like doc.
    if (likeInFlight.current.has(postId)) return
    likeInFlight.current.add(postId)
    const likeDocId = `${postId}_${user.uid}`
    const alreadyLiked = likedPostIds.has(postId)
    const liked = posts.find(p => p.id === postId)
    const detail = (liked?.content || '').slice(0, 60)
    try {
      const batch = writeBatch(db)
      if (alreadyLiked) {
        batch.delete(doc(db, 'likes', likeDocId))
        batch.update(doc(db, 'posts', postId), { likes: increment(-1) })
        await batch.commit()
        logActivity(user, 'like_removed', detail)
      } else {
        batch.set(doc(db, 'likes', likeDocId), {
          postId, userId: user.uid, userName: user.displayName || '', createdAt: serverTimestamp()
        })
        batch.update(doc(db, 'posts', postId), { likes: increment(1) })
        await batch.commit()
        logActivity(user, 'like_added', detail)
      }
    } catch {
      // A failed like is not worth interrupting the person over; the snapshot
      // listener will reconcile the UI to the true state on the next tick.
    } finally {
      likeInFlight.current.delete(postId)
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
    // Posts without a section are pre-existing ones from before this split,
    // and belong on the main feed.
    let result = posts.filter(p => (p.section || 'feed') === 'feed')

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

  // Anyone left on the music tab when it was switched off would otherwise be
  // stranded on a blank screen with no way back.
  useEffect(() => {
    if (!MUSIQUE_ENABLED && activeTab === 'musique') setActiveTab('feed')
  }, [activeTab])

  // Each overlay closes on back, most recent first.
  useBackHandler(!!activeCommentsPost, () => setActiveCommentsPost(null))
  useBackHandler(showCreate, () => setShowCreate(false))
  useBackHandler(!!editingPost, () => setEditingPost(null))
  // Leaving a non-default tab returns to the feed before leaving the app.
  useBackHandler(activeTab !== 'feed', () => setActiveTab('feed'))

  // The animated intro runs ahead of everything, including the auth check -
  // so the app feels like it's presenting itself rather than making the
  // person watch a loading spinner. Auth resolves in the background during
  // the animation, so this usually costs no extra wait at all.
  if (!splashDone) {
    return <AnimatedSplash onDone={() => setSplashDone(true)} />
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-affirm-500 border-t-transparent rounded-full animate-spin" />
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

  // Same permission as the main feed: leads, admin and pastor. Doctors are
  // given a lead account rather than being granted publishing rights by
  // profession - one rule to reason about instead of two.
  const canPostSante = caps.sante

  // Deliberately NOT useMemo. These sit below the early returns above
  // (splash / authLoading / no user), and a hook cannot live there: React
  // requires the same hooks in the same order on every render, so a hook
  // after a conditional return crashes the app outright with error #310.
  // That is exactly what happened when these were memoised. Plain filters
  // over a bounded list are cheap; the flicker fix that mattered was
  // memoising the media player's context value, which is safely at the top
  // of its own provider.
  const musiquePosts = posts
    .filter(p => p.section === 'musique')
    .filter(p => musiqueCategory === 'all' || p.category === musiqueCategory)
    .filter(p => {
      const q = musiqueSearch.trim().toLowerCase()
      if (!q) return true
      return (p.content || '').toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q)
        || (p.authorName || '').toLowerCase().includes(q)
    })

  const santePosts = posts
    .filter(p => p.section === 'sante')
    .filter(p => santeCategory === 'all' || p.category === santeCategory)

  const isStaffUser = user.role === 'admin' || user.role === 'pastor'

  const baseNav = [
    { id: 'feed', icon: Home, label: t('nav.feed') },
    { id: 'messages', icon: MessageCircle, label: t('nav.messages') },
    { id: 'sante', icon: HeartPulse, label: t('nav.sante') },
    { id: 'library', icon: BookOpen, label: t('nav.library') },
    ...(MUSIQUE_ENABLED ? [{ id: 'musique', icon: Music, label: t('nav.musique') }] : []),
    { id: 'profile', icon: User, label: t('nav.profile') },
  ]
  // The one extra destination staff/leads get. Staff (admin/pastor) get Admin;
  // church leads get the Members directory. On phones this lives in the top
  // header (below) instead of the bottom bar - six labelled items on a narrow
  // phone made the words wrap. The desktop sidebar has room, so it keeps it.
  const staffTab = isStaffUser
    ? { id: 'admin', icon: ShieldCheck, label: t('nav.admin') }
    : user.role === 'church'
      ? { id: 'members', icon: Users, label: t('nav.members') }
      : null
  const navItems = staffTab ? [...baseNav, staffTab] : baseNav   // desktop sidebar
  const bottomNavItems = baseNav                                  // phone bottom bar

  return (
    <div className="min-h-screen max-w-lg mx-auto lg:max-w-none lg:mx-0 relative">
      <StarField />
      <div className="relative z-10 lg:flex">
        {/* Sidebar — desktop only */}
        <aside className="glass-bar hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-r border-slate-200/70 px-6 py-8">
          <div className="flex items-center justify-between">
            <Logo size={34} />
          </div>
          <nav className="mt-6 flex-1 space-y-1">
            {navItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition ${
                    active ? 'bg-affirm-500/10 text-affirm-700 shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
                  <Icon size={19} />
                  {item.label}
                  {item.id === 'admin' && pendingChurches.length > 0 && (
                    <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {pendingChurches.length}
                    </span>
                  )}
                  {item.id === 'messages' && unreadMessages > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadMessages}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
          <button onClick={() => setShowQuiz(true)}
            className="relative w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm mb-3 bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-sm hover:brightness-105 transition">
            <Trophy size={18} /> {t('quiz.open')}
            {quizDailyPending && (
              <span className="absolute top-2 right-3 w-3 h-3 rounded-full bg-red-500 border-2 border-white animate-pulse" />
            )}
          </button>
          <button onClick={() => setShowDonation(true)}
            className="btn-glass-amber w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm mb-3">
            <HandCoins size={18} /> {t('donate.button')}
          </button>
          {canPost && (
            <button onClick={() => setShowCreate(true)}
              className="btn-glass-primary w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm mb-4">
              <PlusCircle size={18} /> {t('nav.newPost')}
            </button>
          )}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 truncate">{user.displayName}</span>
            <button onClick={openNotifications} aria-label={t('notif.title')}
              className="relative p-2 rounded-full hover:bg-slate-100 text-slate-500">
              <Bell size={18} />
              {bellCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {bellCount > 99 ? '99+' : bellCount}
                </span>
              )}
            </button>
          </div>
          <p className="mt-3 text-[10px] text-slate-600 leading-relaxed">{COPYRIGHT}</p>
        </aside>

        <div className="flex-1 min-w-0">
          {/* Header — mobile & tablet only */}
          <header className="glass-bar lg:hidden sticky top-0 z-40 border-b border-slate-200/70 safe-top">
            <div className="px-5 h-14 flex items-center justify-between">
              <Logo size={32} />
              <div className="flex items-center gap-2">
                <button onClick={() => setShowQuiz(true)} aria-label={t('quiz.open')}
                  className="relative flex items-center gap-1.5 pl-2.5 pr-3.5 py-2 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white font-bold text-sm shadow-md active:scale-95 transition">
                  <Trophy size={17} /> {t('quiz.gameButton')}
                  {quizDailyPending && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white animate-pulse" />
                  )}
                </button>
                {staffTab && (
                  <button onClick={() => setActiveTab(staffTab.id)} aria-label={staffTab.label}
                    className={`relative p-2 rounded-full transition ${
                      activeTab === staffTab.id ? 'bg-affirm-500/15 text-affirm-700' : 'hover:bg-slate-900/5 text-slate-600'}`}>
                    <staffTab.icon size={20} />
                    {staffTab.id === 'admin' && pendingChurches.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {pendingChurches.length}
                      </span>
                    )}
                  </button>
                )}
                <button onClick={openNotifications} aria-label={t('notif.title')}
                  className="relative p-2 rounded-full hover:bg-slate-900/5 text-slate-600 transition">
                  <Bell size={20} />
                  {bellCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {bellCount > 99 ? '99+' : bellCount}
                    </span>
                  )}
                </button>
                <button onClick={() => setShowDonation(true)}
                  className="btn-glass-amber flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-semibold">
                  <HandCoins size={15} /> {t('donate.button')}
                </button>
              </div>
            </div>
          </header>

          <main className={`${playerTrack ? 'pb-48 lg:pb-32' : 'pb-28 lg:pb-16'} px-4 lg:px-10 pt-4 lg:pt-10 lg:max-w-3xl xl:max-w-4xl lg:mx-auto transition-[padding]`}>
            <PullToRefresh onRefresh={handlePullRefresh}>
            {updateUrl && (
              <a href={updateUrl} target="_blank" rel="noopener noreferrer"
                className="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-3.5 shadow-md">
                <Download size={22} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm leading-tight">{t('update.title')}</p>
                  <p className="text-xs text-white/85">{t('update.desc')}</p>
                </div>
                <span className="shrink-0 bg-white text-emerald-700 font-bold text-xs rounded-full px-3.5 py-2">{t('update.button')}</span>
              </a>
            )}
            {activeTab === 'feed' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('feed.searchPlaceholder')}
                    className="w-full pl-11 pr-10 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
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
                          ? 'bg-affirm-600 text-white border border-affirm-400/60'
                          : 'glass-soft text-slate-600 hover:text-slate-900'}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Publishing lives here (leads/admin/pastor only), not in the
                    bottom bar — a simple member never sees it. */}
                {canPost && (
                  <button onClick={() => setShowCreate(true)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-sm transition shadow-lg shadow-affirm-500/20">
                    <PlusCircle size={18} /> {t('nav.newPost')}
                  </button>
                )}

                {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}
                {!loading && visiblePosts.length === 0 && (
                  <div className="text-center py-12 px-6 my-6 scrim">
                    <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
                      <Church size={28} className="text-affirm-400" />
                    </div>
                    <p className="text-slate-800 font-medium">
                      {searchQuery || feedFilter !== 'all' ? t('feed.noMatches') : t('app.noPostsYet')}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {searchQuery || feedFilter !== 'all' ? t('feed.tryDifferent') : t('app.beFirstToShare')}
                    </p>
                  </div>
                )}
                {visiblePosts.map(post => (
                  <div key={post.id}
                    ref={post.id === highlightPostId
                      ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      : undefined}
                    className={post.id === highlightPostId
                      ? 'rounded-3xl ring-2 ring-affirm-400 ring-offset-2 ring-offset-[#0f172a] transition'
                      : ''}>
                    <PostCard post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost}
                      currentUser={user} isLiked={likedPostIds.has(post.id)} onEdit={setEditingPost} onDelete={handleDeletePost} onOpenProfile={setProfileUid} onOpenGroup={setGroupPopupId} />
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="animate-rise">
                <MessagesTab user={user} initialChannel={msgChannel} onConsumed={() => setMsgChannel(null)} />
              </div>
            )}

            {activeTab === 'profile' && (
              <ProfileTab user={user} onLogout={handleLogout} onProfileUpdated={(updates) => setUser(prev => prev ? { ...prev, ...updates } : prev)}
                onContactSupport={() => { setMsgChannel('tech'); setActiveTab('messages') }} />
            )}

            {activeTab === 'library' && (
              <div className="animate-rise">
                <LibraryTab user={user} canUpload={caps.books} canTranscribe={caps.transcribe} />
              </div>
            )}

            {MUSIQUE_ENABLED && activeTab === 'musique' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <input value={musiqueSearch} onChange={e => setMusiqueSearch(e.target.value)}
                    placeholder={t('musique.search')}
                    className="w-full pl-11 pr-10 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
                  {musiqueSearch && (
                    <button onClick={() => setMusiqueSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10">
                      <X size={15} />
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {['all', ...MUSIQUE_CATEGORIES].map(cat => (
                    <button key={cat} onClick={() => setMusiqueCategory(cat)}
                      className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                        musiqueCategory === cat
                          ? 'bg-affirm-600 text-white border border-affirm-400/60'
                          : 'glass-soft text-slate-600'}`}>
                      {cat === 'all' ? t('musique.all') : cat}
                    </button>
                  ))}
                </div>

                {canPost && (
                  <div className="flex gap-2">
                    <button onClick={() => setShowCreateMusique(true)}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-sm transition shadow-lg shadow-affirm-500/20">
                      <PlusCircle size={18} /> {t('musique.addOne')}
                    </button>
                    <button onClick={() => setShowBulkMusique(true)}
                      className="px-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-semibold text-sm transition">
                      {t('musique.addMany')}
                    </button>
                  </div>
                )}

                {musiquePosts.length === 0 ? (
                  <div className="text-center py-12 px-6 my-6 scrim">
                    <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
                      <Music size={28} className="text-affirm-400" />
                    </div>
                    <p className="text-slate-800 font-medium">
                      {musiqueSearch || musiqueCategory !== 'all' ? t('musique.noMatches') : t('musique.empty')}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {musiqueSearch || musiqueCategory !== 'all' ? t('musique.tryDifferent') : t('musique.emptyHint')}
                    </p>
                  </div>
                ) : musiquePosts.map(post => (
                  <PostCard key={post.id} post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost}
                    currentUser={user} isLiked={likedPostIds.has(post.id)} onEdit={setEditingPost} onDelete={handleDeletePost} onOpenProfile={setProfileUid} onOpenGroup={setGroupPopupId} />
                ))}
              </div>
            )}

            {activeTab === 'sante' && (
              <div className="space-y-4">
                <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">{t('sante.disclaimer')}</p>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {['all', ...SANTE_CATEGORIES].map(cat => (
                    <button key={cat} onClick={() => setSanteCategory(cat)}
                      className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                        santeCategory === cat
                          ? 'bg-affirm-600 text-white border border-affirm-400/60'
                          : 'glass-soft text-slate-600'}`}>
                      {cat === 'all' ? t('sante.allCategories') : cat}
                    </button>
                  ))}
                </div>

                {canPostSante && (
                  <button onClick={() => setShowCreateSante(true)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-sm transition shadow-lg shadow-affirm-500/20">
                    <PlusCircle size={18} /> {t('sante.newTip')}
                  </button>
                )}

                {santePosts.length === 0 ? (
                  <div className="text-center py-12 px-6 my-6 scrim">
                    <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
                      <HeartPulse size={28} className="text-affirm-400" />
                    </div>
                    <p className="text-slate-800 font-medium">{t('sante.empty')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('sante.emptyHint')}</p>
                  </div>
                ) : santePosts.map(post => (
                  <PostCard key={post.id} post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost}
                    currentUser={user} isLiked={likedPostIds.has(post.id)} onEdit={setEditingPost} onDelete={handleDeletePost} onOpenProfile={setProfileUid} onOpenGroup={setGroupPopupId} />
                ))}
              </div>
            )}

            {activeTab === 'members' && user.role === 'church' && <MembersTab />}

            {activeTab === 'admin' && isStaffUser && (
              <div className="space-y-4">
                <AdminOverview pending={pendingChurches.length} onGo={setAdminSection} />
                {(() => {
                  // Tools grouped so the menu reads as four areas, not one long list.
                  const groups: { label: string; items: { id: typeof adminSection; label: string }[] }[] = [
                    { label: t('admin.grpPeople'), items: [
                      { id: 'approvals', label: t('admin.subApprovals') },
                      { id: 'groups', label: t('groups.tab') },
                      { id: 'passwords', label: t('pwreset.tab') },
                    ] },
                    { label: t('admin.grpContent'), items: [
                      { id: 'reports', label: t('reports.tab') },
                      { id: 'broadcast', label: t('broadcast.tab') },
                    ] },
                    { label: t('admin.grpMoney'), items: [{ id: 'dons', label: t('dons.tab') }] },
                    { label: t('admin.grpSystem'), items: [
                      { id: 'quizsounds', label: t('quizsound.tab') },
                      { id: 'logs', label: t('nav.logs') },
                      { id: 'data', label: t('nav.data') },
                    ] },
                  ]
                  const currentPending = adminSection === 'approvals' && pendingChurches.length > 0
                  return (
                    <div className="relative">
                      <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{t('admin.section')}</label>
                      <div className="relative">
                        <select value={adminSection} onChange={e => setAdminSection(e.target.value as typeof adminSection)}
                          className="w-full appearance-none glass-soft rounded-2xl pl-4 pr-11 py-3.5 text-[15px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-affirm-400 cursor-pointer">
                          {groups.map(g => (
                            <optgroup key={g.label} label={g.label}>
                              {g.items.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        {!currentPending && pendingChurches.length > 0 && adminSection !== 'approvals' && (
                          <span className="absolute right-11 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center pointer-events-none">
                            {pendingChurches.length}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {adminSection === 'approvals' && isStaffUser && (
                  <AdminPanel pendingChurches={pendingChurches} onApprove={handleApproveChurch} onDeny={handleDenyChurch} />
                )}
                {adminSection === 'groups' && isStaffUser && <GroupsPanel user={user} groups={groups} />}
                {adminSection === 'passwords' && isStaffUser && <AdminPasswordPanel />}
                {adminSection === 'reports' && isStaffUser && <ReportsPanel user={user} />}
                {adminSection === 'broadcast' && isStaffUser && <BroadcastPanel />}
                {adminSection === 'dons' && isStaffUser && <DonationsPanel user={user} />}
                {adminSection === 'quizsounds' && isStaffUser && <QuizSoundsPanel />}
                {adminSection === 'logs' && isStaffUser && <LogsPanel />}
                {adminSection === 'data' && isStaffUser && <AppVersionPanel />}
                {adminSection === 'data' && <DataManagementTab user={user} />}
              </div>
            )}
            </PullToRefresh>
          </main>
        </div>

        {/* Bottom Nav — mobile & tablet only */}
        <nav className="nav-bar lg:hidden fixed bottom-0 left-0 right-0 safe-bottom z-50">
          <div className="max-w-lg mx-auto flex items-center h-16 px-1">
            {bottomNavItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`nav-item relative flex flex-col items-center justify-center flex-1 min-w-0 h-full transition ${
                    active ? 'is-active' : ''}`}>
                  <Icon size={21} strokeWidth={active ? 2.75 : 2.25} />
                  {item.id === 'admin' && pendingChurches.length > 0 && (
                    <span className="absolute top-1.5 right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {pendingChurches.length}
                    </span>
                  )}
                  {item.id === 'messages' && unreadMessages > 0 && (
                    <span className="absolute top-1 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-[#201a16]">
                      {unreadMessages > 9 ? '9+' : unreadMessages}
                    </span>
                  )}
                  <span className="text-[10px] mt-1 font-bold leading-[1.1] text-center px-0.5 max-w-full whitespace-nowrap overflow-hidden text-ellipsis">
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>

      {messageToast && (
        <button onClick={() => { setActiveTab('messages'); setMessageToast(false) }}
          className="fixed top-4 left-4 right-4 lg:left-auto lg:right-6 lg:w-80 z-[60] flex items-center gap-3 bg-[#1e293b] border border-affirm-400/30 rounded-2xl shadow-2xl px-4 py-3 text-left animate-[toastIn_0.25s_ease-out]">
          <div className="w-9 h-9 rounded-full bg-affirm-500/15 text-affirm-400 flex items-center justify-center shrink-0">
            <MessageCircle size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{t('msg.newMessageToast')}</p>
            <p className="text-[11px] text-slate-400">{t('msg.tapToOpen')}</p>
          </div>
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {unreadMessages}
          </span>
        </button>
      )}

      {showNotifPrompt && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-96 z-50 bg-[#1e293b] border border-white/10 rounded-3xl shadow-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-affirm-500/15 flex items-center justify-center text-affirm-400 shrink-0">
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
              // Already denied at the OS level: the app can't re-prompt, so send
              // them straight to the notification settings screen instead.
              else if ((await checkNotificationPermission()) === 'denied') openNotificationSettings()
            }}
              className="flex-1 py-2.5 rounded-xl bg-affirm-600 hover:bg-affirm-700 text-white text-sm font-semibold transition">
              {t('notifPrompt.enable')}
            </button>
            <button onClick={() => setShowNotifPrompt(false)}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold transition">
              {t('notifPrompt.later')}
            </button>
          </div>
        </div>
      )}

      {MUSIQUE_ENABLED && showCreateMusique && canPost && (
        <CreatePostModal onClose={() => setShowCreateMusique(false)} onSubmit={handleCreatePost}
          uploaderUid={user.uid} section="musique" myGroups={myGroups} />
      )}

      {MUSIQUE_ENABLED && showBulkMusique && canPost && (
        <BulkMusicModal user={user} onClose={() => setShowBulkMusique(false)} />
      )}

      {showCreateSante && canPostSante && (
        <CreatePostModal onClose={() => setShowCreateSante(false)} onSubmit={handleCreatePost}
          uploaderUid={user.uid} section="sante" myGroups={myGroups} />
      )}

      {showCreate && canPost && (
        <CreatePostModal onClose={() => setShowCreate(false)} onSubmit={handleCreatePost} uploaderUid={user.uid} myGroups={myGroups} />
      )}
      {editingPost && (
        <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSave={handleEditPost} />
      )}
      {activeCommentsPost && (() => {
        const cp = posts.find(p => p.id === activeCommentsPost)
        const postAuthor = cp ? { uid: cp.authorId || cp.churchId, name: cp.authorName || cp.churchName || '' } : null
        return (
          <CommentsSheet postId={activeCommentsPost} comments={comments} postAuthor={postAuthor}
            onClose={() => setActiveCommentsPost(null)} onAdd={handleAddComment}
            onLikeComment={handleLikeComment} likedCommentIds={likedCommentIds} currentUser={user}
            onOpenProfile={setProfileUid} />
        )
      })()}
      {showNotifications && (
        <NotificationsPanel
          notifications={notifications}
          announcements={visibleAnnouncements}
          newPostCount={seenNewPosts.length}
          onClose={() => setShowNotifications(false)}
          onTap={handleNotificationTap}
          onTapAnnouncement={handleAnnouncementTap}
          onDismiss={dismissNotification}
          onDismissAnnouncement={dismissAnnouncement}
          onViewNewPosts={() => { setShowNotifications(false); setActiveTab('feed') }} />
      )}
      {showDonation && (
        <DonationSheet config={donation} canEdit={isStaffUser} user={user}
          onClose={() => setShowDonation(false)} />
      )}
      {showQuiz && (
        <BibleQuiz user={user} onClose={() => { setShowQuiz(false); setActiveTab('feed') }} />
      )}
      {profileUid && (
        <ProfilePopup uid={profileUid} onClose={() => setProfileUid(null)} />
      )}
      {groupPopupId && (
        <GroupPopup groupId={groupPopupId} onClose={() => setGroupPopupId(null)} />
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

// Country display names (FR_COUNTRY), profession labels (EN_PROFESSION) and
// department labels (EN_INTEREST) live in ./labels so the profile/members
// views can translate the same stored values (see TValue).

// Profession options for signup. Kept broad rather than exhaustive - a huge
// list is worse to scroll on a phone than a short one plus 'Autre'.
// One church, and everyone belongs to it - so this is a constant rather than
// something each person picks or types. Held in one place so the name can be
// changed without hunting through signup, profile and post code.
export const CHURCH_NAME = 'Centre Chrétien E.L.I.M'

// Music genres for the Musique tab.
// Music is switched off for now: every YouTube post loads YouTube's player
// into an iframe, and a feed of them pulls a lot of data before anyone has
// pressed play. Flipping this back to true restores the tab, its categories
// and the bulk import exactly as they were - nothing has been deleted, and
// posts already published keep their data.
const MUSIQUE_ENABLED = false

const MUSIQUE_CATEGORIES = [
  'Louange', 'Adoration', 'Chorales', 'Jeunesse', 'Burkina Classic',
  'Exo Eclat', 'Special', 'Agape'
]

// Categories for health posts.
const SANTE_CATEGORIES = [
  'Prévention', 'Nutrition', 'Maternité & enfance', 'Hygiène',
  'Infections', 'Santé mentale', 'Premiers secours', 'Général'
]

const PROFESSIONS = [
  'Agriculteur / Éleveur', 'Artisan', 'Commerçant', 'Chauffeur',
  'Enseignant', 'Étudiant', 'Fonctionnaire', 'Infirmier / Sage-femme',
  'Informaticien', 'Ingénieur', 'Journaliste', 'Juriste / Avocat',
  'Médecin', 'Militaire / Sécurité', 'Ménagère / Au foyer',
  'Ouvrier', 'Pasteur / Ministre', 'Pharmacien', 'Retraité',
  'Sans emploi', 'Secrétaire', 'Technicien', 'Autre'
]

// Church departments a member can belong to or wish to join.
const INTERESTS = [
  'Chorale / Louange', 'Musique / Instruments', 'Intercession / Prière',
  'Évangélisation', 'École du dimanche', 'Jeunesse', 'Femmes', 'Hommes',
  'Accueil / Protocole', 'Sonorisation / Technique', 'Média / Communication',
  'Action sociale', 'Santé', 'Finances', 'Logistique', 'Enseignement'
]

// Calling codes for the phone input's country picker. Not exhaustive (that's
// what COUNTRIES above is for) - just a curated, sensible set prioritizing
// Burkina Faso and neighboring West African countries first, since that's
// this app's primary user base, followed by other common ones.
// `name` is the French label shown to users (a member in Côte d'Ivoire
// should see "Côte d'Ivoire", not "Ivory Coast"); `region` is the ISO code
// used to auto-select the right entry from the device locale; `country` is
// the matching value in the COUNTRIES list so the profile's country field
// can be defaulted at the same time.
const COUNTRY_CODES = [
  { name: 'Burkina Faso', code: '+226', region: 'BF', country: 'Burkina Faso' },
  { name: "Côte d'Ivoire", code: '+225', region: 'CI', country: 'Ivory Coast' },
  { name: 'Mali', code: '+223', region: 'ML', country: 'Mali' },
  { name: 'Niger', code: '+227', region: 'NE', country: 'Niger' },
  { name: 'Sénégal', code: '+221', region: 'SN', country: 'Senegal' },
  { name: 'Ghana', code: '+233', region: 'GH', country: 'Ghana' },
  { name: 'Togo', code: '+228', region: 'TG', country: 'Togo' },
  { name: 'Bénin', code: '+229', region: 'BJ', country: 'Benin' },
  { name: 'Guinée', code: '+224', region: 'GN', country: 'Guinea' },
  { name: 'Guinée-Bissau', code: '+245', region: 'GW', country: 'Guinea-Bissau' },
  { name: 'Sierra Leone', code: '+232', region: 'SL', country: 'Sierra Leone' },
  { name: 'Libéria', code: '+231', region: 'LR', country: 'Liberia' },
  { name: 'Gambie', code: '+220', region: 'GM', country: 'Gambia' },
  { name: 'Mauritanie', code: '+222', region: 'MR', country: 'Mauritania' },
  { name: 'Nigéria', code: '+234', region: 'NG', country: 'Nigeria' },
  { name: 'Cameroun', code: '+237', region: 'CM', country: 'Cameroon' },
  { name: 'Tchad', code: '+235', region: 'TD', country: 'Chad' },
  { name: 'Gabon', code: '+241', region: 'GA', country: 'Gabon' },
  { name: 'Congo (Brazzaville)', code: '+242', region: 'CG', country: 'Congo (Brazzaville)' },
  { name: 'RD Congo', code: '+243', region: 'CD', country: 'Democratic Republic of the Congo' },
  { name: 'République centrafricaine', code: '+236', region: 'CF', country: 'Central African Republic' },
  { name: 'Maroc', code: '+212', region: 'MA', country: 'Morocco' },
  { name: 'Algérie', code: '+213', region: 'DZ', country: 'Algeria' },
  { name: 'Tunisie', code: '+216', region: 'TN', country: 'Tunisia' },
  { name: 'France', code: '+33', region: 'FR', country: 'France' },
  { name: 'Belgique', code: '+32', region: 'BE', country: 'Belgium' },
  { name: 'Suisse', code: '+41', region: 'CH', country: 'Switzerland' },
  { name: 'Italie', code: '+39', region: 'IT', country: 'Italy' },
  { name: 'Allemagne', code: '+49', region: 'DE', country: 'Germany' },
  { name: 'Espagne', code: '+34', region: 'ES', country: 'Spain' },
  { name: 'Royaume-Uni', code: '+44', region: 'GB', country: 'United Kingdom' },
  { name: 'Canada', code: '+1', region: 'CA', country: 'Canada' },
  { name: 'États-Unis', code: '+1', region: 'US', country: 'United States' },
]

// Best-effort country of the device, from the locale region subtag
// (e.g. "fr-CI" -> "CI"). Used only to pre-select a sensible default so a
// member in Abidjan isn't left on +226; they can still change it.
function detectRegion(): string {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const l of langs) {
      const m = /[-_]([A-Za-z]{2})\b/.exec(l || '')
      if (m) return m[1].toUpperCase()
    }
  } catch { /* ignore */ }
  return ''
}

// The COUNTRY_CODES entry matching the device region, or Burkina Faso.
function defaultCountryEntry() {
  const r = detectRegion()
  return COUNTRY_CODES.find(c => c.region === r) || COUNTRY_CODES[0]
}

// If someone types their full international number into a national-number
// field, drop the leading country code so the two phone fields stay
// comparable and the login email is built from the national part only.
// Only strips an explicit international prefix ("+225…" or "00225…") — a
// bare national number that happens to begin with those digits is left
// alone. `raw` is the original text (so we can see the "+"), `code` the
// selected dial code, e.g. "+225".
function stripDialCode(raw: string, code: string): string {
  const cc = sanitizeDigits(code)
  const trimmed = raw.trimStart()
  const digits = sanitizeDigits(raw)
  if (!cc) return digits
  if (trimmed.startsWith('+') && digits.startsWith(cc)) return digits.slice(cc.length)
  if (digits.startsWith('00' + cc)) return digits.slice(2 + cc.length)
  return digits
}

// ==================== COMPONENTS ====================
// A folded profile group: header always visible, body one tap away and never
// deeper than this (NN/g: past two levels people get lost). Progressive
// disclosure keeps the profile short and unintimidating.
function Fold({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="glass rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="font-bold text-slate-900">{title}</span>
        <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  )
}

// The app's one sound control surface (Part C of the blueprint): a master
// switch, per-channel toggles, quiet hours and the Sunday-service mute — all
// backed by feedback.ts. A tap on a channel previews its earcon.
function SoundSettingsPanel() {
  const { t } = useLanguage()
  const [s, setS] = useState(getSoundSettings)
  const save = (patch: Parameters<typeof setSoundSettings>[0]) => setS(setSoundSettings(patch))
  const Row = ({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) => (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-slate-700">{label}</span>
      <button onClick={onToggle} role="switch" aria-checked={on}
        className={`relative shrink-0 w-12 h-7 rounded-full transition ${on ? 'bg-affirm-600' : 'bg-slate-200'}`}>
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
  const chan = (c: SoundChannel, label: string) => (
    <Row label={label} on={s.channels[c]} onToggle={() => { const on = !s.channels[c]; save({ channels: { ...s.channels, [c]: on } }); if (on) playFeedback(c === 'quiz' ? 'quiz.correct' : c === 'messages' ? 'message' : c === 'announcements' ? 'announce' : 'tick') }} />
  )
  return (
    <div className="pt-2 border-t border-slate-100">
      <h3 className="font-bold text-slate-900 text-sm mb-2">{t('sound.title')}</h3>
      <Row label={t('sound.master')} on={s.master} onToggle={() => save({ master: !s.master })} />
      <Row label={t('sound.haptics')} on={s.haptics} onToggle={() => save({ haptics: !s.haptics })} />
      {s.master && (
        <div className="mt-1 pl-1 space-y-0.5">
          {chan('quiz', t('sound.chQuiz'))}
          {chan('messages', t('sound.chMessages'))}
          {chan('announcements', t('sound.chAnnounce'))}
          {chan('social', t('sound.chSocial'))}
          <div className="pt-2 mt-1 border-t border-slate-50">
            <Row label={t('sound.quiet')} on={s.quietEnabled} onToggle={() => save({ quietEnabled: !s.quietEnabled })} />
            {s.quietEnabled && (
              <div className="flex items-center gap-2 text-xs text-slate-500 pl-1 pb-1">
                <input type="time" value={s.quietFrom} onChange={e => save({ quietFrom: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1" />
                <span>→</span>
                <input type="time" value={s.quietTo} onChange={e => save({ quietTo: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1" />
              </div>
            )}
            <Row label={t('sound.serviceMute')} on={s.serviceMute} onToggle={() => save({ serviceMute: !s.serviceMute })} />
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileTab({ user, onProfileUpdated, onLogout, onContactSupport }: {
  user: AppUser
  onProfileUpdated: (updates: Partial<AppUser>) => void
  onLogout: () => void
  onContactSupport: () => void
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
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [needsSettings, setNeedsSettings] = useState(false)
  const [soundOn, setSoundOn] = useState(!isAlertMuted())
  const [diag, setDiag] = useState<any>(null)

  useEffect(() => {
    notificationDiagnostics(user).then(setDiag).catch(() => {})
  }, [user.notificationsEnabled, user.uid])

  const handleTestNotification = async () => {
    setTestResult(null)
    const result = await sendTestNotification()
    setTestResult(result)
    notificationDiagnostics(user).then(setDiag).catch(() => {})
  }

  const handleToggleNotifications = async () => {
    setNotifError('')
    setNeedsSettings(false)

    if (user.notificationsEnabled) {
      // Turning OFF only stops US sending. The OS permission stays granted -
      // no app is allowed to revoke its own. The note below says so rather
      // than letting people wonder why the phone still lists us as allowed.
      await disableNotifications(user.uid)
      onProfileUpdated({ notificationsEnabled: false })
      return
    }

    setNotifLoading(true)
    const permission = await checkNotificationPermission()

    // Once denied, the OS will not show the prompt again - asking would
    // silently fail. Settings is the only remaining route.
    if (permission === 'denied') {
      setNotifLoading(false)
      setNeedsSettings(true)
      setNotifError(t('profile.blockedBySystem'))
      return
    }

    const ok = await enableNotifications(user.uid)
    setNotifLoading(false)
    if (ok) {
      onProfileUpdated({ notificationsEnabled: true })
    } else {
      setNeedsSettings(true)
      setNotifError(t('profile.notificationsPermissionDenied'))
    }
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
      <div className="glass rounded-3xl p-8 shadow-sm border border-slate-100 text-center">
        <div className="relative w-24 h-24 mx-auto mb-4">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-24 h-24 rounded-full object-cover shadow-lg shadow-affirm-200" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-affirm-200">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white border-2 border-affirm-500 text-affirm-600 flex items-center justify-center cursor-pointer shadow-md hover:bg-affirm-50 transition">
            {uploading ? (
              <div className="w-3.5 h-3.5 border-2 border-affirm-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera size={14} />
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} disabled={uploading} />
          </label>
        </div>
        <h2 className="text-xl font-bold text-slate-900">{user.displayName}</h2>
        <p className="text-slate-400 text-sm mt-1">{user.email}</p>
        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-affirm-50 text-affirm-700 text-xs font-semibold">
          {user.role === 'church' ? <><CheckCircle2 size={14} /> {t('app.verifiedChurch')}</> : user.role === 'admin' ? <><ShieldCheck size={14} /> {t('app.admin')}</> : user.role === 'pastor' ? <><ShieldCheck size={14} /> {t('role.pastor')}</> : t('app.member')}
        </div>
        {avatarError && <p className="mt-4 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 inline-block">{avatarError}</p>}
      </div>

      <Fold title={t('profile.groupAccount')} defaultOpen>
      <form onSubmit={handleSaveProfile} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.church')}</label>
          <input value={churchName} onChange={e => setChurchName(e.target.value)} placeholder={t('profile.churchPlaceholder')}
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 text-[15px]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.country')}</label>
            <select value={country} onChange={e => setCountry(e.target.value)}
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 text-[15px] bg-white">
              <option value="">{t('profile.selectCountry')}</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.city')}</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Ouagadougou"
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 text-[15px]" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">{t('profile.phoneNumber')}</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +226 70 00 00 00"
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 text-[15px]" />
        </div>

        {saveError && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{saveError}</p>}
        {saved && <p className="text-sm text-affirm-700 bg-affirm-50 rounded-xl px-4 py-3">{t('profile.updated')}</p>}

        <button type="submit" disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white font-semibold text-[15px] transition disabled:opacity-60">
          {saving ? t('profile.saving') : t('profile.saveChanges')}
        </button>
      </form>
      <LanguagePicker />
      </Fold>

      <Fold title={t('profile.groupNotif')}>
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-900">{t('profile.notifications')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('profile.notificationsNote')}</p>
          </div>
          <button onClick={handleToggleNotifications} disabled={notifLoading}
            role="switch" aria-checked={!!user.notificationsEnabled}
            className={`relative shrink-0 w-12 h-7 rounded-full transition disabled:opacity-60 ${
              user.notificationsEnabled ? 'bg-affirm-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              user.notificationsEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {notifError && <p className="mt-3 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{notifError}</p>}

        {needsSettings && (
          <button onClick={async () => {
            const opened = await openNotificationSettings()
            if (!opened) setNotifError(t('profile.openSettingsManually'))
          }}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-affirm-600 hover:bg-affirm-700 text-white text-sm font-semibold transition">
            <Bell size={15} /> {t('profile.openPhoneSettings')}
          </button>
        )}

        <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">{t('profile.systemLinkNote')}</p>

        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-50">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{t('profile.messageSound')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('profile.messageSoundNote')}</p>
          </div>
          <button onClick={() => { const next = !soundOn; setSoundOn(next); setAlertMuted(!next) }}
            role="switch" aria-checked={soundOn}
            className={`relative shrink-0 w-12 h-7 rounded-full transition ${soundOn ? 'bg-affirm-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              soundOn ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <button onClick={handleTestNotification}
          className="mt-4 w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition">
          {t('profile.testNotification')}
        </button>

        {testResult && (
          <p className={`mt-2 text-xs rounded-xl px-3 py-2 ${
            testResult.ok ? 'text-affirm-700 bg-affirm-50' : 'text-red-600 bg-red-50'}`}>
            {testResult.ok ? t('profile.testSent') : t('profile.testFailed')} — {testResult.detail}
          </p>
        )}

        {diag && (
          <div className="mt-3 pt-3 border-t border-slate-50 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {[
              [t('profile.diagPlatform'), diag.platform],
              [t('profile.diagPermission'), diag.osPermission],
              [t('profile.diagEnabled'), diag.enabledInApp ? '✓' : '✗'],
              [t('profile.diagTokens'), String(diag.tokensStored)]
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-2">
                <span className="text-[11px] text-slate-400">{k}</span>
                <span className="text-[11px] font-semibold text-slate-600 truncate">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <SoundSettingsPanel />
      </Fold>

      <Fold title={t('profile.groupHelp')}>
      <div>
        <h3 className="font-bold text-slate-900">{t('support.title')}</h3>
        {/* Primary support path: the in-app Technical support chat (goes to the
            tech team). Email stays below as a fallback. */}
        <button onClick={onContactSupport}
          className="mt-3 w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white transition">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><LifeBuoy size={16} /></div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-semibold">{t('support.chatTech')}</p>
            <p className="text-xs text-white/80 truncate">{t('support.chatTechNote')}</p>
          </div>
        </button>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t('support.note')}</p>

        <div className="mt-4 space-y-2">
          <a
            href={`mailto:hello@kaj-consulting.com?subject=${encodeURIComponent('ELIM App Support')}&body=${encodeURIComponent(
              `\n\n---\nAccount: ${user.displayName} (${user.role})\nApp: ELIM`
            )}`}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition"
          >
            <div className="w-9 h-9 rounded-xl bg-affirm-100 flex items-center justify-center text-affirm-600 shrink-0">
              <Mail size={16} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-slate-800">{t('support.emailUs')}</p>
              <p className="text-xs text-slate-400 truncate">hello@kaj-consulting.com</p>
            </div>
          </a>

          <a
            href="https://kaj-consulting.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Globe size={16} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-slate-800">{t('support.visitSite')}</p>
              <p className="text-xs text-slate-400 truncate">kaj-consulting.com</p>
            </div>
          </a>
        </div>
      </div>
      </Fold>

      <button onClick={onLogout}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white border border-red-100 text-red-600 font-semibold text-sm hover:bg-red-50 transition shadow-sm">
        <LogOut size={18} /> {t('profile.logout')}
      </button>

      <div className="text-center py-4">
        <p className="text-[11px] text-on-bg">{COPYRIGHT}</p>
        <div className="mt-1 flex items-center justify-center gap-3">
          <a href="/privacy.html" target="_blank" rel="noreferrer"
            className="text-[11px] text-on-bg hover:text-white underline">
            {t('footer.privacy')}
          </a>
          <span className="text-[11px] text-on-bg">·</span>
          <a href="/child-safety.html" target="_blank" rel="noreferrer"
            className="text-[11px] text-on-bg hover:text-white underline">
            {t('footer.childSafety')}
          </a>
        </div>
      </div>
    </div>
  )
}

// Admin control for the in-app "update available" banner: the admin sets the
// build number that is now live on the store, and every member on an older
// build then sees the Update button. Nothing auto-bumps this, so a staff test
// install can't nag the congregation.
// Admin "answer first" overview: the handful of numbers that need a decision,
// scanned in the first seconds (F-pattern top row). Each tile jumps to its
// tool. The one that needs action wears a colour, not just a number.
function AdminOverview({ pending, onGo }: { pending: number; onGo: (s: 'approvals' | 'reports' | 'broadcast') => void }) {
  const { t } = useLanguage()
  const [reportsOpen, setReportsOpen] = useState<number | null>(null)
  const [scheduled, setScheduled] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    getDocs(query(collection(db, 'reports'), where('status', '==', 'open')))
      .then(s => { if (alive) setReportsOpen(s.size) }).catch(() => { if (alive) setReportsOpen(0) })
    getDocs(query(collection(db, 'scheduledBroadcasts'), where('sent', '==', false)))
      .then(s => { if (alive) setScheduled(s.size) }).catch(() => { if (alive) setScheduled(0) })
    return () => { alive = false }
  }, [])
  const Tile = ({ n, label, go, alert }: { n: number | null; label: string; go: () => void; alert: boolean }) => (
    <button onClick={go}
      className={`glass-soft rounded-2xl p-3 text-left transition ${alert ? 'ring-2 ring-red-300' : ''}`}>
      <div className={`text-2xl font-extrabold leading-none ${alert ? 'text-red-600' : 'text-slate-800'}`}>{n ?? '—'}</div>
      <div className="text-[11px] text-slate-500 font-semibold mt-1 leading-tight">{label}</div>
    </button>
  )
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{t('admin.toTreat')}</label>
      <div className="grid grid-cols-3 gap-2">
        <Tile n={pending} label={t('admin.kpiApprovals')} go={() => onGo('approvals')} alert={pending > 0} />
        <Tile n={reportsOpen} label={t('admin.kpiReports')} go={() => onGo('reports')} alert={(reportsOpen || 0) > 0} />
        <Tile n={scheduled} label={t('admin.kpiScheduled')} go={() => onGo('broadcast')} alert={false} />
      </div>
    </div>
  )
}

// Admin password / PIN reset: find any member and set them a new sign-in code,
// then read it out to them. Backed by the adminSetPassword Cloud Function (only
// the Admin SDK can set another user's password). Staff-gated in the UI and
// again on the server.
function AdminPasswordPanel() {
  const { t } = useLanguage()
  const [users, setUsers] = useState<{ uid: string; name: string; phone: string; role: string }[]>([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ uid: string; name: string; phone: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    getDocs(collection(db, 'users')).then(snap => {
      if (!alive) return
      setUsers(snap.docs.map(d => {
        const v = d.data() as any
        return { uid: d.id, name: v.displayName || '—', phone: v.phone || '', role: v.role || 'member' }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => { /* directory unavailable */ })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return [] as typeof users
    return users.filter(u => u.name.toLowerCase().includes(s) || u.phone.replace(/\s/g, '').includes(s.replace(/\s/g, ''))).slice(0, 12)
  }, [q, users])

  const submit = async () => {
    if (!picked || code.trim().length < 4 || busy) return
    setBusy(true); setErr(''); setDone('')
    try {
      await httpsCallable(functions, 'adminSetPassword')({ uid: picked.uid, password: code.trim() })
      setDone(t('pwreset.done').replace('{name}', picked.name).replace('{code}', code.trim()))
      setCode(''); setPicked(null); setQ('')
    } catch (e: any) {
      setErr(e?.message || t('pwreset.failed'))
    } finally { setBusy(false) }
  }

  return (
    <div className="glass-soft rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="font-bold text-slate-800 flex items-center gap-2">🔑 {t('pwreset.title')}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t('pwreset.intro')}</p>
      </div>

      {picked ? (
        <div className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{picked.name}</p>
            {picked.phone && <p className="text-xs text-slate-400 truncate">{picked.phone}</p>}
          </div>
          <button onClick={() => setPicked(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ) : (
        <div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('pwreset.search')}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          {filtered.length > 0 && (
            <div className="mt-2 border border-slate-100 rounded-xl bg-white overflow-hidden max-h-56 overflow-y-auto">
              {filtered.map(u => (
                <button key={u.uid} onClick={() => { setPicked(u); setDone('') }}
                  className="w-full text-left px-3 py-2 hover:bg-affirm-50 border-b border-slate-50 last:border-0">
                  <span className="text-sm font-semibold text-slate-800">{u.name}</span>
                  {u.phone && <span className="text-xs text-slate-400"> · {u.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {picked && (
        <>
          <input value={code} onChange={e => setCode(e.target.value)} maxLength={64}
            placeholder={t('pwreset.newCode')} autoComplete="off"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          <p className="text-[11px] text-slate-400">{t('pwreset.hint')}</p>
          <button onClick={submit} disabled={busy || code.trim().length < 4}
            className="w-full py-3 rounded-2xl bg-affirm-600 text-white font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} {t('pwreset.set')}
          </button>
          {/* Push a name changed in the database out to the leaderboards, posts
              and comments (which each stored a copy of the old name). */}
          <button onClick={async () => {
            if (busy) return
            setBusy(true); setErr(''); setDone('')
            try {
              const res: any = await httpsCallable(functions, 'adminResyncName')({ uid: picked.uid })
              const d = res?.data || {}
              setDone(t('pwreset.resyncDone').replace('{name}', d.name || picked.name))
            } catch (e: any) { setErr(e?.message || t('pwreset.failed')) }
            finally { setBusy(false) }
          }} disabled={busy}
            className="w-full py-2.5 rounded-2xl bg-slate-100 text-slate-700 font-semibold text-sm disabled:opacity-60">
            {t('pwreset.resync')}
          </button>
        </>
      )}
      {err && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
      {done && <p className="text-sm text-affirm-700 bg-affirm-50 rounded-xl px-3 py-2 font-medium">{done}</p>}
    </div>
  )
}

// Admin sound picker: choose which of the 20 library sounds fires for each quiz
// event, preview any of them, and save to config/quizSounds (applies to everyone).
function QuizSoundsPanel() {
  const { t } = useLanguage()
  const [map, setMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true
    getDoc(doc(db, 'config', 'quizSounds')).then(s => { if (alive && s.exists()) setMap(s.data() as Record<string, string>) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const save = async () => {
    setSaving(true); setSaved(false)
    try {
      await setDoc(doc(db, 'config', 'quizSounds'), map, { merge: true })
      setEventSounds(map as Partial<Record<QuizEvent, string>>)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch { /* ignore */ } finally { setSaving(false) }
  }
  return (
    <div className="glass-soft rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="font-bold text-slate-800 flex items-center gap-2">🔊 {t('quizsound.title')}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t('quizsound.intro')}</p>
      </div>
      {QUIZ_EVENTS.map(ev => {
        const current = map[ev] || getEventSound(ev)
        return (
          <div key={ev} className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2.5">
            <span className="flex-1 min-w-0 text-sm font-semibold text-slate-700 truncate">{t(`quizsound.ev.${ev}` as any)}</span>
            <select value={current} onChange={e => setMap(m => ({ ...m, [ev]: e.target.value }))}
              className="shrink-0 max-w-[45%] appearance-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm">
              {SOUND_IDS.map(id => <option key={id} value={id}>{SOUND_NAMES[id]}</option>)}
            </select>
            <button onClick={() => playSound(current)} aria-label={t('quizsound.preview')}
              className="shrink-0 w-9 h-9 rounded-lg bg-affirm-600 text-white flex items-center justify-center">▶</button>
          </div>
        )
      })}
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-2xl bg-affirm-600 text-white font-semibold text-sm disabled:opacity-60">
        {saving ? t('profile.saving') : saved ? `✓ ${t('profile.updated')}` : t('quizsound.save')}
      </button>
    </div>
  )
}

function AppVersionPanel() {
  const { t } = useLanguage()
  const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app'
  const [current, setCurrent] = useState<number | null>(null)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'config', 'app')).then(s => {
      const n = Number((s.data() as any)?.latestBuild || 0)
      setCurrent(n); setValue(n ? String(n) : '')
    }).catch(() => setCurrent(0))
  }, [])

  const save = async () => {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n) || n <= 0 || saving) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'config', 'app'),
        { latestBuild: n, updateUrl: PLAY_URL, updatedAt: serverTimestamp() }, { merge: true })
      setCurrent(n); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { /* rules/offline */ } finally { setSaving(false) }
  }

  return (
    <div className="glass-soft rounded-2xl p-4 mb-4">
      <h3 className="font-bold text-slate-800 mb-1">{t('appVersion.title')}</h3>
      <p className="text-xs text-slate-500 mb-3">{t('appVersion.hint')}</p>
      <p className="text-xs text-slate-500 mb-2">{t('appVersion.current')}: <strong>{current === null ? '…' : (current || '—')}</strong></p>
      <div className="flex gap-2">
        <input value={value} onChange={e => setValue(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric" placeholder={t('appVersion.placeholder')}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
        <button onClick={save} disabled={!value || saving}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-affirm-600 text-white font-semibold text-sm disabled:opacity-50">
          {saved ? t('appVersion.saved') : t('appVersion.save')}
        </button>
      </div>
    </div>
  )
}

// The recurring notifications the app sends on its own (Cloud Scheduler). The
// schedule is fixed in code, but the title/body/on-off are editable and stored
// in config/autoNotifs. Defaults here MUST match the server defaults in
// functions/index.js so the editor shows what actually goes out. `vars` lists
// the placeholders the server fills at send time.
const AUTO_DEFS: { key: string; when: string; vars?: string; title: string; body: string }[] = [
  {
    key: 'quizReminder', when: 'Tous les jours · 08:00',
    title: 'Quiz Biblique 🏆',
    body: "Le défi du jour t'attend : 5 questions, +50 points et un badge !",
  },
  {
    key: 'topScore', when: 'Tous les jours · 20:00', vars: '{name}',
    title: '📖 On apprend la Bible ensemble',
    body: "Aujourd'hui, {name} a pris le temps d'étudier la Parole avec E.L.I.M Quiz Biblique. Et toi, quel verset vas-tu découvrir ce soir ? 📖🙏",
  },
  {
    key: 'weeklyChampions', when: 'Lundi · 08:00', vars: '{name}, {count}',
    title: '🏆 Champion de la semaine',
    body: "Bravo à {name} et à nos {count} champions par catégorie pour tout ce qu'ils ont appris dans la Parole cette semaine ! Une nouvelle semaine pour grandir dans la Bible commence. 📖",
  },
  {
    key: 'kidsChampion', when: 'Dimanche · 08:00', vars: '{name}',
    title: '🎉 Champion du Quiz Enfants',
    body: "Bravo {name} ! Champion des enfants cette semaine. Récompense aujourd'hui à l'école du dimanche. 👏",
  },
]

// Editable card for one automatic notification (title, body, on/off).
function AutoNotifRow({ def }: { def: typeof AUTO_DEFS[number] }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(def.title)
  const [body, setBody] = useState(def.body)
  const [enabled, setEnabled] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'config', 'autoNotifs')).then(s => {
      const c = (s.exists() ? (s.data() as any)[def.key] : null) || {}
      if (typeof c.title === 'string' && c.title.trim()) setTitle(c.title)
      if (typeof c.body === 'string' && c.body.trim()) setBody(c.body)
      setEnabled(c.enabled !== false)
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [def.key])

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'config', 'autoNotifs'),
        { [def.key]: { title: title.trim(), body: body.trim(), enabled } }, { merge: true })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { /* rules/offline */ } finally { setSaving(false) }
  }

  const resetDefaults = () => { setTitle(def.title); setBody(def.body) }

  return (
    <div className={`bg-white rounded-xl border border-slate-100 p-3 ${!enabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{def.when}</p>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-affirm-600 w-4 h-4" />
          {enabled ? t('broadcast.enabled') : t('broadcast.disabled')}
        </label>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={!loaded}
        placeholder={t('broadcast.titlePlaceholder')}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white mb-2 focus:outline-none focus:ring-2 focus:ring-affirm-400" />
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={500} rows={3} disabled={!loaded}
        placeholder={t('broadcast.bodyPlaceholder')}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-affirm-400" />
      {def.vars && <p className="text-[11px] text-slate-400 mt-1">{t('broadcast.varsHint')} <code className="text-affirm-600">{def.vars}</code></p>}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={save} disabled={saving || !loaded}
          className="px-3 py-1.5 rounded-lg bg-affirm-600 text-white font-semibold text-xs disabled:opacity-50">
          {saved ? t('appVersion.saved') : t('post.save')}
        </button>
        <button onClick={resetDefaults} className="px-3 py-1.5 rounded-lg text-slate-500 font-semibold text-xs hover:bg-slate-100">
          {t('broadcast.resetDefault')}
        </button>
      </div>
    </div>
  )
}

// Admin broadcast centre: compose a push to everyone (now or scheduled), see
// the app's automatic notifications, and manage pending scheduled ones.
function BroadcastPanel() {
  const { t } = useLanguage()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [route, setRoute] = useState('info')
  const [when, setWhen] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sent' | 'scheduled'>('idle')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<ScheduledBroadcast[]>([])
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'scheduledBroadcasts'), where('sent', '==', false), orderBy('sendAt', 'asc'))
    return onSnapshot(q, snap => setPending(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledBroadcast))),
      () => { /* rules/offline - just show an empty pending list */ })
  }, [])
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current) }, [])

  const reset = () => { setTitle(''); setBody(''); setUrl(''); setRoute('info'); setWhen('') }

  const submit = async () => {
    if (!title.trim() || !body.trim() || sending) return
    setSending(true); setError(''); setStatus('idle')
    const payload = { title: title.trim(), body: body.trim(), url: url.trim() || null, route }
    try {
      if (when) {
        const at = new Date(when)
        if (isNaN(at.getTime()) || at.getTime() <= Date.now()) { setError(t('broadcast.pastTime')); setSending(false); return }
        await addDoc(collection(db, 'scheduledBroadcasts'),
          { ...payload, sendAt: Timestamp.fromDate(at), sent: false, createdAt: serverTimestamp() })
        setStatus('scheduled')
      } else {
        await httpsCallable(functions, 'sendBroadcast')(payload)
        setStatus('sent')
      }
      reset()
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setStatus('idle'), 4000)
    } catch (e: any) {
      setError(e?.message || t('broadcast.failed'))
    } finally { setSending(false) }
  }

  const cancelPending = async (id: string) => { await deleteDoc(doc(db, 'scheduledBroadcasts', id)).catch(() => {}) }
  const fmt = (ts: any) => { try { return ts?.toDate ? ts.toDate().toLocaleString() : '' } catch { return '' } }

  const ROUTES = [
    { id: 'info', label: t('broadcast.routeInfo') },
    { id: 'quiz', label: t('broadcast.routeQuiz') },
    { id: 'feed', label: t('broadcast.routeFeed') },
    { id: 'message', label: t('broadcast.routeMessages') },
    { id: 'update', label: t('broadcast.routeUpdate') },
  ]

  return (
    <div className="space-y-4">
      {/* Compose */}
      <div className="glass-soft rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2"><Megaphone size={18} /> {t('broadcast.composeTitle')}</h3>
        <p className="text-xs text-slate-500 mb-3">{t('broadcast.composeHint')}</p>
        <div className="space-y-2.5">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
            placeholder={t('broadcast.titlePlaceholder')}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={500}
            placeholder={t('broadcast.bodyPlaceholder')} rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          <input value={url} onChange={e => setUrl(e.target.value)} maxLength={500} inputMode="url"
            placeholder={t('broadcast.linkPlaceholder')}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('broadcast.route')}</label>
              <select value={route} onChange={e => setRoute(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
                {ROUTES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">{t('broadcast.whenLabel')}</label>
              <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">{t('broadcast.whenHint')}</p>
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {status === 'sent' && <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{t('broadcast.sent')}</p>}
          {status === 'scheduled' && <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{t('broadcast.scheduled')}</p>}
          <button onClick={submit} disabled={!title.trim() || !body.trim() || sending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-affirm-600 text-white font-semibold text-sm disabled:opacity-50">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {when ? t('broadcast.scheduleBtn') : t('broadcast.sendNow')}
          </button>
        </div>
      </div>

      {/* Pending scheduled */}
      <div className="glass-soft rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-3">{t('broadcast.pendingTitle')}</h3>
        {pending.length === 0 ? (
          <p className="text-xs text-slate-400">{t('broadcast.noPending')}</p>
        ) : (
          <div className="space-y-2">
            {pending.map(p => (
              <div key={p.id} className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{p.title}</p>
                  <p className="text-xs text-slate-500 truncate">{p.body}</p>
                  <p className="text-[11px] text-affirm-600 font-medium mt-0.5">🕒 {fmt(p.sendAt)}</p>
                </div>
                <button onClick={() => cancelPending(p.id)} className="text-xs font-semibold text-red-500 hover:text-red-700 shrink-0 px-2 py-1">{t('broadcast.cancel')}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Automatic (Cloud Scheduler) notifications - editable text + on/off */}
      <div className="glass-soft rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-1">{t('broadcast.autoTitle')}</h3>
        <p className="text-xs text-slate-500 mb-3">{t('broadcast.autoHint')}</p>
        <div className="space-y-3">
          {AUTO_DEFS.map(def => <AutoNotifRow key={def.key} def={def} />)}
        </div>
      </div>
    </div>
  )
}

function LogsPanel() {
  const { t } = useLanguage()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'auth' | 'posts' | 'engagement' | 'admin'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Last 30 days of activity. The limit() stays as a hard ceiling so a very
    // busy month can't pull an unbounded collection into memory - raised to
    // 10000 because views are logged too (one per person per post), so the
    // older sign-ins / posts / likes aren't pushed out of the window by them.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const q = query(
      collection(db, 'activityLogs'),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'desc'),
      limit(10000)
    )
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)))
      setError('')
      setLoading(false)
    }, (err) => {
      // Surface the real reason rather than silently rendering an empty
      // state - an empty list and a permissions failure look identical to
      // the user otherwise, which makes this impossible to diagnose.
      setError(err?.message || String(err))
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // Full sentences rather than terse ALL-CAPS tags - the point of this page
  // is troubleshooting at a glance, so it should read like a story of what
  // happened, not a database dump.
  const ACTION_META: Record<string, { label: string; color: string; Icon: any }> = {
    signin: { label: t('logs.signin'), color: 'bg-blue-50 text-blue-600', Icon: LogOut },
    signup: { label: t('logs.signup'), color: 'bg-affirm-50 text-affirm-600', Icon: User },
    post_created: { label: t('logs.postCreated'), color: 'bg-affirm-50 text-affirm-600', Icon: PlusCircle },
    post_edited: { label: t('logs.postEdited'), color: 'bg-amber-50 text-amber-600', Icon: Pencil },
    post_deleted: { label: t('logs.postDeleted'), color: 'bg-red-50 text-red-600', Icon: Trash2 },
    church_approved: { label: t('logs.churchApproved'), color: 'bg-affirm-50 text-affirm-600', Icon: CheckCircle2 },
    church_denied: { label: t('logs.churchDenied'), color: 'bg-red-50 text-red-600', Icon: UserX },
    directory_synced: { label: t('logs.directorySynced'), color: 'bg-slate-100 text-slate-500', Icon: Church },
    like_added: { label: t('logs.likeAdded'), color: 'bg-rose-50 text-rose-600', Icon: Heart },
    like_removed: { label: t('logs.likeRemoved'), color: 'bg-slate-100 text-slate-500', Icon: Heart },
    comment_added: { label: t('logs.commentAdded'), color: 'bg-sky-50 text-sky-600', Icon: MessageCircle },
    post_view: { label: t('logs.postView'), color: 'bg-slate-100 text-slate-500', Icon: Eye },
  }

  const visible = useMemo(() => {
    let result = logs
    if (filter === 'auth') result = result.filter(l => ['signin', 'signup'].includes(l.action))
    else if (filter === 'posts') result = result.filter(l => l.action.startsWith('post_'))
    else if (filter === 'engagement') result = result.filter(l => l.action.startsWith('like_') || l.action.startsWith('comment_') || l.action === 'post_view')
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

  // Group by day so a long list reads as "what happened today / yesterday"
  // rather than an undifferentiated wall of rows.
  const grouped = useMemo(() => {
    const out: Record<string, ActivityLog[]> = {}
    for (const log of visible) {
      const key = dayLabel(log.createdAt, t)
      if (!out[key]) out[key] = []
      out[key].push(log)
    }
    return out
  }, [visible, t])

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('logs.searchPlaceholder')}
          className="w-full pl-11 pr-10 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
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
          { id: 'engagement', label: t('logs.engagementFilter') },
          { id: 'admin', label: t('logs.adminFilter') },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setFilter(tab.id)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition ${
              filter === tab.id
                ? 'bg-affirm-600 text-white border border-affirm-400/60'
                : 'glass-soft text-slate-600 hover:text-slate-900'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <p className="text-sm font-semibold text-red-700">{t('logs.loadFailed')}</p>
          <p className="text-xs text-red-600 mt-1.5 break-words">{error}</p>
          <p className="text-xs text-red-500 mt-3 leading-relaxed">{t('logs.rulesHint')}</p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-12 px-6 my-6 scrim">
          <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
            <ScrollText size={28} className="text-affirm-400" />
          </div>
          <p className="text-slate-800 font-medium">{t('logs.empty')}</p>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="space-y-5">
          {Object.entries(grouped).map(([dayLabel, dayLogs]) => (
            <div key={dayLabel}>
              <h3 className="text-xs font-bold text-on-bg uppercase tracking-wider mb-2 px-1">{dayLabel}</h3>
              <div className="glass rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                {dayLogs.map((log, i) => {
                  const meta = ACTION_META[log.action] || { label: log.action, color: 'bg-slate-100 text-slate-600', Icon: ScrollText }
                  const LogIcon = meta.Icon
                  return (
                    <div key={log.id} className={`flex gap-3 px-4 py-3.5 ${i !== dayLogs.length - 1 ? 'border-b border-slate-50' : ''}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}>
                        <LogIcon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{log.userName}</span>
                          <span className="text-[11px] text-slate-400 shrink-0">{log.userRole}</span>
                          <span className="text-[11px] text-slate-400 ml-auto shrink-0">{clockTime(log.createdAt)}</span>
                        </div>
                        <p className="text-[13px] text-slate-600 mt-0.5">{meta.label}</p>
                        {log.detail && (
                          <p className="text-xs text-slate-400 mt-1 break-words leading-relaxed">{log.detail}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AdminPanel({ pendingChurches, onApprove, onDeny }: {
  pendingChurches: AppUser[]
  onApprove: (uid: string) => void
  onDeny: (uid: string) => void
}) {
  const { t } = useLanguage()
  const [busyUid, setBusyUid] = useState<string | null>(null)

  const handle = async (uid: string, action: 'approve' | 'deny') => {
    setBusyUid(uid)
    try {
      if (action === 'approve') await onApprove(uid)
      else await onDeny(uid)
    } finally {
      setBusyUid(null)
    }
  }



  if (pendingChurches.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12 px-6 my-6 scrim">
          <div className="w-16 h-16 rounded-full bg-affirm-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={28} className="text-affirm-500" />
          </div>
          <p className="text-slate-800 font-medium">{t('admin.noPending')}</p>
          <p className="text-sm text-slate-400 mt-1">{t('admin.noPendingNote')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-on-bg px-1">{t('admin.pendingChurches')} ({pendingChurches.length})</h2>
      {pendingChurches.map(church => (
        <div key={church.uid} className="glass rounded-3xl p-5 shadow-sm border border-slate-100">
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-affirm-600 hover:bg-affirm-700 text-white text-sm font-semibold transition disabled:opacity-50">
              <CheckCircle2 size={16} /> {t('admin.approve')}
            </button>
            <button onClick={() => handle(church.uid, 'deny')} disabled={busyUid === church.uid}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition disabled:opacity-50">
              <UserX size={16} /> {t('admin.deny')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function PostCard({ post, onLike, onOpenComments, currentUser, isLiked, onEdit, onDelete, onOpenProfile, onOpenGroup }: {
  post: Post
  onLike: (id: string) => Promise<void>
  onOpenComments: (id: string) => void
  currentUser: AppUser
  isLiked: boolean
  onEdit: (post: Post) => void
  onDelete: (id: string) => void | Promise<void>
  onOpenProfile?: (uid: string) => void
  onOpenGroup?: (groupId: string) => void
}) {
  const { t } = useLanguage()
  const currentUserUid = currentUser.uid
  const [reporting, setReporting] = useState(false)
  const ytId = post.mediaUrl ? getYoutubeId(post.mediaUrl) : null
  const ytList = post.mediaUrl ? getYoutubePlaylistId(post.mediaUrl) : null
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [likeError, setLikeError] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const player = useMediaPlayer()

  // Play the on-device copy when this audio has been saved offline; otherwise
  // stream. Resolved ahead of the tap so playback stays inside the user
  // gesture the browser requires.
  const [audioSrc, setAudioSrc] = useState(post.mediaUrl || '')
  useEffect(() => {
    if (post.type !== 'audio' || !post.mediaUrl) return
    let alive = true
    getOfflineSrc(post.id).then(s => { if (alive && s) setAudioSrc(s) })
    return () => { alive = false }
  }, [post.id, post.type, post.mediaUrl])

  const handleShare = async () => {
    const shareUrl = `https://ccelim.com/?post=${post.id}`
    const shareTitle = post.authorName || post.churchName || 'ELIM'
    const shareText = (post.content || '').slice(0, 160)

    try {
      // Native share sheet on Android/iOS.
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: shareTitle, text: shareText, url: shareUrl })
      } else if (navigator.share) {
        // Web Share API where supported (most mobile browsers).
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl })
      } else {
        // Desktop browsers: copy to clipboard and confirm visually.
        await navigator.clipboard.writeText(shareUrl)
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      }
      // Reached only when the share/copy resolved (a cancelled share sheet
      // throws and skips this): record it so the count reflects a real share.
      recordPostShare(post.id, currentUserUid)
    } catch {
      // User dismissing the share sheet throws too - not worth surfacing
      // as an error, so this stays silent.
    }
  }

  const isOwner = post.churchId === currentUserUid

  // Attribution shown on the card. A group post leads with the GROUP name and
  // shows the author small — unless the author is a featured lead (the pastor),
  // whose own name leads instead, with the group as the subtitle. Posts with no
  // group keep the original author-first layout.
  const author = post.authorName || post.churchName || t('common.church')
  // Prefix the author with their title in the group (e.g. "Docteur", "Pasteur").
  const titledAuthor = post.authorTitle ? `${post.authorTitle} ${author}` : author
  let bigName: string, subName: string, headAvatar: string | undefined, headInitial: string
  // When the header stands for the GROUP (not a featured person), its name backs
  // the built-in ministry logo shown in place of a plain initial.
  let headGroupName: string | undefined
  if (post.groupId && post.groupName) {
    if (post.featured) {
      // Pastor-forward: their own (titled) name and photo lead, group as subtitle.
      bigName = titledAuthor; subName = post.groupName; headInitial = author.charAt(0)
      headAvatar = post.churchAvatar || post.groupAvatar || undefined
    } else {
      bigName = post.groupName; subName = post.authorName ? titledAuthor : ''; headInitial = post.groupName.charAt(0)
      headAvatar = post.groupAvatar || undefined
      headGroupName = post.groupName
    }
  } else {
    headAvatar = post.churchAvatar
    bigName = author
    subName = post.authorName ? (post.churchName || CHURCH_NAME) : ''
    headInitial = (post.authorName || post.churchName || 'C').charAt(0)
  }

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

  // Count a view once the card has been meaningfully on screen for ~1.2s,
  // rather than on every scroll-past. A ratio test alone fails for posts taller
  // than the screen (their ratio can never reach a high threshold), so we also
  // accept a decent visible height. recordPostView is idempotent per device and
  // skips the author, so this only ever writes once.
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(entries => {
      const e = entries[0]
      const seen = e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= 200)
      if (seen) {
        if (!timer) timer = setTimeout(() => {
          recordPostView(post.id, currentUserUid).then(wrote => {
            // Log the view once (first time on this device) so it shows in the
            // admin activity log alongside likes and comments.
            if (wrote) logActivity(currentUser, 'post_view', (post.content || post.churchName || '').slice(0, 60))
          })
          io.disconnect()
        }, 1200)
      } else if (timer) { clearTimeout(timer); timer = null }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] })
    io.observe(el)
    return () => { if (timer) clearTimeout(timer); io.disconnect() }
  }, [post.id, currentUserUid, post.authorId, post.churchId])

  // "Awa and 4 others like this" — social proof from the real like count plus
  // the denormalized most-recent liker. The current user is named first ("You")
  // when they're among the likers. Shown ONLY when we actually have a name;
  // with no name it would just repeat the heart's number, so we show nothing
  // extra and let the heart button carry the count.
  const likeCount = post.likes || 0
  const others = likeCount - 1
  const fillName = (k: string, name?: string) =>
    t(k as any).replace('{count}', String(others)).replace('{name}', name || '')
  let likeLine = ''
  if (likeCount > 0) {
    if (isLiked) {
      likeLine = likeCount === 1 ? t('post.likeYou')
        : fillName(others === 1 ? 'post.likeYouOther' : 'post.likeYouOthers')
    } else if (post.lastLikeName) {
      likeLine = likeCount === 1 ? fillName('post.likeName', post.lastLikeName)
        : fillName(others === 1 ? 'post.likeNameOther' : 'post.likeNameOthers', post.lastLikeName)
    }
  }
  const viewCount = post.views || 0

  // Tapping the header opens the GROUP popup when the header stands for a group
  // (a non-featured group post, where the big name is the group), otherwise the
  // author's member profile.
  const openHeader = () => {
    if (headGroupName && post.groupId && onOpenGroup) { onOpenGroup(post.groupId); return }
    const u = post.authorId || post.churchId
    if (u && onOpenProfile) onOpenProfile(u)
  }

  return (
    <article ref={cardRef} className="glass rounded-3xl shadow-sm border border-slate-100/80 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <button type="button" onClick={openHeader}
          className="shrink-0" aria-label={bigName}>
          {headAvatar ? (
            <img src={headAvatar} alt="" className="w-11 h-11 rounded-full object-cover" />
          ) : headGroupName && groupLogoKind(headGroupName) ? (
            <GroupLogo name={headGroupName} size={44} />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
              {headInitial}
            </div>
          )}
        </button>
        <div className="flex-1 min-w-0">
          {/* Group name (or author) leads; the smaller line carries the other. */}
          <h3 onClick={openHeader}
            className="font-semibold text-slate-900 truncate cursor-pointer">
            {bigName}
          </h3>
          <p className="text-xs text-slate-400 truncate">
            {subName ? `${subName} · ` : ''}{timeAgo(post.createdAt)}
          </p>
        </div>
        {isOwner && (
          confirmingDelete ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button disabled={deleting} onClick={async () => {
                setDeleting(true)
                try {
                  // Await before collapsing the confirm UI: a failed delete
                  // used to look successful because the button vanished
                  // regardless of the write's outcome.
                  await onDelete(post.id)
                } catch {
                  setDeleting(false)
                  setConfirmingDelete(false)
                }
              }}
                className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-full transition disabled:opacity-50">
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
                className="p-2 rounded-full text-slate-300 hover:text-affirm-600 hover:bg-affirm-50 transition">
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
          <AutoTranslate text={post.content}
            textClass="text-slate-800 text-base leading-relaxed whitespace-pre-wrap" />
        </div>
      )}

      {/* Media */}
      {post.type === 'text-image' && post.mediaUrl && (
        // object-contain, not object-cover: posters and flyers are usually
        // portrait, and cover cropped the top and bottom off them. The tinted
        // backdrop means the letterboxing on very tall or very wide images
        // reads as deliberate rather than as a gap.
        <div className="w-full bg-slate-100 flex items-center justify-center">
          <img src={post.mediaUrl} alt="" onClick={() => setLightbox(post.mediaUrl!)}
            className="w-full max-h-[75vh] object-contain cursor-zoom-in" />
        </div>
      )}

      {post.type === 'youtube' && (ytId || ytList) && (
        <div className="relative aspect-video bg-black">
          <iframe
            src={
              ytId
                ? `https://www.youtube.com/embed/${ytId}${ytList ? `?list=${ytList}` : ''}`
                : `https://www.youtube.com/embed/videoseries?list=${ytList}`
            }
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {post.type === 'youtube' && post.mediaUrl && !ytId && !ytList && (
        <div className="bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-red-600 mb-2">
            <Youtube size={18} />
            <span className="text-sm font-medium">YouTube Video</span>
          </div>
          <a href={post.mediaUrl} target="_blank" rel="noreferrer"
            className="text-sm text-affirm-600 underline break-all">{post.mediaUrl}</a>
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
            <div className="w-full bg-slate-100 rounded-2xl mb-3 flex items-center justify-center overflow-hidden">
              <img src={post.coverUrl} alt="" onClick={() => setLightbox(post.coverUrl!)}
                className="w-full max-h-56 object-contain cursor-zoom-in" />
            </div>
          )}
          <button
            onClick={() => {
              // Hands off to the app-wide player, which lives above the tab
              // switcher - so changing tabs no longer destroys the element
              // and restarts the sermon from zero.
              if (player.isCurrent(post.id)) player.toggle()
              else player.play({
                id: post.id,
                url: audioSrc || post.mediaUrl!,
                title: post.content?.slice(0, 60) || 'Audio',
                artist: post.authorName || post.churchName || 'ELIM',
                artwork: post.coverUrl || undefined
              })
            }}
            className="w-full flex items-center gap-3 bg-slate-50 hover:bg-slate-100 rounded-2xl px-4 py-3 transition text-left">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              player.isCurrent(post.id) ? 'bg-affirm-600 text-white' : 'bg-affirm-100 text-affirm-600'}`}>
              {player.isCurrent(post.id) && player.playing ? <Pause size={17} /> : <Play size={17} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {player.isCurrent(post.id) ? t('player.nowPlaying') : t('player.listen')}
              </p>
              <p className="text-[11px] text-slate-400">{post.authorName || post.churchName || 'ELIM'}</p>
            </div>
          </button>
          <div className="mt-2 flex justify-end">
            <OfflineButton id={post.id} url={post.mediaUrl} kind="audio"
              title={post.content?.slice(0, 60) || 'Audio'} />
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

      <div className="px-4 py-3 border-t border-slate-50">
        <div className="flex items-center justify-between">
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
              className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-affirm-600">
              <MessageCircle size={18} />
              {post.commentsCount || 0}
            </button>
            {/* Always shown so every post carries the view icon, even at 0. */}
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-400" title={t('post.views')}>
              <Eye size={18} /> {viewCount.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {post.mediaUrl && ['text-image', 'audio', 'video', 'document'].includes(post.type) && (
              <button onClick={() => downloadMedia(post.mediaUrl!, fileNameFor(post))}
                aria-label={t('post.download')}
                className="text-slate-300 hover:text-affirm-600">
                <Download size={18} />
              </button>
            )}
            {post.churchId !== currentUserUid && (
              <button onClick={() => setReporting(true)} aria-label={t('report.action')} title={t('report.action')}
                className="text-slate-300 hover:text-affirm-600">
                <Flag size={17} />
              </button>
            )}
            <button onClick={handleShare} className="relative flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-affirm-600">
              <Share2 size={18} />
              {(post.shares || 0) > 0 && <span className="text-slate-400">{post.shares}</span>}
              {shareCopied && (
                <span className="absolute -top-8 right-0 text-[11px] font-medium text-affirm-700 bg-affirm-50 rounded-full px-2.5 py-1 whitespace-nowrap">
                  {t('post.linkCopied')}
                </span>
              )}
            </button>
          </div>
        </div>
        {/* Simple social-proof text under the like button: "Awa aime cette
            publication" / "Awa et N autres…". Only when a liker name is known. */}
        {likeLine && <p className="text-[12px] text-slate-500 mt-2">{likeLine}</p>}
      </div>
      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {reporting && (
        <ReportSheet user={currentUser} targetType="post" targetId={post.id}
          targetOwnerId={post.churchId} targetOwnerName={post.authorName || post.churchName}
          preview={post.content} onClose={() => setReporting(false)} />
      )}
    </article>
  )
}

const UPLOAD_RULES: Record<string, { accept: string; maxMB: number; check: (f: File) => boolean; label: string }> = {
  'text-image': { accept: 'image/jpeg,image/png,image/webp,image/gif', maxMB: 10, check: f => f.type.startsWith('image/'), label: 'a photo' },
  audio: { accept: 'audio/*,.m4a', maxMB: 100, check: f => f.type.startsWith('audio/'), label: 'an audio file' },
  video: { accept: 'video/mp4,video/webm,video/quicktime', maxMB: 200, check: f => f.type.startsWith('video/'), label: 'a video' },
  document: { accept: 'application/pdf', maxMB: 20, check: f => f.type === 'application/pdf', label: 'a PDF' },
}


// Bulk add for music. Tapping through a modal 200 times is not a workflow, so
// this takes many lines at once in the form:
//     Song title | https://youtube.com/watch?v=...
// The title is kept as the post's text, which is what makes each entry
// searchable and readable rather than a bare embed.
function BulkMusicModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { t } = useLanguage()
  const [raw, setRaw] = useState('')
  const [category, setCategory] = useState(MUSIQUE_CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [error, setError] = useState('')

  // Parsed up front so the count and any bad lines are visible BEFORE
  // anything is written - 200 posts is not something to discover was wrong
  // afterwards.
  const parsed = useMemo(() => {
    const rows: { title: string; url: string }[] = []
    const bad: string[] = []
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim()
      if (!trimmed) return
      const sep = trimmed.lastIndexOf('|')
      const title = sep > -1 ? trimmed.slice(0, sep).trim() : ''
      const url = sep > -1 ? trimmed.slice(sep + 1).trim() : trimmed
      if (!getYoutubeId(url) && !getYoutubePlaylistId(url)) { bad.push(trimmed.slice(0, 60)); return }
      rows.push({ title: title || url, url })
    })
    return { rows, bad }
  }, [raw])

  const submit = async () => {
    if (parsed.rows.length === 0 || busy) return
    setBusy(true); setError(''); setDone(0)
    try {
      for (const row of parsed.rows) {
        await addDoc(collection(db, 'posts'), {
          churchId: user.uid,
          churchName: user.churchName || CHURCH_NAME,
          authorId: user.uid,
          authorName: user.displayName,
          churchAvatar: user.avatar || null,
          type: 'youtube',
          content: row.title,
          mediaUrl: row.url,
          coverUrl: null,
          fileName: null,
          likes: 0,
          commentsCount: 0,
          section: 'musique',
          category,
          createdAt: serverTimestamp()
        })
        setDone(d => d + 1)
      }
      logActivity(user, 'post_created', `Musique: ${parsed.rows.length} titres`)
      onClose()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-lg text-slate-900">{t('musique.bulkTitle')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">{t('musique.bulkHint')}</p>

          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
            {MUSIQUE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>

          <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={10}
            placeholder={"Titre du chant | https://www.youtube.com/watch?v=..."}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[13px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-affirm-400" />

          {parsed.rows.length > 0 && (
            <p className="text-xs text-affirm-700 bg-affirm-50 rounded-xl px-3 py-2">
              {parsed.rows.length} {t('musique.readyToAdd')}
            </p>
          )}
          {parsed.bad.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              <p className="font-semibold">{parsed.bad.length} {t('musique.skipped')}</p>
              {parsed.bad.slice(0, 3).map((b, i) => <p key={i} className="truncate opacity-80">{b}</p>)}
            </div>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 break-words">{error}</p>}

          <button onClick={submit} disabled={parsed.rows.length === 0 || busy}
            className="w-full py-3.5 rounded-2xl bg-affirm-600 hover:bg-affirm-700 disabled:opacity-40 text-white font-semibold text-sm transition">
            {busy ? `${t('musique.adding')} ${done}/${parsed.rows.length}` : `${t('musique.addAll')} (${parsed.rows.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreatePostModal({ onClose, onSubmit, uploaderUid, section = 'feed', myGroups = [] }: {
  onClose: () => void
  onSubmit: (data: { type: Post['type']; content: string; mediaUrl?: string; coverUrl?: string; fileName?: string; section?: 'feed' | 'sante' | 'musique'; category?: string; groupId?: string }) => void | Promise<void>
  uploaderUid: string
  section?: 'feed' | 'sante' | 'musique'
  myGroups?: Group[]
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
  const [publishing, setPublishing] = useState(false)
  const [santeCategory, setSanteCategory] = useState(SANTE_CATEGORIES[0])
  // Only offer groups relevant to THIS surface: health posts under groups with
  // the health permission, feed/music under groups with the posting permission.
  // So a doctor-and-pastor picks "Docteurs" in health and "Pasteurs" in the feed.
  const pickGroups = useMemo(
    () => myGroups.filter(g => section === 'sante' ? !!g.perms?.sante : !!g.perms?.post),
    [myGroups, section])
  // Which group to publish under. Preselect when there is exactly one option;
  // with several they choose one (or "just me").
  const [groupId, setGroupId] = useState(() => pickGroups.length === 1 ? pickGroups[0].id : '')

  // Upload lifecycle. activeTask is the running UploadTask (so we can cancel it
  // if the person closes or switches type mid-upload); orphanRef points at a
  // finished upload that isn't attached to a published post yet, so we can
  // delete it instead of leaving it stranded in Storage. mounted guards the
  // async callbacks from setState-ing after the modal is gone.
  const mounted = useRef(true)
  const activeTask = useRef<ReturnType<typeof uploadBytesResumable> | null>(null)
  const orphanRef = useRef<ReturnType<typeof ref> | null>(null)

  // Cancel a running upload and delete a finished-but-unpublished one. Called
  // when the person replaces the file, switches post type, or closes the modal.
  const discardPendingUpload = () => {
    if (activeTask.current) { try { activeTask.current.cancel() } catch { /* already settled */ } activeTask.current = null }
    if (orphanRef.current) { deleteObject(orphanRef.current).catch(() => {}); orphanRef.current = null }
  }

  useEffect(() => () => { mounted.current = false; discardPendingUpload() }, [])

  const handleClose = () => { discardPendingUpload(); onClose() }

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
    // Replacing a file: cancel any running upload and drop the previous
    // orphan so we don't leave the old one stranded in Storage.
    discardPendingUpload()
    setUploading(true)
    setUploadProgress(0)
    const storageRef = ref(storage, `post-media/${uploaderUid}/${Date.now()}-${file.name}`)
    const task = uploadBytesResumable(storageRef, file)
    activeTask.current = task
    task.on('state_changed',
      snap => { if (mounted.current) setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)) },
      err => {
        activeTask.current = null
        // A cancel (from close/replace/type-switch) surfaces here too; that's
        // not an error worth showing.
        if (err.code === 'storage/canceled') return
        if (mounted.current) { setUploadError(err.message || 'Upload failed'); setUploading(false) }
      },
      async () => {
        activeTask.current = null
        // Finished but not yet published: track it so it can be cleaned up if
        // the person walks away or replaces it.
        orphanRef.current = storageRef
        const url = await getDownloadURL(storageRef)
        if (mounted.current) { setMediaUrl(url); setFileName(file.name); setUploading(false) }
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
          <h2 className="font-bold text-lg">{section === 'sante' ? t('sante.newTip') : t('post.new')}</h2>
          <button onClick={async () => {
            if (content.trim() && !uploading && !publishing) {
              setPublishing(true)
              setUploadError('')
              try {
                // Await the write and only close on success - closing first
                // meant a failed publish silently discarded the typed post.
                await onSubmit({
                  type, content: content.trim(),
                  mediaUrl: mediaUrl || undefined,
                  coverUrl: (type === 'audio' && coverUrl) ? coverUrl : undefined,
                  fileName: (type === 'document' && fileName) ? fileName : undefined,
                  section,
                  ...(section === 'sante' ? { category: santeCategory } : {}),
                  ...(groupId ? { groupId } : {})
                })
                // Published: the upload is now attached to a post, so don't
                // let the cleanup delete it on unmount.
                orphanRef.current = null
                onClose()
              } catch (err: any) {
                setUploadError(err?.message || t('post.publishFailed'))
                setPublishing(false)
              }
            }
          }}
            disabled={!content.trim() || uploading || publishing}
            className="text-affirm-600 font-semibold disabled:opacity-40">{t('post.publish')}</button>
        </div>

        <div className="p-5 space-y-5">
          {section === 'sante' && (
            <select value={santeCategory} onChange={e => setSanteCategory(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
              {SANTE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          )}

          {pickGroups.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('groups.publishUnder')}</label>
              <select value={groupId} onChange={e => setGroupId(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400">
                <option value="">{t('groups.justMe')}</option>
                {pickGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}

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
              <button key={opt.id} onClick={() => { discardPendingUpload(); setType(opt.id as Post['type']); setMediaUrl(''); setFileName(''); setUploadError(''); setUploading(false) }}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition ${
                  type === opt.id ? 'border-affirm-500 bg-affirm-50 text-affirm-700' : 'border-slate-100 text-slate-400'}`}>
                <opt.icon size={20} />
                <span className="text-[11px] font-medium">{opt.label}</span>
              </button>
            ))}
          </div>

          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder={t('post.contentPlaceholder')}
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 resize-none text-[15px]" />

          {canUploadDirectly && rule && (
            <div>
              <label className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed transition cursor-pointer ${
                mediaUrl && fileName ? 'border-affirm-300 bg-affirm-50' : 'border-slate-200 hover:border-affirm-300 hover:bg-slate-50'}`}>
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-affirm-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-500">{t('post.uploading')} {uploadProgress}%</span>
                  </>
                ) : mediaUrl && fileName ? (
                  <>
                    <CheckCircle2 size={22} className="text-affirm-500" />
                    <span className="text-xs text-slate-600 font-medium px-4 text-center break-all">{fileName}</span>
                    <span className="text-[11px] text-affirm-600">{t('post.tapToReplace')}</span>
                  </>
                ) : (
                  <>
                    <Upload size={22} className="text-slate-400" />
                    <span className="text-xs text-slate-300 font-medium">
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
            className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-affirm-400" />

          {type === 'audio' && (
            <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)}
              placeholder={t('post.pasteCoverUrl')}
              className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-affirm-400" />
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
      <div className="glass-bar w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
          <h2 className="font-bold text-lg">{t('post.edit')}</h2>
          <button onClick={handleSave} disabled={!content.trim() || saving}
            className="text-affirm-600 font-semibold disabled:opacity-40">
            {saving ? t('post.saving') : t('post.save')}
          </button>
        </div>
        <div className="p-5">
          <textarea value={content} onChange={e => setContent(e.target.value)}
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-affirm-400 resize-none text-[15px]" />
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

function CommentRow({ c, isReply, liked, likeCount, onLike, onReply, onReport, canReport, avatar, onOpenProfile, t }: {
  c: Comment
  isReply: boolean
  liked: boolean
  likeCount: number
  onLike: () => void
  onReply: (c: Comment) => void
  onReport: (c: Comment) => void
  canReport: boolean
  // The commenter's CURRENT profile picture (resolved live), so the same person
  // always shows the same avatar across all their comments — not the one frozen
  // on the comment when it was written.
  avatar?: string | null
  onOpenProfile?: (uid: string) => void
  t: (k: any) => string
}) {
  const pic = avatar || c.userAvatar
  const openProfile = () => { if (c.userId && onOpenProfile) onOpenProfile(c.userId) }
  return (
    <div className={`flex gap-3 ${isReply ? 'ml-11' : ''}`}>
      <button type="button" onClick={openProfile} className="shrink-0" aria-label={c.userName}>
        {pic
          ? <img src={pic} alt="" className="w-9 h-9 rounded-full object-cover" />
          : <div className="w-9 h-9 rounded-full bg-affirm-100 flex items-center justify-center text-affirm-700 font-semibold text-sm">
              {c.userName.charAt(0)}
            </div>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="bg-slate-50 rounded-2xl px-3.5 py-2.5">
          <button type="button" onClick={openProfile} className="text-sm font-semibold text-slate-800 text-left hover:underline">{c.userName}</button>
          {c.mentionNames && c.mentionNames.length > 0 && (
            <p className="text-sm font-semibold text-blue-600 break-words leading-snug">
              {c.mentionNames.map(n => `@${n}`).join(' ')}
            </p>
          )}
          {c.text && <AutoTranslate text={c.text}
            textClass="text-sm text-slate-600 break-words whitespace-pre-wrap" />}
        </div>
        <div className="flex items-center gap-4 mt-1 ml-1">
          <span className="text-[11px] text-slate-400">{timeAgo(c.createdAt)}</span>
          <button type="button" onClick={onLike} aria-label={t('comments.like')}
            className={`flex items-center gap-1 text-[11px] font-semibold transition active:scale-95 ${liked ? 'text-rose-500' : 'text-slate-400 hover:text-slate-600'}`}>
            <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>
          <button type="button" onClick={() => onReply(c)}
            className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition">
            {t('comments.reply')}
          </button>
          {canReport && (
            <button type="button" onClick={() => onReport(c)}
              className="text-[11px] font-semibold text-slate-400 hover:text-affirm-600 transition">
              {t('report.action')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Tap-to-view profile: a member's photo, name, title/profession and the church
// departments they serve in. Fetched on open via a callable (members can't read
// the users collection directly), showing only what's safe to share.
function ProfilePopup({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { t } = useLanguage()
  const [p, setP] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  useBackHandler(true, onClose)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchMemberProfile(uid).then(r => { if (alive) { setP(r); setLoading(false) } })
    return () => { alive = false }
  }, [uid])
  const roleLabel = p?.role === 'pastor' ? t('role.pastor')
    : p?.role === 'admin' ? t('role.admin')
    : p?.role === 'church' ? t('role.church') : ''
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400"><X size={18} /></button>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : !p || !p.found ? (
          <p className="py-12 text-center text-sm text-slate-500">{t('profileCard.notFound')}</p>
        ) : (
          <div className="text-center">
            {p.avatar
              ? <img src={p.avatar} alt="" className="w-24 h-24 rounded-full object-cover mx-auto" />
              : <div className="w-24 h-24 rounded-full bg-affirm-100 text-affirm-700 font-bold text-3xl flex items-center justify-center mx-auto">{(p.name || '?').charAt(0)}</div>}
            <h3 className="mt-4 text-xl font-bold text-slate-900 break-words">{p.name}</h3>
            {(roleLabel || p.profession) && (
              <p className="mt-1 text-sm text-slate-500">{[roleLabel, p.profession].filter(Boolean).join(' · ')}</p>
            )}
            {p.interests && p.interests.length > 0 && (
              <>
                <p className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('auth.interests')}</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {p.interests.map(i => (
                    <span key={i} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
                      <TValue text={i} source="fr" />
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Popup shown when a member taps a group's name/photo on one of its posts:
// the group's photo (or built-in ministry logo), name and description. Groups
// are world-readable (firestore.rules), so this reads the doc directly.
function GroupPopup({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const [g, setG] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  useBackHandler(true, onClose)
  useEffect(() => {
    let alive = true
    setLoading(true)
    getDoc(doc(db, 'groups', groupId))
      .then(s => {
        if (!alive) return
        if (s.exists()) {
          const v = s.data() as any
          setG({ id: s.id, name: v.name || '', avatar: v.avatar || undefined, description: v.description || undefined, leads: {}, leadIds: [] })
        } else setG(null)
        setLoading(false)
      })
      .catch(() => { if (alive) { setG(null); setLoading(false) } })
    return () => { alive = false }
  }, [groupId])
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400"><X size={18} /></button>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : !g ? (
          <p className="py-12 text-center text-sm text-slate-500">{t('profileCard.notFound')}</p>
        ) : (
          <div className="text-center">
            {g.avatar
              ? <img src={g.avatar} alt="" className="w-24 h-24 rounded-full object-cover mx-auto" />
              : groupLogoKind(g.name)
                ? <div className="mx-auto w-fit"><GroupLogo name={g.name} size={96} /></div>
                : <div className="w-24 h-24 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 text-white font-bold text-3xl flex items-center justify-center mx-auto">{(g.name || 'G').charAt(0)}</div>}
            <h3 className="mt-4 text-xl font-bold text-slate-900 break-words">{g.name}</h3>
            {g.description && (
              <p className="mt-3 text-sm text-slate-600 whitespace-pre-line break-words">{g.description}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Height (px) the on-screen keyboard is covering, from the VisualViewport API.
// Used to lift bottom sheets above the keyboard so their input isn't hidden
// behind it — the software keyboard doesn't move `position: fixed` elements on
// its own in the WebView.
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onChange = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', onChange)
    vv.addEventListener('scroll', onChange)
    onChange()
    return () => { vv.removeEventListener('resize', onChange); vv.removeEventListener('scroll', onChange) }
  }, [])
  return inset
}

function CommentsSheet({ postId, comments, postAuthor, onClose, onAdd, onLikeComment, likedCommentIds, currentUser, onOpenProfile }: {
  postId: string
  comments: Comment[]
  postAuthor: { uid: string; name: string } | null
  onClose: () => void
  onAdd: (text: string, parentId?: string, mentions?: { uid: string; name: string }[]) => void | Promise<void>
  onLikeComment: (commentId: string) => void
  likedCommentIds: Set<string>
  currentUser: AppUser
  onOpenProfile: (uid: string) => void
}) {
  const { t } = useLanguage()
  const kbInset = useKeyboardInset()
  const [reportingComment, setReportingComment] = useState<Comment | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // People tagged in the comment being written, shown as blue removable chips.
  const [mentions, setMentions] = useState<{ uid: string; name: string }[]>([])
  // Everyone in the app can be @mentioned. The full name list comes from a
  // callable (members can't read the users collection directly); the post
  // author + commenters are merged in as a fallback so mentions still work if
  // that call is slow or offline.
  const [allMembers, setAllMembers] = useState<{ uid: string; name: string; avatar?: string | null }[]>([])
  useEffect(() => { fetchMemberNames().then(setAllMembers).catch(() => {}) }, [])
  // uid -> current profile picture, so every comment by a person shows the same
  // (live) avatar rather than the one frozen on the comment when it was written.
  const avatarByUid = useMemo(() => {
    const m = new Map<string, string>()
    if (currentUser.avatar) m.set(currentUser.uid, currentUser.avatar)
    allMembers.forEach(x => { if (x.avatar) m.set(x.uid, x.avatar) })
    return m
  }, [allMembers, currentUser.uid, currentUser.avatar])
  const mentionCandidates = useMemo(() => {
    const map = new Map<string, string>()   // uid -> name
    if (postAuthor?.uid && postAuthor.name) map.set(postAuthor.uid, postAuthor.name)
    comments.forEach(c => { if (c.userId && c.userName) map.set(c.userId, c.userName) })
    allMembers.forEach(m => { if (m.uid && m.name) map.set(m.uid, m.name) })
    map.delete(currentUser.uid)              // don't tag yourself
    return [...map.entries()].map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [comments, postAuthor, allMembers, currentUser.uid])
  // The active "@query" the caret is sitting in, or null. Drives the picker.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const mentionMatches = mentionQuery === null ? []
    : mentionCandidates
        .filter(c => !mentions.some(m => m.uid === c.uid))
        .filter(c => norm(c.name).includes(norm(mentionQuery)))
        .slice(0, 25)

  const autoGrow = () => {
    const el = inputRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px' }
  }
  // Recompute the active @token from the text up to the caret.
  const onType = (value: string) => {
    setText(value)
    requestAnimationFrame(autoGrow)
    const caret = inputRef.current?.selectionStart ?? value.length
    const m = /@([^@\n]{0,40})$/.exec(value.slice(0, caret))
    setMentionQuery(m ? m[1] : null)
  }
  // Picking a name turns the half-typed "@query" into a blue chip above the box
  // (removable as a whole) rather than leaving plain "@Name" text in the field.
  const pickMention = (c: { uid: string; name: string }) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@([^@\n]{0,40})$/, '')
    const next = before + text.slice(caret)
    setText(next)
    setMentions(prev => prev.some(m => m.uid === c.uid) ? prev : [...prev, c])
    setMentionQuery(null)
    requestAnimationFrame(() => { el?.focus(); const p = before.length; el?.setSelectionRange(p, p); autoGrow() })
  }
  const removeMention = (uid: string) => setMentions(prev => prev.filter(m => m.uid !== uid))
  // Optimistic like overrides keyed by commentId, so the heart responds on tap
  // instead of waiting for the server round-trip. Reverted if the write fails.
  const [likeOverride, setLikeOverride] = useState<Record<string, boolean>>({})
  const [likeError, setLikeError] = useState('')

  const isLiked = (c: Comment) => likeOverride[c.id] ?? likedCommentIds.has(c.id)
  const likeCount = (c: Comment) => {
    const base = c.likes || 0
    const wasLiked = likedCommentIds.has(c.id)
    const nowLiked = likeOverride[c.id]
    if (nowLiked === undefined || nowLiked === wasLiked) return base
    return Math.max(0, base + (nowLiked ? 1 : -1))
  }
  const toggleLike = async (c: Comment) => {
    const next = !isLiked(c)
    setLikeError('')
    setLikeOverride(o => ({ ...o, [c.id]: next }))
    try {
      await onLikeComment(c.id)
    } catch {
      setLikeOverride(o => { const n = { ...o }; delete n[c.id]; return n })
      setLikeError(t('comments.likeFailed'))
    }
  }

  const all = comments.filter(c => c.postId === postId)
  const topLevel = all.filter(c => !c.parentId)
  // Replies grouped under their top-level parent, preserving the createdAt-asc
  // order the global comments subscription already delivers.
  const repliesByParent: Record<string, Comment[]> = {}
  all.forEach(c => { if (c.parentId) (repliesByParent[c.parentId] ||= []).push(c) })

  const submit = async () => {
    const value = text.trim()
    // A comment needs some text OR at least one tag to be worth sending.
    if ((!value && mentions.length === 0) || sending) return
    const parentId = replyTo?.id
    const tagged = mentions
    setText('')
    setMentions([])
    setMentionQuery(null)
    setSending(true)
    try {
      await onAdd(value, parentId, tagged)
      setReplyTo(null)
      requestAnimationFrame(autoGrow)
    } catch {
      setText(value); setMentions(tagged)   // restore on failure
    } finally {
      setSending(false)
    }
  }

  // Replies stay one level deep: replying to a reply attaches to the same
  // top-level parent, but the chip still names the person being answered.
  const startReply = (c: Comment) => setReplyTo({ id: c.parentId || c.id, name: c.userName })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end"
      style={{ bottom: kbInset }}>
      <div className="glass-bar w-full max-w-lg mx-auto rounded-t-3xl max-h-[75vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold">{t('comments.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {topLevel.length === 0 && <p className="text-center text-slate-400 text-sm py-10">{t('comments.none')}</p>}
          {topLevel.map(c => (
            <div key={c.id} className="space-y-3">
              <CommentRow c={c} isReply={false} liked={isLiked(c)} likeCount={likeCount(c)}
                onLike={() => toggleLike(c)} onReply={startReply}
                onReport={setReportingComment} canReport={c.userId !== currentUser.uid}
                avatar={c.userId ? avatarByUid.get(c.userId) : undefined} onOpenProfile={onOpenProfile} t={t} />
              {(repliesByParent[c.id] || []).map(r => (
                <CommentRow key={r.id} c={r} isReply liked={isLiked(r)} likeCount={likeCount(r)}
                  onLike={() => toggleLike(r)} onReply={startReply}
                  onReport={setReportingComment} canReport={r.userId !== currentUser.uid}
                  avatar={r.userId ? avatarByUid.get(r.userId) : undefined} onOpenProfile={onOpenProfile} t={t} />
              ))}
            </div>
          ))}
        </div>
        <div className="px-4 pt-4 border-t border-slate-100"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          {likeError && (
            <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-1.5 mb-2">{likeError}</p>
          )}
          {replyTo && (
            <div className="flex items-center justify-between px-3 pb-2 text-xs text-slate-500">
              <span className="truncate">{t('comments.replyingTo')} <b className="text-slate-700">{replyTo.name}</b></span>
              <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-600 shrink-0 ml-2">
                {t('post.cancel')}
              </button>
            </div>
          )}
          {/* @mention picker — a compact card that sits just above the box. */}
          {mentionMatches.length > 0 && (
            <div className="mb-2 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
              <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('comments.mentionTitle')}</p>
              <div className="max-h-40 overflow-y-auto pb-1">
                {mentionMatches.map(c => (
                  <button key={c.uid} type="button" onMouseDown={e => { e.preventDefault(); pickMention(c) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-affirm-500/10">
                    <span className="w-7 h-7 rounded-full bg-affirm-100 flex items-center justify-center text-affirm-700 font-semibold text-xs shrink-0">{c.name.charAt(0)}</span>
                    <span className="text-sm text-slate-700 truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Chosen tags — blue, each removable as a whole. */}
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {mentions.map(m => (
                <span key={m.uid} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-semibold">
                  @{m.name}
                  <button type="button" onClick={() => removeMention(m.uid)} aria-label="×"
                    className="w-4 h-4 rounded-full hover:bg-blue-200 flex items-center justify-center">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea ref={inputRef} value={text} rows={1}
              onChange={e => onType(e.target.value)}
              onKeyUp={e => onType((e.target as HTMLTextAreaElement).value)}
              placeholder={replyTo ? t('comments.replyPlaceholder') : t('comments.writePlaceholder')}
              className="flex-1 bg-slate-100 rounded-3xl px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-affirm-400 resize-none max-h-32 leading-snug" />
            <button onClick={submit} disabled={(!text.trim() && mentions.length === 0) || sending}
              className="w-11 h-11 rounded-full bg-affirm-600 text-white flex items-center justify-center shadow-lg shadow-affirm-200 disabled:opacity-40 shrink-0">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
      {reportingComment && (
        <ReportSheet user={currentUser} targetType="comment" targetId={reportingComment.id}
          targetOwnerId={reportingComment.userId} targetOwnerName={reportingComment.userName}
          preview={reportingComment.text} onClose={() => setReportingComment(null)} />
      )}
    </div>
  )
}

// Staff-only donations ledger. Members DECLARE donations after paying outside
// the app; the treasurer matches each declaration against the mobile-money /
// PayPal statements and marks it verified. Reads are staff-only in the rules
// (a member can read back only their own declarations).
function DonationsPanel({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [showVerified, setShowVerified] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'donations'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q,
      snap => { setDonations(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Donation[]); setLoading(false) },
      () => setLoading(false))
    return unsub
  }, [])

  const verify = async (d: Donation) => {
    if (busyId) return
    setBusyId(d.id)
    try {
      await updateDoc(doc(db, 'donations', d.id), {
        status: 'verified',
        verifiedById: user.uid,
        verifiedByName: user.displayName || '',
        verifiedAt: serverTimestamp(),
      })
    } catch (_e) { /* rules reject non-staff writers */ }
    finally { setBusyId(null) }
  }

  const typeLabel = (d: Donation) =>
    d.type === 'dime' ? t('donate.typeDime') : d.type === 'offrande' ? t('donate.typeOffrande') : t('donate.typeAutre')
  const typeAccent = (d: Donation) =>
    d.type === 'dime' ? 'bg-amber-100 text-amber-700' : d.type === 'offrande' ? 'bg-affirm-100 text-affirm-700' : 'bg-slate-100 text-slate-600'

  const shown = donations.filter(d => showVerified ? d.status === 'verified' : d.status !== 'verified')

  return (
    <div className="space-y-4">
      <p className="text-xs text-on-bg leading-relaxed">{t('dons.reconcileHint')}</p>
      <div className="flex gap-2">
        {[{ id: false, label: t('dons.declared') }, { id: true, label: t('dons.verified') }].map(o => (
          <button key={String(o.id)} onClick={() => setShowVerified(o.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              showVerified === o.id ? 'bg-affirm-600 text-white' : 'glass-soft text-slate-600'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}
      {!loading && shown.length === 0 && (
        <div className="text-center py-12 px-6 my-6 scrim">
          <p className="text-slate-800 font-medium">{t('dons.empty')}</p>
        </div>
      )}

      {shown.map(d => (
        <div key={d.id} className="glass rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${typeAccent(d)}`}>{typeLabel(d)}</span>
                {d.amount && <span className="text-sm font-bold text-slate-800">{d.amount}</span>}
                {d.methodLabel && <span className="text-[11px] text-slate-400">{t('dons.via')} {d.methodLabel}</span>}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(d.createdAt)}</p>
            </div>
            {d.status === 'verified' && (
              <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-affirm-100 text-affirm-700">
                {t('dons.verified')}
              </span>
            )}
          </div>
          {d.purpose && <p className="mt-2 text-sm text-slate-700 break-words whitespace-pre-wrap">{d.purpose}</p>}
          <p className="mt-2 text-[11px] text-slate-400">
            {t('dons.by')} {d.donorName || d.donorId}
            {d.status === 'verified' && d.verifiedByName ? ` · ${t('dons.verifiedBy')} ${d.verifiedByName}` : ''}
          </p>
          {d.status !== 'verified' && (
            <button onClick={() => verify(d)} disabled={busyId === d.id}
              className="mt-3 w-full py-2.5 rounded-xl bg-affirm-600 text-white text-sm font-semibold disabled:opacity-50">
              {t('dons.markVerified')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Staff-only queue of user reports. Reads are restricted to staff in
// firestore.rules, so this is the only place reports are visible; a reporter
// cannot read back other people's reports.
function ReportsPanel({ user }: { user: AppUser }) {
  const { t } = useLanguage()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [showHandled, setShowHandled] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q,
      snap => { setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Report[]); setLoading(false) },
      () => setLoading(false))
    return unsub
  }, [])

  const resolve = async (r: Report, status: 'actioned' | 'dismissed') => {
    if (busyId) return
    setBusyId(r.id)
    try {
      await updateDoc(doc(db, 'reports', r.id), {
        status,
        reviewedById: user.uid,
        reviewedByName: user.displayName || '',
        reviewedAt: serverTimestamp(),
      })
    } catch (_e) { /* rules will reject a non-staff writer */ }
    finally { setBusyId(null) }
  }

  const reasonLabel = (r: Report) => t((
    r.reason === 'child_safety' ? 'report.reason.childSafety'
    : r.reason === 'sexual' ? 'report.reason.sexual'
    : r.reason === 'violence' ? 'report.reason.violence'
    : r.reason === 'harassment' ? 'report.reason.harassment'
    : r.reason === 'spam' ? 'report.reason.spam'
    : 'report.reason.other') as never)

  const targetLabel = (r: Report) => t((
    r.targetType === 'post' ? 'reports.target.post'
    : r.targetType === 'comment' ? 'reports.target.comment'
    : r.targetType === 'message' ? 'reports.target.message'
    : 'reports.target.user') as never)

  const shown = reports.filter(r => showHandled ? r.status !== 'open' : r.status === 'open')

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[{ id: false, label: t('reports.open') }, { id: true, label: t('reports.handled') }].map(o => (
          <button key={String(o.id)} onClick={() => setShowHandled(o.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              showHandled === o.id ? 'bg-affirm-600 text-white' : 'glass-soft text-slate-600'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}
      {!loading && shown.length === 0 && (
        <div className="text-center py-12 px-6 my-6 scrim">
          <p className="text-slate-800 font-medium">{t('reports.empty')}</p>
        </div>
      )}

      {shown.map(r => (
        <div key={r.id} className="glass rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {r.reason === 'child_safety' && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide">
                    {t('report.reason.childSafety')}
                  </span>
                )}
                <span className="text-sm font-bold text-slate-800">{reasonLabel(r)}</span>
                <span className="text-[11px] text-slate-400">· {targetLabel(r)}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(r.createdAt)}</p>
            </div>
            {r.status !== 'open' && (
              <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full glass-soft text-slate-600">
                {r.status === 'actioned' ? t('reports.actioned') : t('reports.dismissed')}
              </span>
            )}
          </div>

          {r.preview && (
            <p className="mt-3 text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-2 break-words whitespace-pre-wrap line-clamp-4">
              {r.preview}
            </p>
          )}
          {r.details && <p className="mt-2 text-sm text-slate-700 break-words whitespace-pre-wrap">{r.details}</p>}

          <p className="mt-3 text-[11px] text-slate-400">
            {t('reports.reportedBy')} {r.reporterName || r.reporterId}
            {r.targetOwnerName ? ` · ${t('reports.about')} ${r.targetOwnerName}` : ''}
          </p>

          {r.status === 'open' && (
            <div className="mt-3 flex gap-2">
              <button onClick={() => resolve(r, 'actioned')} disabled={busyId === r.id}
                className="flex-1 py-2.5 rounded-xl bg-affirm-600 text-white text-sm font-semibold disabled:opacity-50">
                {t('reports.markActioned')}
              </button>
              <button onClick={() => resolve(r, 'dismissed')} disabled={busyId === r.id}
                className="flex-1 py-2.5 rounded-xl glass-soft text-slate-700 text-sm font-semibold disabled:opacity-50">
                {t('reports.dismiss')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function NotificationsPanel({ notifications, announcements, newPostCount, onClose, onTap, onTapAnnouncement, onDismiss, onDismissAnnouncement, onViewNewPosts }: {
  notifications: AppNotification[]
  announcements: Announcement[]
  newPostCount: number
  onClose: () => void
  onTap: (n: AppNotification) => void
  onTapAnnouncement: (a: Announcement) => void
  onDismiss: (id: string) => void
  onDismissAnnouncement: (id: string) => void
  onViewNewPosts: () => void
}) {
  const { t } = useLanguage()
  const label = (type: AppNotification['type']) =>
    type === 'post_like' ? t('notif.postLike')
      : type === 'comment_like' ? t('notif.commentLike')
      : type === 'post_comment' ? t('notif.postComment')
      : type === 'comment_mention' ? t('notif.commentMention')
      : type === 'message' ? t('notif.message')
      : type === 'transcript' ? t('notif.transcript')
      : t('notif.commentReply')

  // One list, most recent first — announcements and personal notifications
  // interleaved by time, instead of all announcements always sitting on top.
  const ms = (ts: any) => (ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : 0))
  type FeedRow =
    | { key: string; ts: number; kind: 'ann'; a: Announcement }
    | { key: string; ts: number; kind: 'notif'; n: AppNotification }
  const feed: FeedRow[] = [
    ...announcements.map(a => ({ key: 'a' + a.id, ts: ms(a.createdAt), kind: 'ann' as const, a })),
    ...notifications.map(n => ({ key: 'n' + n.id, ts: ms(n.createdAt), kind: 'notif' as const, n })),
  ].sort((x, y) => y.ts - x.ts)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="glass-bar w-full max-w-lg mx-auto rounded-t-3xl sm:rounded-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Bell size={18} /> {t('notif.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {newPostCount > 0 && (
            <button onClick={onViewNewPosts}
              className="w-full flex items-center gap-3 px-5 py-4 border-b border-slate-100 hover:bg-slate-50 text-left">
              <div className="w-9 h-9 rounded-full bg-affirm-100 flex items-center justify-center text-affirm-600 shrink-0"><Home size={16} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{newPostCount} {t('notif.newPosts')}</p>
                <p className="text-xs text-slate-400">{t('notif.tapToView')}</p>
              </div>
            </button>
          )}
          {notifications.length === 0 && announcements.length === 0 && newPostCount === 0 && (
            <p className="text-center text-slate-400 text-sm py-14">{t('notif.none')}</p>
          )}
          {/* Announcements (church-wide broadcasts) and personal notifications
              interleaved, most recent first. */}
          {feed.map(row => {
            if (row.kind === 'ann') {
              const a = row.a
              return (
                <div key={row.key} className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-50">
                  {/* Routes by kind or opens the link via the handler (which
                      only follows http(s) urls). */}
                  <button onClick={() => onTapAnnouncement(a)} className="flex items-start gap-3 flex-1 text-left min-w-0">
                    <div className="w-9 h-9 rounded-full bg-affirm-100 flex items-center justify-center text-affirm-600 shrink-0"><Megaphone size={16} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 leading-snug">{a.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-line break-words">{a.body}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(a.createdAt)}</p>
                    </div>
                  </button>
                  <button onClick={() => onDismissAnnouncement(a.id)} aria-label={t('post.delete')}
                    className="p-1 text-slate-300 hover:text-slate-500 shrink-0"><X size={15} /></button>
                </div>
              )
            }
            const n = row.n
            const isMessage = n.type === 'message'
            const isTranscript = n.type === 'transcript'
            const isMention = n.type === 'comment_mention'
            const isLike = n.type.includes('like')
            const RowIcon = isTranscript ? Download : isMessage ? Mail : isMention ? AtSign : isLike ? Heart : MessageCircle
            const badgeColor = isTranscript ? 'bg-slate-800' : isMessage ? 'bg-emerald-500' : isMention ? 'bg-violet-500' : isLike ? 'bg-rose-500' : 'bg-sky-500'
            return (
              <div key={row.key} className={`flex items-start gap-3 px-5 py-3.5 border-b border-slate-50 ${!n.read ? 'bg-affirm-50/40' : ''}`}>
                <button onClick={() => onTap(n)} className="flex items-start gap-3 flex-1 text-left min-w-0">
                  <div className="relative shrink-0">
                    {n.actorAvatar
                      ? <img src={n.actorAvatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                      : <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-semibold text-sm">{(n.actorName || '?').charAt(0)}</div>}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white ${badgeColor}`}>
                      <RowIcon size={9} fill={isLike ? 'currentColor' : 'none'} />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 leading-snug">
                      <span className="font-semibold">{n.actorName}</span> {label(n.type)}
                    </p>
                    {/* Message previews are deliberately omitted (privacy) - only
                        like/comment notifications carry a snippet. */}
                    {!isMessage && n.preview && <p className="text-xs text-slate-400 truncate mt-0.5">“{n.preview}”</p>}
                    <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
                <button onClick={() => onDismiss(n.id)} aria-label={t('post.delete')}
                  className="p-1 text-slate-300 hover:text-slate-500 shrink-0"><X size={15} /></button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const DONATION_SEED: DonationProvider[] = [
  { id: 'wave', label: 'Wave', kind: 'number', number: '', holder: '', note: '' },
  { id: 'orange', label: 'Orange Money', kind: 'number', number: '', holder: '', note: '' },
  { id: 'moov', label: 'Moov Money', kind: 'number', number: '', holder: '', note: '' },
]

function donationAccent(label: string) {
  const l = (label || '').toLowerCase()
  if (l.includes('wave')) return 'bg-sky-100 text-sky-700'
  if (l.includes('orange')) return 'bg-orange-100 text-orange-700'
  if (l.includes('moov')) return 'bg-indigo-100 text-indigo-700'
  if (l.includes('paypal')) return 'bg-blue-100 text-blue-700'
  if (l.includes('cash')) return 'bg-green-100 text-green-700'
  // Fixed hex (not a slate token): the neutral scale inverts in dark mode, so a
  // slate-900 chip would turn pale. This keeps Square's badge black in both themes.
  if (l.includes('square')) return 'bg-[#0b0b0d] text-white'
  if (l.includes('carte') || l.includes('card') || l.includes('visa')) return 'bg-violet-100 text-violet-700'
  return 'bg-affirm-100 text-affirm-700'
}

// Brand colour for the "give" button on a payment-link method, so Square,
// PayPal, Cash App and card links each look like themselves. These use fixed
// hex values on purpose: the slate scale inverts under the app's dark theme,
// which would turn a slate-900 button pale and hide its white label.
function donationBrandBtn(label: string) {
  const l = (label || '').toLowerCase()
  if (l.includes('paypal')) return 'bg-[#0070ba] hover:bg-[#005ea6] text-white'
  if (l.includes('cash')) return 'bg-[#00d64f] hover:bg-[#00c247] text-[#052e13]'
  if (l.includes('square')) return 'bg-[#0b0b0d] hover:bg-black text-white'
  if (l.includes('carte') || l.includes('card') || l.includes('visa') || l.includes('stripe'))
    return 'bg-gradient-to-r from-affirm-500 to-affirm-600 hover:from-affirm-600 hover:to-affirm-700 text-white'
  return 'bg-[#1e293b] hover:bg-[#0f172a] text-white'
}

const providerKind = (p: DonationProvider): 'number' | 'link' => (p.kind === 'link' ? 'link' : 'number')

type Money = { amount: number; currency: string }

function DonationSheet({ config, canEdit, user, onClose }: {
  config: DonationConfig | null
  canEdit: boolean
  user: AppUser
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DonationConfig>(
    config && config.providers?.length ? config : { title: '', message: '', thanksMessage: '', providers: DONATION_SEED })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // The declaration flow: what kind of gift, what it is for, how it was paid.
  const [donType, setDonType] = useState<DonationType | null>(null)
  const [purpose, setPurpose] = useState('')
  const [amount, setAmount] = useState('')
  const [methodUsed, setMethodUsed] = useState<DonationProvider | null>(null)
  const [declaring, setDeclaring] = useState(false)
  const [declareError, setDeclareError] = useState('')
  const [declared, setDeclared] = useState(false)

  // Refresh the draft from the live config while not actively editing.
  useEffect(() => {
    if (!editing) setDraft(config && config.providers?.length ? config : { title: '', message: '', thanksMessage: '', providers: DONATION_SEED })
  }, [config, editing])

  const providers = (config?.providers || []).filter(p =>
    providerKind(p) === 'link' ? (p.url || '').trim() : (p.number || '').trim())

  const copy = async (p: DonationProvider) => {
    try {
      await navigator.clipboard.writeText(p.number)
      setCopied(p.id)
      setMethodUsed(p)
      setTimeout(() => setCopied(c => (c === p.id ? null : c)), 1500)
    } catch { /* clipboard unavailable in this context */ }
  }

  // External payment pages open in the system browser - never inside the
  // WebView. That keeps card entry out of the app (PCI + Play policy).
  const openLink = (p: DonationProvider) => {
    setMethodUsed(p)
    window.open(p.url!, '_blank', 'noopener,noreferrer')
  }

  // A link method labelled "Square" is upgraded to a live, donor-linked
  // checkout: we mint a Square payment page stamped with this donor's id and
  // gift type, so once they pay, the webhook records it as a verified donation
  // automatically - no self-declaration, and the payment is actually tied to
  // the person and amount.
  const [squareBusy, setSquareBusy] = useState<string | null>(null)
  const [squareError, setSquareError] = useState('')
  // The donor picks the currency of the amount they type; the backend converts
  // it into whatever currency the Square account actually charges in, so
  // "200 FCFA" can never be mistaken for "$200".
  const [curr, setCurr] = useState('XOF')
  const [chargeCur, setChargeCur] = useState('')
  const [squareConfirm, setSquareConfirm] = useState<
    { url: string; source: Money; charge: Money } | null
  >(null)

  const isSquareCheckout = (p: DonationProvider) =>
    providerKind(p) === 'link' && (p.label || '').toLowerCase().includes('square')

  const hasSquare = providers.some(isSquareCheckout)

  // Ask the backend which currency this Square account charges in, so we can
  // label the conversion ("...charged in USD") and add it to the picker. The
  // picker itself defaults to FCFA, the currency our donors think in.
  useEffect(() => {
    if (!hasSquare) return
    let alive = true
    httpsCallable<Record<string, never>, { currency: string }>(functions, 'squareChargeCurrency')({})
      .then(res => {
        if (!alive) return
        const c = (res.data?.currency || '').toUpperCase()
        if (c) setChargeCur(c)
      })
      .catch(() => { /* the conversion hint just won't name the currency */ })
    return () => { alive = false }
  }, [hasSquare])

  const currencyOptions = useMemo(() => {
    const base = ['XOF', 'USD', 'EUR', 'CAD', 'GBP']
    if (chargeCur && !base.includes(chargeCur)) base.push(chargeCur)
    return base
  }, [chargeCur])

  const fmtMoney = (a: number, c: string) => {
    // Keep in sync with the server's ZERO_DECIMAL set (functions/index.js).
    const zeroDec = ['JPY', 'XOF', 'XAF', 'XPF', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'GNF', 'PYG', 'BIF', 'DJF', 'KMF', 'MGA', 'VUV'].includes(c)
    const n = zeroDec ? Math.round(a).toString() : a.toFixed(2)
    return `${n} ${c === 'XOF' ? 'FCFA' : c}`
  }

  const parsedAmount = () => {
    const n = parseFloat((amount || '').replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : NaN
  }

  const payWithSquare = async (p: DonationProvider) => {
    if (squareBusy) return
    setSquareError(''); setSquareConfirm(null)
    setMethodUsed(p)
    if (!donType) { setSquareError(t('donate.squareNeedType')); return }
    const amt = parsedAmount()
    if (!Number.isFinite(amt) || amt <= 0) { setSquareError(t('donate.squareNeedAmount')); return }
    setSquareBusy(p.id)
    try {
      const call = httpsCallable<
        { amount: number; currency: string; type: string; purpose: string },
        {
          ok: boolean; url?: string | null; reason?: string
          charge?: Money; source?: Money; min?: Money; converted?: boolean
        }
      >(functions, 'createSquareCheckout')
      const res = await call({ amount: amt, currency: curr, type: donType, purpose: purpose.trim().slice(0, 120) })
      const d = res.data
      if (d && d.ok === false && d.reason === 'below_min' && d.min && d.charge) {
        setSquareError(`${t('donate.squareBelowMin')} ${fmtMoney(d.min.amount, d.min.currency)} (${fmtMoney(d.charge.amount, d.charge.currency)}). ${t('donate.squareBelowMinHint')}`)
        return
      }
      const url = d && d.url
      if (!url || !d.charge) throw new Error('no-url')
      if (d.converted && d.source) {
        // Show the exact converted charge and let them confirm before Square.
        setSquareConfirm({ url, source: d.source, charge: d.charge })
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (e: any) {
      const msg = String(e?.message || '')
      setSquareError(msg.includes('conversion_unavailable') ? t('donate.squareFxDown') : t('donate.squareFailed'))
    } finally { setSquareBusy(null) }
  }

  const confirmSquare = () => {
    if (!squareConfirm) return
    window.open(squareConfirm.url, '_blank', 'noopener,noreferrer')
    setSquareConfirm(null)
  }

  const declare = async () => {
    if (!donType || declaring) return
    setDeclaring(true); setDeclareError('')
    try {
      await addDoc(collection(db, 'donations'), {
        donorId: user.uid,
        donorName: user.displayName || '',
        type: donType,
        purpose: purpose.trim().slice(0, 300),
        // Keep the currency with the number so "200" is never ambiguous.
        amount: (amount.trim() ? `${amount.trim()} ${curr === 'XOF' ? 'FCFA' : curr}` : '').slice(0, 30),
        currency: curr,
        ...(methodUsed ? { methodId: methodUsed.id, methodLabel: methodUsed.label } : {}),
        status: 'declared',
        createdAt: serverTimestamp(),
      })
      setDeclared(true)
    } catch (_e) {
      setDeclareError(t('donate.declareFailed'))
    } finally { setDeclaring(false) }
  }

  const setField = (field: 'title' | 'message' | 'thanksMessage', value: string) => setDraft(d => ({ ...d, [field]: value }))
  const setProvider = (id: string, field: keyof DonationProvider, value: string) =>
    setDraft(d => ({ ...d, providers: d.providers.map(p => (p.id === id ? { ...p, [field]: value } : p)) }))
  const addProvider = () =>
    setDraft(d => ({ ...d, providers: [...d.providers, { id: 'p' + Date.now(), label: '', kind: 'number', number: '', url: '', holder: '', note: '' }] }))
  const removeProvider = (id: string) =>
    setDraft(d => ({ ...d, providers: d.providers.filter(p => p.id !== id) }))

  const save = async () => {
    setSaving(true); setError('')
    try {
      const clean: DonationConfig = {
        title: (draft.title || '').trim(),
        message: (draft.message || '').trim(),
        thanksMessage: (draft.thanksMessage || '').trim(),
        providers: draft.providers
          .filter(p => (p.label || '').trim() && (providerKind(p) === 'link' ? (p.url || '').trim() : (p.number || '').trim()))
          .map(p => ({
            id: p.id, label: (p.label || '').trim(), kind: providerKind(p),
            number: (p.number || '').trim(), url: (p.url || '').trim(),
            holder: (p.holder || '').trim(), note: (p.note || '').trim()
          }))
      }
      await setDoc(doc(db, 'config', 'donation'), clean)
      setEditing(false)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally { setSaving(false) }
  }

  const typeChip = (id: DonationType, label: string) => (
    <button key={id} type="button" onClick={() => setDonType(id)}
      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
        donType === id ? 'bg-affirm-600 text-white border-affirm-500' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="glass-bar w-full max-w-lg mx-auto rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><HandCoins size={18} className="text-amber-500" /> {t('donate.title')}</h3>
          <div className="flex items-center gap-1">
            {canEdit && !editing && (
              <button onClick={() => setEditing(true)} aria-label={t('donate.edit')}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500"><Pencil size={16} /></button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500">{t('donate.fieldTitle')}</label>
                <input value={draft.title || ''} onChange={e => setField('title', e.target.value)} placeholder={t('donate.title')}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">{t('donate.fieldMessage')}</label>
                <textarea value={draft.message || ''} onChange={e => setField('message', e.target.value)} rows={2}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm resize-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">{t('donate.fieldThanks')}</label>
                <textarea value={draft.thanksMessage || ''} onChange={e => setField('thanksMessage', e.target.value)} rows={3}
                  placeholder={t('donate.thanksPlaceholder')}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm resize-none" />
              </div>
              <div className="space-y-3">
                {draft.providers.map(p => (
                  <div key={p.id} className="rounded-2xl border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={p.label} onChange={e => setProvider(p.id, 'label', e.target.value)} placeholder={t('donate.fieldLabel')}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      <button onClick={() => removeProvider(p.id)} aria-label={t('post.delete')}
                        className="p-2 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                    <div className="flex gap-2">
                      {(['number', 'link'] as const).map(k => (
                        <button key={k} type="button" onClick={() => setProvider(p.id, 'kind', k)}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
                            providerKind(p) === k ? 'bg-amber-500 text-white border-amber-400' : 'border-slate-200 text-slate-500'}`}>
                          {k === 'number' ? t('donate.kindNumber') : t('donate.kindLink')}
                        </button>
                      ))}
                    </div>
                    {providerKind(p) === 'link' ? (
                      <input value={p.url || ''} onChange={e => setProvider(p.id, 'url', e.target.value)} placeholder={t('donate.fieldUrl')} inputMode="url"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    ) : (
                      <input value={p.number} onChange={e => setProvider(p.id, 'number', e.target.value)} placeholder={t('donate.fieldNumber')} inputMode="tel"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    )}
                    <input value={p.holder || ''} onChange={e => setProvider(p.id, 'holder', e.target.value)} placeholder={t('donate.fieldHolder')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <textarea value={p.note || ''} onChange={e => setProvider(p.id, 'note', e.target.value)} rows={2} placeholder={t('donate.fieldNote')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                ))}
                <button onClick={addProvider}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-300 text-slate-500 text-sm hover:bg-slate-50">
                  <Plus size={16} /> {t('donate.addProvider')}
                </button>
              </div>
              {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setEditing(false); setError('') }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm">{t('post.cancel')}</button>
                <button onClick={save} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm disabled:opacity-50">
                  {saving ? t('post.saving') : t('post.save')}
                </button>
              </div>
            </div>
          ) : declared ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-full bg-affirm-50 text-affirm-600 flex items-center justify-center mx-auto">
                <Check size={26} />
              </div>
              <h4 className="mt-4 text-lg font-bold text-slate-800">{t('donate.thanksTitle')}</h4>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">{t('donate.thanksBody')}</p>
              <button onClick={onClose}
                className="mt-6 w-full py-3.5 rounded-2xl btn-glass-primary font-semibold text-[15px]">
                {t('report.close')}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {(config?.title || config?.message) && (
                <div className="text-center">
                  {config?.title && <h4 className="font-bold text-lg text-slate-800">{config.title}</h4>}
                  {config?.message && <p className="text-sm text-slate-500 mt-1 whitespace-pre-wrap">{config.message}</p>}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">{t('donate.typeLabel')}</p>
                <div className="flex gap-2">
                  {typeChip('dime', t('donate.typeDime'))}
                  {typeChip('offrande', t('donate.typeOffrande'))}
                  {typeChip('autre', t('donate.typeAutre'))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500">{t('donate.purposeLabel')}</label>
                <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={300}
                  placeholder={t('donate.purposePlaceholder')}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl glass-input text-slate-800 placeholder:text-slate-400 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">{t('donate.amountLabel')}</label>
                <div className="flex gap-2 mt-1">
                  <input value={amount} onChange={e => setAmount(e.target.value)} maxLength={15}
                    placeholder={t('donate.amountPlaceholder')} inputMode="decimal"
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-xl glass-input text-slate-800 placeholder:text-slate-400 text-sm focus:outline-none" />
                  <select value={curr} onChange={e => setCurr(e.target.value)}
                    aria-label={t('donate.currencyLabel')}
                    className="shrink-0 px-3 py-2.5 rounded-xl glass-input text-slate-800 text-sm font-semibold focus:outline-none">
                    {currencyOptions.map(c => (
                      <option key={c} value={c}>{c === 'XOF' ? 'FCFA' : c}</option>
                    ))}
                  </select>
                </div>
                {hasSquare && chargeCur && curr !== chargeCur && (
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    {t('donate.squareConvertHint')} {chargeCur}.
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">{t('donate.methodsLabel')}</p>
                {providers.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm py-8">
                    {canEdit ? t('donate.emptyAdmin') : t('donate.empty')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {providers.map(p => (
                      <div key={p.id} className={`rounded-2xl border p-4 transition ${
                        methodUsed?.id === p.id ? 'border-affirm-400 bg-affirm-500/10' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${donationAccent(p.label)}`}>
                            {(p.label || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-800 text-sm leading-tight truncate">{p.label}</p>
                            {p.holder && <p className="text-xs text-slate-500 truncate">{p.holder}</p>}
                          </div>
                          {methodUsed?.id === p.id && <Check size={16} className="text-affirm-600 shrink-0" />}
                        </div>
                        {providerKind(p) === 'link' ? (
                          isSquareCheckout(p) ? (
                            <>
                              <button onClick={() => payWithSquare(p)} disabled={squareBusy === p.id}
                                className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[15px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-60 ${donationBrandBtn(p.label)}`}>
                                {squareBusy === p.id ? (
                                  <><Loader2 size={17} className="animate-spin" /> {t('donate.squareStarting')}</>
                                ) : (
                                  <><CreditCard size={17} /> {t('donate.squarePay')} <ArrowRight size={16} /></>
                                )}
                              </button>
                              {squareError && methodUsed?.id === p.id && (
                                <p className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mt-2">{squareError}</p>
                              )}
                              {squareConfirm && methodUsed?.id === p.id && (
                                <div className="mt-3 rounded-2xl border border-affirm-400/40 bg-affirm-500/10 p-3">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-500">{t('donate.squareYouEntered')}</span>
                                    <span className="font-semibold text-slate-700">{fmtMoney(squareConfirm.source.amount, squareConfirm.source.currency)}</span>
                                  </div>
                                  <div className="flex items-center justify-between text-sm mt-1.5">
                                    <span className="text-slate-500">{t('donate.squareWillCharge')}</span>
                                    <span className="font-bold text-slate-900">{fmtMoney(squareConfirm.charge.amount, squareConfirm.charge.currency)}</span>
                                  </div>
                                  <button onClick={confirmSquare}
                                    className={`w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl text-[15px] font-bold ${donationBrandBtn(p.label)}`}>
                                    <CreditCard size={16} /> {t('donate.squareContinue')} <ArrowRight size={15} />
                                  </button>
                                  <button onClick={() => setSquareConfirm(null)}
                                    className="w-full mt-1.5 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600">
                                    {t('post.cancel')}
                                  </button>
                                </div>
                              )}
                              <p className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 mt-2">
                                <ShieldCheck size={12} /> {t('donate.squareAutoNote')}
                              </p>
                            </>
                          ) : (
                          <>
                            <button onClick={() => openLink(p)}
                              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[15px] font-bold shadow-sm active:scale-[.99] transition ${donationBrandBtn(p.label)}`}>
                              <CreditCard size={17} /> {p.label} <ArrowRight size={16} />
                            </button>
                            <p className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 mt-2">
                              <ShieldCheck size={12} /> {t('donate.openExternalNote')}
                            </p>
                          </>
                          )
                        ) : (
                          <div className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2.5">
                            <span className="font-mono font-semibold text-slate-800 text-[15px] tracking-wide break-all">{p.number}</span>
                            <button onClick={() => copy(p)}
                              className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 shrink-0">
                              {copied === p.id ? <><Check size={14} /> {t('donate.copied')}</> : <><Copy size={14} /> {t('donate.copy')}</>}
                            </button>
                          </div>
                        )}
                        {p.note && <p className="text-xs text-slate-500 mt-2.5 whitespace-pre-wrap">{p.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {providers.length > 0 && (
                methodUsed && isSquareCheckout(methodUsed) ? (
                  // Paying by card records the gift itself once Square confirms
                  // it - so we don't offer the manual declaration here, to avoid
                  // a duplicate record.
                  <div className="rounded-2xl bg-affirm-500/10 border border-affirm-400/30 px-4 py-3 flex items-start gap-2.5">
                    <ShieldCheck size={16} className="text-affirm-600 shrink-0 mt-0.5" />
                    <p className="text-[12.5px] text-slate-600 leading-relaxed">{t('donate.squarePendingNote')}</p>
                  </div>
                ) : (
                <div>
                  {declareError && <p className="text-sm text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-3">{declareError}</p>}
                  <button onClick={declare} disabled={!donType || declaring}
                    className="w-full py-3.5 rounded-2xl btn-glass-primary font-semibold text-[15px] disabled:opacity-50">
                    {declaring ? t('donate.declaring') : t('donate.declare')}
                  </button>
                  <p className="text-[11px] text-slate-400 text-center mt-2 leading-relaxed">{t('donate.declareHint')}</p>
                </div>
                )
              )}
            </div>
          )}
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
      <MediaPlayerProvider>
        <AppInner />
      </MediaPlayerProvider>
    </LanguageProvider>
  )
}
