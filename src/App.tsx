import { useState, useMemo } from 'react'
import {
  Home,
  Church,
  PlusCircle,
  User,
  MessageCircle,
  Heart,
  Share2,
  Play,
  Pause,
  Image as ImageIcon,
  Video,
  Mic,
  X,
  Send,
  MoreHorizontal
} from 'lucide-react'

// ==================== TYPES ====================
type UserRole = 'member' | 'church'

interface ChurchProfile {
  id: string
  name: string
  location: string
  avatar: string
  followers: number
  verified: boolean
}

interface Post {
  id: string
  churchId: string
  type: 'text-image' | 'audio' | 'video'
  content: string
  mediaUrl?: string
  coverUrl?: string
  likes: number
  commentsCount: number
  createdAt: string
  liked?: boolean
}

interface Comment {
  id: string
  postId: string
  userName: string
  userAvatar: string
  text: string
  createdAt: string
}

// ==================== MOCK DATA ====================
const CHURCHES: ChurchProfile[] = [
  {
    id: 'c1',
    name: 'Elim Oasis Church',
    location: 'Newark, NJ',
    avatar: 'https://images.unsplash.com/photo-1438232992991-999c2da56cdb?w=150&h=150&fit=crop',
    followers: 2840,
    verified: true
  },
  {
    id: 'c2',
    name: 'Palm Grove Fellowship',
    location: 'Brooklyn, NY',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop',
    followers: 1520,
    verified: true
  },
  {
    id: 'c3',
    name: 'Living Springs Assembly',
    location: 'Jersey City, NJ',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop',
    followers: 980,
    verified: false
  }
]

const INITIAL_POSTS: Post[] = [
  {
    id: 'p1',
    churchId: 'c1',
    type: 'text-image',
    content: 'Sunday service was powerful! “He leads me beside still waters.” Come experience the presence of God with us this week. 🌴',
    mediaUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop',
    likes: 124,
    commentsCount: 18,
    createdAt: '2026-07-28T10:30:00Z'
  },
  {
    id: 'p2',
    churchId: 'c2',
    type: 'audio',
    content: 'New worship track — “Rivers of Living Water”. Listen and be refreshed.',
    mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=400&fit=crop',
    likes: 89,
    commentsCount: 12,
    createdAt: '2026-07-27T18:15:00Z'
  },
  {
    id: 'p3',
    churchId: 'c1',
    type: 'video',
    content: 'Highlights from last Friday’s youth night. The next generation is rising!',
    mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    likes: 210,
    commentsCount: 34,
    createdAt: '2026-07-26T21:00:00Z'
  },
  {
    id: 'p4',
    churchId: 'c3',
    type: 'text-image',
    content: 'Midweek prayer tonight at 7 PM. All are welcome. Let’s gather under the palm trees of God’s presence.',
    mediaUrl: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800&h=500&fit=crop',
    likes: 56,
    commentsCount: 7,
    createdAt: '2026-07-25T14:20:00Z'
  }
]

const INITIAL_COMMENTS: Comment[] = [
  { id: 'cm1', postId: 'p1', userName: 'Sarah M.', userAvatar: '', text: 'Amen! Such a beautiful service.', createdAt: '2026-07-28T11:00:00Z' },
  { id: 'cm2', postId: 'p1', userName: 'David K.', userAvatar: '', text: 'Looking forward to next Sunday 🙏', createdAt: '2026-07-28T12:15:00Z' },
  { id: 'cm3', postId: 'p2', userName: 'Grace T.', userAvatar: '', text: 'This track is anointed!', createdAt: '2026-07-27T19:00:00Z' }
]

// ==================== HELPERS ====================
function timeAgo(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

// ==================== COMPONENTS ====================

function Logo({ size = 32 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/elim-logo.svg" alt="ELIM" className="object-contain" style={{ height: size, width: 'auto' }} />
    </div>
  )
}

function BottomNav({
  active,
  onChange,
  canPost
}: {
  active: string
  onChange: (tab: string) => void
  canPost: boolean
}) {
  const items = [
    { id: 'feed', icon: Home, label: 'Feed' },
    { id: 'churches', icon: Church, label: 'Churches' },
    ...(canPost ? [{ id: 'create', icon: PlusCircle, label: 'Post' }] : []),
    { id: 'profile', icon: User, label: 'Profile' }
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 safe-bottom z-50">
      <div className="max-w-lg mx-auto flex justify-around items-center h-16">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
                isActive ? 'text-elim-600' : 'text-slate-400'
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function PostCard({
  post,
  church,
  onLike,
  onOpenComments
}: {
  post: Post
  church: ChurchProfile
  onLike: (id: string) => void
  onOpenComments: (id: string) => void
}) {
  const [playing, setPlaying] = useState(false)

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
      <div className="flex items-center gap-3 p-4">
        <img
          src={church.avatar}
          alt={church.name}
          className="w-11 h-11 rounded-full object-cover ring-2 ring-elim-100"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-slate-900 truncate">{church.name}</h3>
            {church.verified && (
              <span className="text-elim-500 text-xs">✓</span>
            )}
          </div>
          <p className="text-xs text-slate-500">{timeAgo(post.createdAt)} · {church.location}</p>
        </div>
        <button className="text-slate-400 p-1">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <p className="text-slate-800 text-[15px] leading-relaxed whitespace-pre-wrap">{post.content}</p>
      </div>

      {post.type === 'text-image' && post.mediaUrl && (
        <div className="relative">
          <img src={post.mediaUrl} alt="" className="w-full max-h-80 object-cover" />
        </div>
      )}

      {post.type === 'audio' && (
        <div className="mx-4 mb-3 bg-gradient-to-br from-elim-50 to-elim-100 rounded-xl p-4 flex items-center gap-4">
          <button
            onClick={() => setPlaying(!playing)}
            className="w-12 h-12 rounded-full bg-elim-600 text-white flex items-center justify-center shadow-md"
          >
            {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          <div className="flex-1">
            <p className="font-medium text-slate-800 text-sm">Worship Audio</p>
            <p className="text-xs text-slate-500">Tap to play</p>
          </div>
          {post.coverUrl && (
            <img src={post.coverUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
          )}
        </div>
      )}

      {post.type === 'video' && post.mediaUrl && (
        <div className="relative bg-black">
          <video
            src={post.mediaUrl}
            controls
            className="w-full max-h-72"
            poster={post.coverUrl}
          />
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-50">
        <div className="flex items-center gap-5">
          <button
            onClick={() => onLike(post.id)}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              post.liked ? 'text-red-500' : 'text-slate-500 hover:text-red-500'
            }`}
          >
            <Heart size={18} fill={post.liked ? 'currentColor' : 'none'} />
            {post.likes}
          </button>
          <button
            onClick={() => onOpenComments(post.id)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-elim-600"
          >
            <MessageCircle size={18} />
            {post.commentsCount}
          </button>
        </div>
        <button className="text-slate-400 hover:text-elim-600">
          <Share2 size={18} />
        </button>
      </div>
    </article>
  )
}

function CreatePostModal({
  onClose,
  onSubmit
}: {
  onClose: () => void
  onSubmit: (data: { type: Post['type']; content: string; mediaUrl?: string }) => void
}) {
  const [type, setType] = useState<Post['type']>('text-image')
  const [content, setContent] = useState('')
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)

  const handleSubmit = () => {
    if (!content.trim()) return
    onSubmit({
      type,
      content: content.trim(),
      mediaUrl: mediaPreview || undefined
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
          <button onClick={onClose} className="p-1 text-slate-500">
            <X size={22} />
          </button>
          <h2 className="font-semibold text-lg">New Post</h2>
          <button
            onClick={handleSubmit}
            disabled={!content.trim()}
            className="text-elim-600 font-semibold disabled:opacity-40"
          >
            Publish
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            {[
              { id: 'text-image', icon: ImageIcon, label: 'Photo' },
              { id: 'audio', icon: Mic, label: 'Audio' },
              { id: 'video', icon: Video, label: 'Video' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id as Post['type'])}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${
                  type === t.id
                    ? 'border-elim-500 bg-elim-50 text-elim-700'
                    : 'border-slate-200 text-slate-500'
                }`}
              >
                <t.icon size={20} />
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            ))}
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share an encouragement, announcement, or worship moment..."
            className="w-full min-h-[120px] p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-elim-400 resize-none text-[15px]"
          />

          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
            <p className="text-sm text-slate-500 mb-2">
              {type === 'text-image' && 'Add a photo'}
              {type === 'audio' && 'Upload audio + cover image'}
              {type === 'video' && 'Upload a video'}
            </p>
            <button
              onClick={() => {
                if (type === 'text-image') {
                  setMediaPreview('https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800&h=500&fit=crop')
                } else if (type === 'audio') {
                  setMediaPreview('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3')
                } else {
                  setMediaPreview('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4')
                }
              }}
              className="text-sm font-medium text-elim-600"
            >
              {mediaPreview ? 'Change media' : 'Select media (demo)'}
            </button>
            {mediaPreview && (
              <p className="text-xs text-elim-600 mt-2 truncate">Media selected ✓</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CommentsSheet({
  postId,
  comments,
  onClose,
  onAdd
}: {
  postId: string
  comments: Comment[]
  onClose: () => void
  onAdd: (text: string) => void
}) {
  const [text, setText] = useState('')
  const postComments = comments.filter((c) => c.postId === postId)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl max-h-[75vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold">Comments</h3>
          <button onClick={onClose} className="p-1">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {postComments.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">No comments yet. Be the first!</p>
          )}
          {postComments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-elim-100 flex items-center justify-center text-elim-700 font-semibold text-sm">
                {c.userName.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="bg-slate-50 rounded-2xl px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">{c.userName}</p>
                  <p className="text-sm text-slate-700">{c.text}</p>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 ml-1">{timeAgo(c.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-slate-100 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a comment..."
            className="flex-1 bg-slate-100 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-elim-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                onAdd(text.trim())
                setText('')
              }
            }}
          />
          <button
            onClick={() => {
              if (text.trim()) {
                onAdd(text.trim())
                setText('')
              }
            }}
            className="w-10 h-10 rounded-full bg-elim-600 text-white flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== MAIN APP ====================
export default function App() {
  const [role, setRole] = useState<UserRole>('member')
  const [activeTab, setActiveTab] = useState('feed')
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [comments, setComments] = useState<Comment[]>(INITIAL_COMMENTS)
  const [showCreate, setShowCreate] = useState(false)
  const [activeCommentsPost, setActiveCommentsPost] = useState<string | null>(null)

  const canPost = role === 'church'

  const churchMap = useMemo(() => {
    const map: Record<string, ChurchProfile> = {}
    CHURCHES.forEach((c) => (map[c.id] = c))
    return map
  }, [])

  const handleLike = (id: string) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
          : p
      )
    )
  }

  const handleCreatePost = (data: { type: Post['type']; content: string; mediaUrl?: string }) => {
    const newPost: Post = {
      id: `p${Date.now()}`,
      churchId: 'c1',
      type: data.type,
      content: data.content,
      mediaUrl: data.mediaUrl,
      likes: 0,
      commentsCount: 0,
      createdAt: new Date().toISOString()
    }
    setPosts((prev) => [newPost, ...prev])
  }

  const handleAddComment = (text: string) => {
    if (!activeCommentsPost) return
    const newComment: Comment = {
      id: `cm${Date.now()}`,
      postId: activeCommentsPost,
      userName: role === 'church' ? 'Elim Oasis Church' : 'You',
      userAvatar: '',
      text,
      createdAt: new Date().toISOString()
    }
    setComments((prev) => [...prev, newComment])
    setPosts((prev) =>
      prev.map((p) =>
        p.id === activeCommentsPost ? { ...p, commentsCount: p.commentsCount + 1 } : p
      )
    )
  }

  return (
    <div className="min-h-full bg-slate-50 max-w-lg mx-auto relative">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="px-4 h-14 flex items-center justify-between">
          <Logo size={28} />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">View as:</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="text-xs font-semibold bg-elim-50 text-elim-800 border border-elim-200 rounded-full px-3 py-1 focus:outline-none"
            >
              <option value="member">Member</option>
              <option value="church">Church Admin</option>
            </select>
          </div>
        </div>
      </header>

      <main className="pb-24 px-3 pt-3">
        {activeTab === 'feed' && (
          <div>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                church={churchMap[post.churchId]}
                onLike={handleLike}
                onOpenComments={(id) => setActiveCommentsPost(id)}
              />
            ))}
          </div>
        )}

        {activeTab === 'churches' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900 px-1 mb-2">Churches on ELIM</h2>
            {CHURCHES.map((church) => (
              <div
                key={church.id}
                className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-slate-100"
              >
                <img
                  src={church.avatar}
                  alt={church.name}
                  className="w-14 h-14 rounded-full object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-slate-900 truncate">{church.name}</h3>
                    {church.verified && <span className="text-elim-500">✓</span>}
                  </div>
                  <p className="text-sm text-slate-500">{church.location}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{church.followers.toLocaleString()} followers</p>
                </div>
                <button className="px-4 py-1.5 rounded-full bg-elim-600 text-white text-sm font-medium">
                  Follow
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 text-center">
            <div className="w-20 h-20 rounded-full bg-elim-100 mx-auto flex items-center justify-center text-3xl font-bold text-elim-700 mb-3">
              {role === 'church' ? 'EO' : 'U'}
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              {role === 'church' ? 'Elim Oasis Church' : 'Community Member'}
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              {role === 'church'
                ? 'You can publish posts, photos, audio & video'
                : 'You can view content and leave comments'}
            </p>
            <div className="mt-6 pt-4 border-t border-slate-100 text-left space-y-2 text-sm text-slate-600">
              <p>• Only verified church profiles can publish content</p>
              <p>• Members can comment, like and share</p>
              <p>• All content is moderated for a safe community</p>
            </div>
          </div>
        )}

        {activeTab === 'create' && canPost && (
          <div className="text-center py-12">
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-elim-600 text-white rounded-full font-semibold shadow-lg shadow-elim-200"
            >
              <PlusCircle size={20} />
              Create New Post
            </button>
          </div>
        )}
      </main>

      <BottomNav
        active={activeTab}
        onChange={(tab) => {
          if (tab === 'create') {
            setShowCreate(true)
          } else {
            setActiveTab(tab)
          }
        }}
        canPost={canPost}
      />

      {showCreate && canPost && (
        <CreatePostModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreatePost}
        />
      )}

      {activeCommentsPost && (
        <CommentsSheet
          postId={activeCommentsPost}
          comments={comments}
          onClose={() => setActiveCommentsPost(null)}
          onAdd={handleAddComment}
        />
      )}
    </div>
  )
}
