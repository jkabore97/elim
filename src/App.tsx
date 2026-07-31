import { useState, useEffect } from 'react'
import {
  Home, Church, PlusCircle, User, MessageCircle, Heart, Share2,
  Image as ImageIcon, Video, Mic, X, Send, LogOut,
  Youtube, Facebook, CheckCircle2, Clock, ArrowRight, ShieldCheck, UserX, Sparkles,
  Trash2, Camera, FileText, Upload, Pencil
} from 'lucide-react'
import {
  collection, addDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, doc, updateDoc, deleteDoc, increment, setDoc, getDoc
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  sendEmailVerification, sendPasswordResetEmail
} from 'firebase/auth'
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { auth, db, storage } from './firebase'
import type { Post, Comment, AppUser, UserRole } from './types'

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
  const reg = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
  const match = url.match(reg)
  return match ? match[1] : null
}

function isFacebookVideo(url: string) {
  return url.includes('facebook.com') || url.includes('fb.watch')
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

// ==================== SHARED AUTH FORM ====================
// Used inside both the mobile/tablet full-screen AuthScreen and the
// desktop AuthModal, so the login/register logic lives in one place.
function AuthForm({ onSuccess, initialMode = 'login' }: {
  onSuccess: (user: AppUser) => void
  initialMode?: 'login' | 'register'
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [accountType, setAccountType] = useState<'member' | 'church'>('member')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [churchName, setChurchName] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    setError('')
    setResetSent(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setRegisterSuccess(false)
    setLoading(true)
    try {
      if (mode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, email, password)
        const snap = await getDoc(doc(db, 'users', cred.user.uid))
        if (snap.exists()) onSuccess(snap.data() as AppUser)
        else throw new Error('User profile not found')
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
        // Fire-and-forget — a failure here shouldn't block account creation.
        sendEmailVerification(cred.user).catch(() => {})

        const role: UserRole = accountType === 'church' ? 'pending_church' : 'member'
        const profile: AppUser = {
          uid: cred.user.uid,
          email,
          displayName: name,
          role,
          createdAt: serverTimestamp(),
          // Omit churchName/location entirely for members rather than setting
          // them to `undefined` — Firestore's setDoc() rejects undefined
          // field values outright (this is what was crashing "Member" signup).
          ...(accountType === 'church' ? { churchName, location } : {})
        }
        await setDoc(doc(db, 'users', cred.user.uid), profile)

        // Sign out right after creating the account rather than dropping
        // them straight into the app — they come back to Sign In and log
        // in deliberately with the credentials they just set.
        await signOut(auth)
        setMode('login')
        setPassword('')
        setRegisterSuccess(true)
      }
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email above first, then tap "Forgot password?"')
      return
    }
    setError('')
    setResetSent(false)
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Could not send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex bg-slate-100 rounded-2xl p-1 mb-6">
        <button onClick={() => switchMode('login')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Sign In
        </button>
        <button onClick={() => switchMode('register')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Create Account
        </button>
      </div>

      {mode === 'register' && (
        <div className="flex gap-3 mb-6">
          <button onClick={() => setAccountType('member')}
            className={`flex-1 py-3 rounded-2xl border-2 text-sm font-medium transition ${
              accountType === 'member' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>
            Member
          </button>
          <button onClick={() => setAccountType('church')}
            className={`flex-1 py-3 rounded-2xl border-2 text-sm font-medium transition ${
              accountType === 'church' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>
            Church
          </button>
        </div>
      )}

      {registerSuccess && (
        <p className="mb-4 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">
          Account created! Sign in below to continue.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <input required value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
            className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        )}
        {mode === 'register' && accountType === 'church' && (
          <>
            <input required value={churchName} onChange={e => setChurchName(e.target.value)} placeholder="Church name"
              className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
            <input required value={location} onChange={e => setLocation(e.target.value)} placeholder="City, State"
              className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
          </>
        )}
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address"
          className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        <input required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
          minLength={mode === 'register' ? 8 : undefined}
          className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />

        {mode === 'login' && (
          <div className="text-right -mt-2">
            <button type="button" onClick={handleForgotPassword}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
              Forgot password?
            </button>
          </div>
        )}

        {resetSent && (
          <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">
            Password reset email sent — check your inbox.
          </p>
        )}
        {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition flex items-center justify-center gap-2 disabled:opacity-60">
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      {mode === 'register' && accountType === 'church' && (
        <p className="mt-5 text-xs text-center text-slate-400 leading-relaxed">
          Church accounts require approval before you can publish content.
        </p>
      )}
    </div>
  )
}

// ==================== AUTH SCREENS ====================
// Full-screen version — shown on phone & tablet (the "app style" experience).
function AuthScreen({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  return (
    <div className="min-h-screen heavenly-bg flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Logo size={64} />
            <h1 className="mt-6 text-3xl font-bold text-slate-900 tracking-tight">Welcome to ELIM</h1>
            <p className="mt-2 text-slate-500">A peaceful place for the church community</p>
          </div>
          <div className="bg-white rounded-3xl shadow-xl shadow-emerald-100/50 border border-emerald-50 p-8">
            <AuthForm onSuccess={onSuccess} />
          </div>
        </div>
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
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
          <X size={20} />
        </button>
        <div className="text-center mb-6">
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
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center justify-between">
          <Logo size={36} />
          <div className="flex items-center gap-3">
            <button onClick={() => setAuthMode('login')}
              className="px-5 py-2.5 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
              Sign In
            </button>
            <button onClick={() => setAuthMode('register')}
              className="px-5 py-2.5 rounded-full text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-lg shadow-emerald-200">
              Get Started
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
            <Sparkles size={14} /> A MODERN HOME FOR YOUR CHURCH COMMUNITY
          </div>
          <h1 className="text-5xl lg:text-6xl xl:text-7xl font-extrabold text-slate-900 tracking-tight leading-[1.05]">
            Stay close to your<br />
            <span className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-amber-500 bg-clip-text text-transparent">
              church family.
            </span>
          </h1>
          <p className="mt-8 text-lg xl:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            ELIM brings sermons, updates, and encouragement from your church straight to your pocket —
            photos, audio, video, and real conversation, all in one gentle, focused space.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <button onClick={() => setAuthMode('register')}
              className="px-8 py-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition shadow-xl shadow-emerald-200 flex items-center gap-2">
              Get Started <ArrowRight size={18} />
            </button>
            <button onClick={() => setAuthMode('login')}
              className="px-8 py-4 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[15px] transition">
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-6xl mx-auto px-8 py-10 grid grid-cols-4 gap-8">
          {[
            { icon: ImageIcon, label: 'Photos & Updates' },
            { icon: Mic, label: 'Audio Messages' },
            { icon: Video, label: 'Sermons & Video' },
            { icon: ShieldCheck, label: 'Verified Churches' },
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
          <p className="text-xs font-bold tracking-widest text-amber-600 mb-3">WHO IT'S FOR</p>
          <h2 className="text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight">Built for both sides of the pew.</h2>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="rounded-3xl p-8 bg-gradient-to-br from-emerald-50 to-white border border-emerald-100">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mb-6 shadow-lg shadow-emerald-200">
              <Church size={22} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">For Churches</h3>
            <ul className="space-y-3 text-slate-500 text-[15px]">
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> Share sermons as text, audio, or video</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> Reach your whole congregation instantly</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" /> A verified badge builds trust with members</li>
            </ul>
          </div>
          <div className="rounded-3xl p-8 bg-gradient-to-br from-blue-50 to-white border border-blue-100">
            <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white flex items-center justify-center mb-6 shadow-lg shadow-blue-200">
              <User size={22} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-3">For Members</h3>
            <ul className="space-y-3 text-slate-500 text-[15px]">
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> Follow your church's feed, wherever you are</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> Comment and stay part of the conversation</li>
              <li className="flex gap-2.5"><CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" /> Never miss an update or encouragement</li>
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-8 py-24">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest text-emerald-600 mb-3">GETTING STARTED</p>
            <h2 className="text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight">Three steps to feeling at home.</h2>
          </div>
          <div className="grid grid-cols-3 gap-8">
            {[
              { n: '1', title: 'Create your account', desc: 'Sign up in seconds as a member, or register your church for verification.', color: 'border-emerald-500 text-emerald-600' },
              { n: '2', title: 'Follow your church', desc: 'Find your church and start seeing their posts in your feed right away.', color: 'border-blue-600 text-blue-700' },
              { n: '3', title: 'Stay connected', desc: 'Like, comment, and never miss a message from the people you gather with.', color: 'border-amber-500 text-amber-600' },
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
          Your church, always{' '}
          <span className="bg-gradient-to-r from-emerald-600 to-amber-500 bg-clip-text text-transparent">within reach.</span>
        </h2>
        <button onClick={() => setAuthMode('register')}
          className="mt-4 px-10 py-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base transition shadow-xl shadow-emerald-200 inline-flex items-center gap-2">
          Get Started Free <ArrowRight size={18} />
        </button>
      </section>

      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-8 py-10 flex items-center justify-between gap-4">
          <Logo size={26} />
          <p className="text-sm text-slate-400">A peaceful place for the church community.</p>
        </div>
      </footer>

      {authMode && (
        <AuthModal initialMode={authMode} onClose={() => setAuthMode(null)} onSuccess={onSuccess} />
      )}
    </div>
  )
}

function PendingScreen({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
          <Clock size={36} className="text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">Waiting for Approval</h1>
        <p className="text-slate-500 mb-2">Your church account <strong>{user.churchName}</strong> is under review.</p>
        <p className="text-slate-400 text-sm mb-8">You will be able to publish once an administrator approves your request.</p>
        <button onClick={onLogout} className="text-sm text-slate-500 underline">Sign out</button>
      </div>
    </div>
  )
}

// ==================== MAIN APP ====================
export default function App() {
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
    await deleteDoc(doc(db, 'posts', id))
  }

  const handleEditPost = async (id: string, content: string) => {
    await updateDoc(doc(db, 'posts', id), { content })
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
    await updateDoc(doc(db, 'users', uid), { role: 'church' })
  }

  const handleDenyChurch = async (uid: string) => {
    // Deny doesn't delete the account — it just drops them back to a normal
    // member so they aren't stuck pending forever and can still use the app.
    await updateDoc(doc(db, 'users', uid), { role: 'member' })
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
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
    { id: 'feed', icon: Home, label: 'Feed' },
    { id: 'profile', icon: User, label: 'Profile' },
    ...(user.role === 'admin' ? [{ id: 'admin', icon: ShieldCheck, label: 'Admin' }] : [])
  ]

  return (
    <div className="min-h-screen bg-[#f8faf9] max-w-lg mx-auto lg:max-w-none lg:mx-0 relative">
      <div className="lg:flex">
        {/* Sidebar — desktop only */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-r border-slate-100 bg-white px-6 py-8">
          <Logo size={34} />
          <nav className="mt-10 flex-1 space-y-1">
            {navItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition ${
                    active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}>
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
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition shadow-lg shadow-emerald-200 mb-4">
              <PlusCircle size={18} /> New Post
            </button>
          )}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 truncate">{user.displayName}</span>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {/* Header — mobile & tablet only */}
          <header className="lg:hidden sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-100/80">
            <div className="px-5 h-14 flex items-center justify-between">
              <Logo size={32} />
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-400 truncate max-w-[120px]">{user.displayName}</span>
                <button onClick={handleLogout} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </header>

          <main className="pb-28 lg:pb-16 px-4 lg:px-10 pt-4 lg:pt-10 lg:max-w-3xl xl:max-w-4xl lg:mx-auto">
            {activeTab === 'feed' && (
              <div className="space-y-4">
                {loading && <p className="text-center text-slate-400 py-16">Loading...</p>}
                {!loading && posts.length === 0 && (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                      <Church size={28} className="text-emerald-500" />
                    </div>
                    <p className="text-slate-500 font-medium">No posts yet</p>
                    <p className="text-sm text-slate-400 mt-1">Be the first to share something</p>
                  </div>
                )}
                {posts.map(post => (
                  <PostCard key={post.id} post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost}
                    currentUserUid={user.uid} isLiked={likedPostIds.has(post.id)} onEdit={setEditingPost} onDelete={handleDeletePost} />
                ))}
              </div>
            )}

            {activeTab === 'profile' && (
              <ProfileTab user={user} onProfileUpdated={(updates) => setUser(prev => prev ? { ...prev, ...updates } : prev)} />
            )}

            {activeTab === 'admin' && user.role === 'admin' && (
              <AdminPanel pendingChurches={pendingChurches} onApprove={handleApproveChurch} onDeny={handleDenyChurch} />
            )}
          </main>
        </div>

        {/* Bottom Nav — mobile & tablet only */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-100 safe-bottom z-50">
          <div className="max-w-lg mx-auto flex justify-around items-center h-16 px-2">
            {navItems.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`relative flex flex-col items-center justify-center w-20 h-full transition ${
                    active ? 'text-emerald-600' : 'text-slate-400'}`}>
                  <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                  {item.id === 'admin' && pendingChurches.length > 0 && (
                    <span className="absolute top-1.5 right-5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {pendingChurches.length}
                    </span>
                  )}
                  <span className="text-[10px] mt-1 font-medium">{item.label}</span>
                </button>
              )
            })}
            {canPost && (
              <button onClick={() => setShowCreate(true)}
                className="flex flex-col items-center justify-center w-20 h-full text-emerald-600">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-200 -mt-4">
                  <PlusCircle size={22} />
                </div>
                <span className="text-[10px] mt-1 font-medium">Post</span>
              </button>
            )}
          </div>
        </nav>
      </div>

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

// ==================== COMPONENTS ====================
function ProfileTab({ user, onProfileUpdated }: {
  user: AppUser
  onProfileUpdated: (updates: Partial<AppUser>) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  const [churchName, setChurchName] = useState(user.churchName || '')
  const [country, setCountry] = useState(user.country || '')
  const [city, setCity] = useState(user.city || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file (JPEG, PNG, or WebP).')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5MB.')
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
      setAvatarError(err.message?.replace('Firebase: ', '') || 'Upload failed')
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
      setSaveError(err.message?.replace('Firebase: ', '') || 'Could not save changes')
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
          {user.role === 'church' ? <><CheckCircle2 size={14} /> Verified Church</> : user.role === 'admin' ? <><ShieldCheck size={14} /> Admin</> : 'Member'}
        </div>
        {avatarError && <p className="mt-4 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 inline-block">{avatarError}</p>}
      </div>

      <form onSubmit={handleSaveProfile} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
        <h3 className="font-bold text-slate-900 px-1">Profile details</h3>

        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">Church</label>
          <input value={churchName} onChange={e => setChurchName(e.target.value)} placeholder="e.g. Grace Community Church"
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">Country</label>
            <select value={country} onChange={e => setCountry(e.target.value)}
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px] bg-white">
              <option value="">Select...</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 px-1">City</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Ouagadougou"
              className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 px-1">Phone number</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +226 70 00 00 00"
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />
        </div>

        {saveError && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{saveError}</p>}
        {saved && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">Profile updated.</p>}

        <button type="submit" disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[15px] transition disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}

function AdminPanel({ pendingChurches, onApprove, onDeny }: {
  pendingChurches: AppUser[]
  onApprove: (uid: string) => void
  onDeny: (uid: string) => void
}) {
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
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck size={28} className="text-emerald-500" />
        </div>
        <p className="text-slate-500 font-medium">No pending churches</p>
        <p className="text-sm text-slate-400 mt-1">New church signups will show up here for approval</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 px-1">Pending Churches ({pendingChurches.length})</h2>
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
              <CheckCircle2 size={16} /> Approve
            </button>
            <button onClick={() => handle(church.uid, 'deny')} disabled={busyUid === church.uid}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition disabled:opacity-50">
              <UserX size={16} /> Deny
            </button>
          </div>
        </div>
      ))}
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
  const ytId = post.mediaUrl ? getYoutubeId(post.mediaUrl) : null
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [likeError, setLikeError] = useState(false)
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
          <h3 className="font-semibold text-slate-900 truncate">{post.churchName || 'Church'}</h3>
          <p className="text-xs text-slate-400">{timeAgo(post.createdAt)}</p>
        </div>
        {isOwner && (
          confirmingDelete ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => onDelete(post.id)}
                className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-full transition">
                Delete
              </button>
              <button onClick={() => setConfirmingDelete(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2">
                Cancel
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

      {post.type === 'facebook' && post.mediaUrl && (
        <div className="bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <Facebook size={18} />
            <span className="text-sm font-medium">Facebook Video</span>
          </div>
          <a href={post.mediaUrl} target="_blank" rel="noreferrer"
            className="text-sm text-emerald-600 underline break-all">{post.mediaUrl}</a>
        </div>
      )}

      {post.type === 'video' && post.mediaUrl && !ytId && (
        <video src={post.mediaUrl} controls className="w-full max-h-72 bg-black" />
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
            <audio src={post.mediaUrl} controls className="w-full h-9" />
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
              <p className="text-sm font-semibold text-slate-800 truncate">{post.fileName || 'Document'}</p>
              <p className="text-xs text-slate-400">Tap to open</p>
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
              Couldn't update — try again
            </span>
          )}
          <button onClick={() => onOpenComments(post.id)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-emerald-600">
            <MessageCircle size={18} />
            {post.commentsCount || 0}
          </button>
        </div>
        <button className="text-slate-300 hover:text-emerald-600"><Share2 size={18} /></button>
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
          <h2 className="font-bold text-lg">New Post</h2>
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
            className="text-emerald-600 font-semibold disabled:opacity-40">Publish</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {[{
              id: 'text-image', icon: ImageIcon, label: 'Photo'
            }, {
              id: 'audio', icon: Mic, label: 'Audio'
            }, {
              id: 'document', icon: FileText, label: 'Document'
            }, {
              id: 'youtube', icon: Youtube, label: 'YouTube'
            }, {
              id: 'facebook', icon: Facebook, label: 'Facebook'
            }, {
              id: 'video', icon: Video, label: 'Video'
            }].map(t => (
              <button key={t.id} onClick={() => { setType(t.id as Post['type']); setMediaUrl(''); setFileName(''); setUploadError('') }}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition ${
                  type === t.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-100 text-slate-400'}`}>
                <t.icon size={20} />
                <span className="text-[11px] font-medium">{t.label}</span>
              </button>
            ))}
          </div>

          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder="Share an encouragement, announcement or message..."
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-[15px]" />

          {canUploadDirectly && rule && (
            <div>
              <label className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed transition cursor-pointer ${
                mediaUrl && fileName ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'}`}>
                {uploading ? (
                  <>
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-500">Uploading... {uploadProgress}%</span>
                  </>
                ) : mediaUrl && fileName ? (
                  <>
                    <CheckCircle2 size={22} className="text-emerald-500" />
                    <span className="text-xs text-slate-600 font-medium px-4 text-center break-all">{fileName}</span>
                    <span className="text-[11px] text-emerald-600">Tap to replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={22} className="text-slate-400" />
                    <span className="text-xs text-slate-500 font-medium">Upload {rule.label}</span>
                    <span className="text-[11px] text-slate-400">Max {rule.maxMB}MB</span>
                  </>
                )}
                <input type="file" accept={rule.accept} className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
              {uploadError && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{uploadError}</p>}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="h-px bg-slate-100 flex-1" />
            <span className="text-xs text-slate-400 font-medium">{canUploadDirectly ? 'or paste a link instead' : 'paste a link'}</span>
            <div className="h-px bg-slate-100 flex-1" />
          </div>

          <input value={mediaUrl} onChange={e => { setMediaUrl(e.target.value); setFileName('') }}
            placeholder={
              type === 'youtube' ? 'Paste YouTube link...' :
              type === 'facebook' ? 'Paste Facebook video link...' :
              type === 'audio' ? 'Paste audio file URL (mp3, m4a...)' :
              type === 'document' ? 'Paste a document URL...' :
              'Paste image or video URL...'
            }
            className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />

          {type === 'audio' && (
            <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)}
              placeholder="Paste cover image URL (optional)"
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
          <h2 className="font-bold text-lg">Edit Post</h2>
          <button onClick={handleSave} disabled={!content.trim() || saving}
            className="text-emerald-600 font-semibold disabled:opacity-40">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <div className="p-5">
          <textarea value={content} onChange={e => setContent(e.target.value)}
            className="w-full min-h-[130px] p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-[15px]" />
          {post.mediaUrl && (
            <p className="mt-3 text-xs text-slate-400">
              Only the text can be edited here. To change the attached photo, audio, or video, delete this post and share a new one.
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
  const [text, setText] = useState('')
  const list = comments.filter(c => c.postId === postId)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl max-h-[75vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold">Comments</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {list.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No comments yet</p>}
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
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a comment..."
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
