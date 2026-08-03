import { useState, useEffect, useRef, useMemo } from 'react'
import {
  collection, doc, setDoc, addDoc, updateDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, getDoc, getDocs
} from 'firebase/firestore'
import { ArrowLeft, Send, Search, MessageCircle, Plus, X, LifeBuoy, ShieldCheck } from 'lucide-react'
import { db } from './firebase'
import { useLanguage } from './i18n'
import type { AppUser, Conversation, Message } from './types'

// Staff = anyone who can see the support inbox and start conversations.
export function isStaff(user: AppUser) {
  return user.role === 'church' || user.role === 'admin'
}

// Deterministic IDs mean a given pair (or a given member's support thread)
// can only ever have one conversation - no duplicate threads if two people
// hit "message" at the same moment.
export function supportConversationId(memberUid: string) {
  return `support_${memberUid}`
}
export function directConversationId(uidA: string, uidB: string) {
  return `direct_${[uidA, uidB].sort().join('_')}`
}

function timeShort(date: any): string {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ==================== CHAT VIEW ====================

function ChatView({ conversation, user, onBack }: {
  conversation: Conversation
  user: AppUser
  onBack?: () => void
}) {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      where('conversationId', '==', conversation.id),
      orderBy('createdAt', 'asc'),
      limit(500)
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)))
      setError('')
      setLoading(false)
    }, err => {
      setError(err?.message || String(err))
      setLoading(false)
    })
    return () => unsub()
  }, [conversation.id])

  // Mark read whenever the thread is open and new messages land.
  useEffect(() => {
    updateDoc(doc(db, 'conversations', conversation.id), {
      [`readBy.${user.uid}`]: serverTimestamp()
    }).catch(() => {})
  }, [conversation.id, messages.length, user.uid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      // The conversation doc may not exist yet (a member opening support for
      // the very first time), so this upserts it before the message lands.
      await setDoc(doc(db, 'conversations', conversation.id), {
        type: conversation.type,
        participantIds: conversation.participantIds,
        participantNames: conversation.participantNames,
        lastMessage: body.slice(0, 120),
        lastMessageAt: serverTimestamp(),
        lastSenderId: user.uid,
        [`readBy.${user.uid}`]: serverTimestamp(),
        createdAt: conversation.createdAt || serverTimestamp()
      }, { merge: true })

      await addDoc(collection(db, 'messages'), {
        conversationId: conversation.id,
        senderId: user.uid,
        senderName: user.displayName,
        senderRole: user.role,
        text: body,
        participantIds: conversation.participantIds,
        createdAt: serverTimestamp()
      })
      setText('')
    } catch (err: any) {
      setError(err?.message || t('msg.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  // For a member, the other side is "Support". For staff, it's whoever the
  // thread belongs to.
  const title = conversation.type === 'support'
    ? (isStaff(user)
        ? (conversation.participantNames[conversation.participantIds[0]] || t('msg.support'))
        : t('msg.support'))
    : (conversation.participantNames[conversation.participantIds.find(id => id !== user.uid) || ''] || t('msg.conversation'))

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] lg:h-[calc(100vh-10rem)]">
      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
        {onBack && (
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-white/5 text-slate-300">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
          conversation.type === 'support' && !isStaff(user)
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold'}`}>
          {conversation.type === 'support' && !isStaff(user)
            ? <LifeBuoy size={18} />
            : title.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-white truncate">{title}</h2>
          {conversation.type === 'support' && (
            <p className="text-[11px] text-slate-400">
              {isStaff(user) ? t('msg.supportThread') : t('msg.supportSubtitle')}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {loading && <p className="text-center text-slate-400 py-10 text-sm">{t('app.loading')}</p>}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
            <p className="text-sm text-red-400 break-words">{error}</p>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
              <MessageCircle size={24} className="text-emerald-400" />
            </div>
            <p className="text-slate-300 text-sm font-medium">{t('msg.noMessages')}</p>
            <p className="text-xs text-slate-500 mt-1 px-8 leading-relaxed">
              {conversation.type === 'support' && !isStaff(user) ? t('msg.supportHint') : t('msg.startHint')}
            </p>
          </div>
        )}

        {messages.map(m => {
          const mine = m.senderId === user.uid
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                mine ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] border border-white/10 text-slate-100'}`}>
                {!mine && (
                  <p className="text-[11px] font-semibold text-emerald-400 mb-0.5">
                    {m.senderName}
                    {(m.senderRole === 'church' || m.senderRole === 'admin') && ` · ${t('msg.staffBadge')}`}
                  </p>
                )}
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
                <p className={`text-[10px] mt-1 ${mine ? 'text-emerald-100/70' : 'text-slate-500'}`}>
                  {timeShort(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="pt-3 border-t border-white/10 flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder={t('msg.writePlaceholder')}
          className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]"
        />
        <button onClick={handleSend} disabled={!text.trim() || sending}
          className="w-12 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0 transition">
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}

// ==================== NEW MESSAGE PICKER (staff only) ====================

function NewMessagePicker({ user, onPick, onClose }: {
  user: AppUser
  onPick: (target: AppUser) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [people, setPeople] = useState<AppUser[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then(snap => {
        setPeople(snap.docs
          .map(d => ({ uid: d.id, ...d.data() } as AppUser))
          .filter(p => p.uid !== user.uid))
        setLoading(false)
      })
      .catch(err => { setError(err?.message || String(err)); setLoading(false) })
  }, [user.uid])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return people
    return people.filter(p =>
      (p.displayName || '').toLowerCase().includes(q) ||
      (p.churchName || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q)
    )
  }, [people, search])

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-[#0d1424] w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-bold text-white">{t('msg.newMessage')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/5 text-slate-400">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('msg.searchPeople')}
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5">
          {loading && <p className="text-center text-slate-400 py-10 text-sm">{t('app.loading')}</p>}
          {!loading && error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <p className="text-center text-slate-400 py-10 text-sm">{t('msg.noPeople')}</p>
          )}
          <div className="space-y-1">
            {visible.map(p => (
              <button key={p.uid} onClick={() => onPick(p)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/5 transition text-left">
                {p.avatar ? (
                  <img src={p.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold shrink-0">
                    {(p.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{p.displayName}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {p.role === 'church' || p.role === 'admin'
                      ? (p.churchName || t('msg.roleStaff'))
                      : (p.memberChurchName || t('msg.roleMember'))}
                  </p>
                </div>
                {(p.role === 'church' || p.role === 'admin') && (
                  <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== CONVERSATION LIST (staff only) ====================

function ConversationList({ user, onOpen }: {
  user: AppUser
  onOpen: (c: Conversation) => void
}) {
  const { t } = useLanguage()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)))
      setError('')
      setLoading(false)
    }, err => {
      setError(err?.message || String(err))
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const visible = useMemo(() => {
    // Staff see every support thread, plus any direct thread they're in -
    // but not other people's private direct threads.
    let result = conversations.filter(c =>
      c.type === 'support' || c.participantIds.includes(user.uid)
    )
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(c =>
        Object.values(c.participantNames || {}).some(n => (n || '').toLowerCase().includes(q)) ||
        (c.lastMessage || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [conversations, user.uid, search])

  const startDirect = async (target: AppUser) => {
    const id = directConversationId(user.uid, target.uid)
    const existing = await getDoc(doc(db, 'conversations', id))
    const convo: Conversation = existing.exists()
      ? ({ id, ...existing.data() } as Conversation)
      : {
          id,
          type: 'direct',
          participantIds: [user.uid, target.uid],
          participantNames: {
            [user.uid]: user.displayName,
            [target.uid]: target.displayName
          }
        }
    setPicking(false)
    onOpen(convo)
  }

  const titleFor = (c: Conversation) => {
    if (c.type === 'support') {
      return c.participantNames?.[c.participantIds[0]] || t('msg.support')
    }
    const other = c.participantIds.find(id => id !== user.uid) || ''
    return c.participantNames?.[other] || t('msg.conversation')
  }

  const isUnread = (c: Conversation) => {
    if (!c.lastMessageAt || c.lastSenderId === user.uid) return false
    const readAt = c.readBy?.[user.uid]
    if (!readAt) return true
    const r = readAt.toDate ? readAt.toDate() : new Date(readAt)
    const l = c.lastMessageAt.toDate ? c.lastMessageAt.toDate() : new Date(c.lastMessageAt)
    return l > r
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('msg.searchConversations')}
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]" />
        </div>
        <button onClick={() => setPicking(true)}
          className="w-12 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0 transition shadow-lg shadow-emerald-500/20">
          <Plus size={20} />
        </button>
      </div>

      {loading && <p className="text-center text-slate-400 py-16">{t('app.loading')}</p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <p className="text-sm font-semibold text-red-400">{t('msg.loadFailed')}</p>
          <p className="text-xs text-red-300 mt-1.5 break-words">{error}</p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <MessageCircle size={28} className="text-emerald-400" />
          </div>
          <p className="text-slate-300 font-medium">{t('msg.noConversations')}</p>
          <p className="text-sm text-slate-500 mt-1">{t('msg.noConversationsHint')}</p>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          {visible.map((c, i) => {
            const unread = isUnread(c)
            return (
              <button key={c.id} onClick={() => onOpen(c)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition ${
                  i !== visible.length - 1 ? 'border-b border-slate-50' : ''}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
                  c.type === 'support'
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold'}`}>
                  {c.type === 'support' ? <LifeBuoy size={18} /> : titleFor(c).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {titleFor(c)}
                    </span>
                    {c.type === 'support' && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0">
                        {t('msg.supportTag')}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 ml-auto shrink-0">{timeShort(c.lastMessageAt)}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${unread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                    {c.lastMessage || t('msg.noMessagesYet')}
                  </p>
                </div>
                {unread && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      {picking && (
        <NewMessagePicker user={user} onPick={startDirect} onClose={() => setPicking(false)} />
      )}
    </div>
  )
}

// ==================== TAB ENTRY POINT ====================

export function MessagesTab({ user }: { user: AppUser }) {
  const [openConversation, setOpenConversation] = useState<Conversation | null>(null)

  // Members never see a list - there's exactly one thread they can have, so
  // sending them through an inbox with a single row would be pure friction.
  if (!isStaff(user)) {
    const id = supportConversationId(user.uid)
    const convo: Conversation = {
      id,
      type: 'support',
      participantIds: [user.uid],
      participantNames: { [user.uid]: user.displayName }
    }
    return <ChatView conversation={convo} user={user} />
  }

  if (openConversation) {
    return (
      <ChatView
        conversation={openConversation}
        user={user}
        onBack={() => setOpenConversation(null)}
      />
    )
  }

  return <ConversationList user={user} onOpen={setOpenConversation} />
}
