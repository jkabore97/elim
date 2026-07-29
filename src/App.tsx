import { useState, useEffect } from 'react'
import {
  Home, Church, PlusCircle, User, MessageCircle, Heart, Share2,
  Play, Pause, Image as ImageIcon, Video, Mic, X, Send, LogOut,
  Youtube, Facebook, CheckCircle2, Clock, ArrowRight
} from 'lucide-react'
import {
  collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, doc, updateDoc, increment, setDoc, getDoc
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from 'firebase/auth'
import { auth, db } from './firebase'
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

function Logo({ size = 36 }: { size?: number }) {
  return <img src="/elim-logo.svg" alt="ELIM" style={{ height: size }} className="object-contain" />
}

// ==================== AUTH SCREENS ====================
function AuthScreen({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [accountType, setAccountType] = useState<'member' | 'church'>('member')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [churchName, setChurchName] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
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

        const role: UserRole = accountType === 'church' ? 'pending_church' : 'member'
        const profile: AppUser = {
          uid: cred.user.uid,
          email,
          displayName: name,
          role,
          churchName: accountType === 'church' ? churchName : undefined,
          location: accountType === 'church' ? location : undefined,
          createdAt: serverTimestamp()
        }
        await setDoc(doc(db, 'users', cred.user.uid), profile)
        onSuccess(profile)
      }
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <Logo size={48} />
            <h1 className="mt-6 text-3xl font-bold text-slate-900 tracking-tight">Welcome to ELIM</h1>
            <p className="mt-2 text-slate-500">A peaceful place for the church community</p>
          </div>

          <div className="bg-white rounded-3xl shadow-xl shadow-emerald-100/50 border border-emerald-50 p-8">
            <div className="flex bg-slate-100 rounded-2xl p-1 mb-8">
              <button onClick={() => setMode('login')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                Sign In
              </button>
              <button onClick={() => setMode('register')}
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
              <input required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" minLength={6}
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-[15px]" />

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
        </div>
      </div>
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
  const [activeCommentsPost, setActiveCommentsPost] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  // Comments
  useEffect(() => {
    if (!user || user.role === 'pending_church') return
    const q = query(collection(db, 'comments'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment)))
    })
    return unsub
  }, [user])

  const canPost = user?.role === 'church' || user?.role === 'admin'

  const handleLogout = async () => {
    await signOut(auth)
    setUser(null)
  }

  const handleCreatePost = async (data: { type: Post['type']; content: string; mediaUrl?: string }) => {
    let finalType = data.type
    if (data.mediaUrl) {
      if (getYoutubeId(data.mediaUrl)) finalType = 'youtube'
      else if (isFacebookVideo(data.mediaUrl)) finalType = 'facebook'
    }
    await addDoc(collection(db, 'posts'), {
      churchId: user!.uid,
      churchName: user!.churchName || user!.displayName,
      type: finalType,
      content: data.content,
      mediaUrl: data.mediaUrl || null,
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

  const handleLike = async (id: string) => {
    const post = posts.find(p => p.id === id)
    if (!post) return
    await updateDoc(doc(db, 'posts', id), { likes: increment(post.liked ? -1 : 1) })
    setPosts(prev => prev.map(p => p.id === id ? { ...p, liked: !p.liked, likes: (p.likes || 0) + (p.liked ? -1 : 1) } : p))
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <AuthScreen onSuccess={setUser} />
  if (user.role === 'pending_church') return <PendingScreen user={user} onLogout={handleLogout} />

  return (
    <div className="min-h-screen bg-[#f8faf9] max-w-lg mx-auto relative">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-100/80">
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

      <main className="pb-28 px-4 pt-4">
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
              <PostCard key={post.id} post={post} onLike={handleLike} onOpenComments={setActiveCommentsPost} />
            ))}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 text-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 mx-auto flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-lg shadow-emerald-200">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <h2 className="text-xl font-bold text-slate-900">{user.displayName}</h2>
            <p className="text-slate-400 text-sm mt-1">{user.email}</p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
              {user.role === 'church' ? <><CheckCircle2 size={14} /> Verified Church</> : 'Member'}
            </div>
            {user.churchName && <p className="mt-3 text-slate-600 font-medium">{user.churchName}</p>}
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-100 safe-bottom z-50">
        <div className="max-w-lg mx-auto flex justify-around items-center h-16 px-2">
          {[{
            id: 'feed', icon: Home, label: 'Feed'
          }, {
            id: 'profile', icon: User, label: 'Profile'
          }].map(item => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <button key={item.id} onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center w-20 h-full transition ${
                  active ? 'text-emerald-600' : 'text-slate-400'}`}>
                <Icon size={22} strokeWidth={active ? 2.5 : 2} />
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

      {showCreate && canPost && (
        <CreatePostModal onClose={() => setShowCreate(false)} onSubmit={handleCreatePost} />
      )}
      {activeCommentsPost && (
        <CommentsSheet postId={activeCommentsPost} comments={comments}
          onClose={() => setActiveCommentsPost(null)} onAdd={handleAddComment} />
      )}
    </div>
  )
}

// ==================== COMPONENTS ====================
function PostCard({ post, onLike, onOpenComments }: {
  post: Post; onLike: (id: string) => void; onOpenComments: (id: string) => void
}) {
  const ytId = post.mediaUrl ? getYoutubeId(post.mediaUrl) : null

  return (
    <article className="bg-white rounded-3xl shadow-sm border border-slate-100/80 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
          {(post.churchName || 'C').charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">{post.churchName || 'Church'}</h3>
          <p className="text-xs text-slate-400">{timeAgo(post.createdAt)}</p>
        </div>
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

      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-50">
        <div className="flex items-center gap-5">
          <button onClick={() => onLike(post.id)}
            className={`flex items-center gap-1.5 text-sm font-medium transition ${
              post.liked ? 'text-red-500' : 'text-slate-400 hover:text-red-500'}`}>
            <Heart size={18} fill={post.liked ? 'currentColor' : 'none'} />
            {post.likes || 0}
          </button>
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

function CreatePostModal({ onClose, onSubmit }: {
  onClose: () => void
  onSubmit: (data: { type: Post['type']; content: string; mediaUrl?: string }) => void
}) {
  const [type, setType] = useState<Post['type']>('text-image')
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100"><X size={20} /></button>
          <h2 className="font-bold text-lg">New Post</h2>
          <button onClick={() => { if (content.trim()) { onSubmit({ type, content: content.trim(), mediaUrl: mediaUrl || undefined }); onClose() } }}
            disabled={!content.trim()}
            className="text-emerald-600 font-semibold disabled:opacity-40">Publish</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-4 gap-2">
            {[{
              id: 'text-image', icon: ImageIcon, label: 'Photo'
            }, {
              id: 'youtube', icon: Youtube, label: 'YouTube'
            }, {
              id: 'facebook', icon: Facebook, label: 'Facebook'
            }, {
              id: 'video', icon: Video, label: 'Video'
            }].map(t => (
              <button key={t.id} onClick={() => setType(t.id as Post['type'])}
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

          <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
            placeholder={
              type === 'youtube' ? 'Paste YouTube link...' :
              type === 'facebook' ? 'Paste Facebook video link...' :
              'Paste image or video URL...'
            }
            className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
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
