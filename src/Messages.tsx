import { useState, useEffect, useRef, useMemo } from 'react'
import {
  collection, doc, setDoc, addDoc, onSnapshot,
  query, where, limit, serverTimestamp, getDocs
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  ArrowLeft, Send, Search, MessageCircle, Plus, X, LifeBuoy,
  ShieldCheck, HeartHandshake, Image as ImageIcon, Mic, Trash2, Play, Pause
} from 'lucide-react'
import { db, storage } from './firebase'
import { useLanguage } from './i18n'
import { ImageLightbox } from './ImageLightbox'
import type { AppUser, Conversation, Message } from './types'

// Staff = the two accounts that receive and answer messages. Church accounts
// are deliberately NOT staff here: for messaging they are recipients like any
// member, and get the same two support channels.
export function isStaff(user: AppUser) {
  return user.role === 'pastor' || user.role === 'admin'
}

export function pastorConversationId(uid: string) { return `pastor_${uid}` }
export function techConversationId(uid: string) { return `tech_${uid}` }
export function directConversationId(a: string, b: string) {
  return `direct_${[a, b].sort().join('_')}`
}

// Single source of truth for how each role is labelled and coloured, so a
// pastor looks like a pastor everywhere rather than drifting between screens.
export function roleMeta(role: string, t: (k: any) => string) {
  switch (role) {
    case 'pastor':
      return { label: t('role.pastor'), chip: 'bg-indigo-100 text-indigo-700', Icon: HeartHandshake }
    case 'admin':
      return { label: t('role.admin'), chip: 'bg-blue-100 text-blue-700', Icon: ShieldCheck }
    case 'church':
      return { label: t('role.church'), chip: 'bg-emerald-100 text-emerald-700', Icon: ShieldCheck }
    case 'pending_church':
      return { label: t('role.pendingChurch'), chip: 'bg-amber-100 text-amber-700', Icon: ShieldCheck }
    default:
      return { label: t('role.member'), chip: 'bg-slate-100 text-slate-600', Icon: MessageCircle }
  }
}

function timeShort(date: any): string {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function fmtDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ==================== AUDIO BUBBLE ====================

function AudioBubble({ url, mine }: { url: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) a.pause()
    else a.play().catch(() => {})
  }

  return (
    <div className="flex items-center gap-2.5 py-1">
      <button onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          mine ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-400'}`}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="flex items-end gap-0.5 h-6">
        {[6, 11, 8, 16, 12, 20, 14, 9, 17, 11, 7, 13, 9, 5].map((h, i) => (
          <span key={i} className={`w-0.5 rounded-full ${mine ? 'bg-white/80' : 'bg-emerald-400/80'}`}
            style={{ height: h }} />
        ))}
      </div>
      <audio ref={audioRef} src={url} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)} />
    </div>
  )
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
  const [lightbox, setLightbox] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Firestore rejects a whole query unless it can prove UP FRONT that every
    // result is readable - rules filter nothing. A member's read rule depends
    // on participantIds, so the query must filter on participantIds too, or
    // the entire query is denied. Staff read rules are unconditional
    // (isPastor/isTechAdmin), so their query needs no such filter - and must
    // not have one, since staff are deliberately absent from participantIds
    // on channel threads.
    const constraints: any[] = [where('conversationId', '==', conversation.id)]
    if (!isStaff(user)) {
      constraints.push(where('participantIds', 'array-contains', user.uid))
    }
    const q = query(collection(db, 'messages'), ...constraints, limit(500))

    const unsub = onSnapshot(q, snap => {
      // Sorted client-side rather than with orderBy() so this needs no
      // composite index on top of the filters above.
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message))
      rows.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return ta - tb
      })
      setMessages(rows)
      setError('')
      setLoading(false)
    }, err => { setError(err?.message || String(err)); setLoading(false) })
    return () => unsub()
  }, [conversation.id, user.uid, user.role])

  useEffect(() => {
    // setDoc+merge rather than updateDoc: updateDoc throws if the document
    // doesn't exist yet, which is exactly the case the first time someone
    // opens a channel they've never written in.
    if (messages.length > 0) {
      setDoc(doc(db, 'conversations', conversation.id), {
        [`readBy.${user.uid}`]: serverTimestamp()
      }, { merge: true }).catch(() => {})
    }
  }, [conversation.id, messages.length, user.uid])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  // The parent conversation doc may not exist yet (someone opening a channel
  // for the very first time), so this upserts it before the message lands.
  const upsertConversation = async (preview: string) => {
    const payload: any = {
      type: conversation.type,
      participantIds: conversation.participantIds,
      participantNames: conversation.participantNames,
      lastMessage: preview.slice(0, 120),
      lastMessageAt: serverTimestamp(),
      lastSenderId: user.uid,
      [`readBy.${user.uid}`]: serverTimestamp()
    }
    // createdAt and ownerRole describe the thread's origin, so they're only
    // written when the thread is genuinely new. Previously createdAt was
    // rewritten on every single send (members always build a fresh in-memory
    // conversation with no createdAt), and ownerRole was overwritten with the
    // replier's role whenever staff answered a member - so a member's thread
    // started reporting itself as owned by an admin.
    if (!conversation.createdAt) {
      payload.createdAt = serverTimestamp()
      payload.ownerRole = conversation.ownerRole || user.role
    }
    await setDoc(doc(db, 'conversations', conversation.id), payload, { merge: true })
  }

  const pushMessage = async (payload: Partial<Message>, preview: string) => {
    await upsertConversation(preview)
    await addDoc(collection(db, 'messages'), {
      conversationId: conversation.id,
      senderId: user.uid,
      senderName: user.displayName,
      senderRole: user.role,
      text: payload.text || '',
      participantIds: conversation.participantIds,
      ...(payload.mediaUrl ? { mediaUrl: payload.mediaUrl, mediaType: payload.mediaType } : {}),
      ...(payload.mediaDuration ? { mediaDuration: payload.mediaDuration } : {}),
      createdAt: serverTimestamp()
    })
  }

  const handleSend = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true); setError('')
    try {
      await pushMessage({ text: body }, body)
      setText('')
    } catch (err: any) {
      setError(err?.message || t('msg.sendFailed'))
    } finally { setSending(false) }
  }

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError(t('msg.notAnImage')); return }
    if (file.size > 10 * 1024 * 1024) { setError(t('msg.imageTooLarge')); return }
    setSending(true); setError('')
    try {
      const sref = ref(storage, `message-media/${user.uid}/${Date.now()}-${file.name}`)
      await uploadBytes(sref, file)
      const url = await getDownloadURL(sref)
      await pushMessage({ mediaUrl: url, mediaType: 'image', text: text.trim() }, t('msg.sentPhoto'))
      setText('')
    } catch (err: any) {
      setError(err?.message || t('msg.sendFailed'))
    } finally { setSending(false) }
  }

  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = ev => { if (ev.data.size > 0) chunksRef.current.push(ev.data) }
      recorder.onstop = () => stream.getTracks().forEach(tk => tk.stop())
      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch {
      setError(t('msg.micDenied'))
    }
  }

  const stopRecording = async (send: boolean) => {
    const recorder = recorderRef.current
    if (!recorder) return
    clearInterval(timerRef.current)
    const seconds = elapsed
    setRecording(false)

    await new Promise<void>(resolve => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })

    if (!send || chunksRef.current.length === 0) { chunksRef.current = []; return }

    setSending(true)
    try {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm'
      const sref = ref(storage, `message-media/${user.uid}/${Date.now()}-voice.${ext}`)
      await uploadBytes(sref, blob)
      const url = await getDownloadURL(sref)
      await pushMessage({ mediaUrl: url, mediaType: 'audio', mediaDuration: seconds }, t('msg.sentVoice'))
    } catch (err: any) {
      setError(err?.message || t('msg.sendFailed'))
    } finally {
      chunksRef.current = []
      setSending(false)
    }
  }

  const staff = isStaff(user)
  const channelMeta = conversation.type === 'pastor'
    ? { label: t('msg.pastorChannel'), Icon: HeartHandshake, tone: 'bg-indigo-500/15 text-indigo-400' }
    : conversation.type === 'tech'
      ? { label: t('msg.techChannel'), Icon: LifeBuoy, tone: 'bg-blue-500/15 text-blue-400' }
      : { label: '', Icon: MessageCircle, tone: 'bg-emerald-500/15 text-emerald-400' }

  const otherUid = conversation.participantIds.find(id => id !== user.uid) || conversation.participantIds[0]
  const title = conversation.type === 'direct'
    ? (conversation.participantNames?.[otherUid] || t('msg.conversation'))
    : staff
      ? (conversation.participantNames?.[conversation.participantIds[0]] || t('msg.conversation'))
      : channelMeta.label

  const ChannelIcon = channelMeta.Icon

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] lg:h-[calc(100vh-10rem)]">
      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
        {onBack && (
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-white/5 text-slate-300">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${channelMeta.tone}`}>
          <ChannelIcon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-white truncate">{title}</h2>
          <p className="text-[11px] text-slate-400 truncate">
            {conversation.type === 'direct'
              ? roleMeta(conversation.ownerRole || 'member', t).label
              : staff ? channelMeta.label : t('msg.usuallyReplies')}
          </p>
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
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${channelMeta.tone}`}>
              <ChannelIcon size={24} />
            </div>
            <p className="text-slate-300 text-sm font-medium">{t('msg.noMessages')}</p>
            <p className="text-xs text-slate-500 mt-1 px-8 leading-relaxed">
              {conversation.type === 'pastor' ? t('msg.pastorHint')
                : conversation.type === 'tech' ? t('msg.techHint')
                : t('msg.startHint')}
            </p>
          </div>
        )}

        {messages.map(m => {
          const mine = m.senderId === user.uid
          const meta = roleMeta(m.senderRole, t)
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${
                mine ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] border border-white/10 text-slate-100'}`}>
                {!mine && (
                  <p className="text-[11px] font-semibold text-emerald-400 mb-1 flex items-center gap-1.5 flex-wrap">
                    {m.senderName}
                    {(m.senderRole === 'pastor' || m.senderRole === 'admin') && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.chip}`}>
                        {meta.label}
                      </span>
                    )}
                  </p>
                )}

                {m.mediaType === 'image' && m.mediaUrl && (
                  <img src={m.mediaUrl} alt="" onClick={() => setLightbox(m.mediaUrl!)}
                    className="rounded-xl max-h-64 w-auto mb-1 cursor-zoom-in" />
                )}

                {m.mediaType === 'audio' && m.mediaUrl && (
                  <AudioBubble url={m.mediaUrl} mine={mine} />
                )}

                {m.text && (
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
                )}

                <p className={`text-[10px] mt-1 ${mine ? 'text-emerald-100/70' : 'text-slate-500'}`}>
                  {m.mediaType === 'audio' && m.mediaDuration ? `${fmtDuration(m.mediaDuration)} · ` : ''}
                  {timeShort(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="pt-3 border-t border-white/10">
        {recording ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-sm font-medium text-red-300 tabular-nums">{fmtDuration(elapsed)}</span>
            <span className="text-xs text-slate-400 flex-1 truncate">{t('msg.recording')}</span>
            <button onClick={() => stopRecording(false)}
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0">
              <Trash2 size={16} />
            </button>
            <button onClick={() => stopRecording(true)}
              className="w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0">
              <Send size={15} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <label className="w-11 h-11 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0 cursor-pointer transition">
              <ImageIcon size={18} />
              <input type="file" accept="image/*" className="hidden" onChange={handleImage} disabled={sending} />
            </label>
            <button onClick={startRecording} disabled={sending}
              className="w-11 h-11 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0 transition disabled:opacity-50">
              <Mic size={18} />
            </button>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={t('msg.writePlaceholder')}
              className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[15px]"
            />
            <button onClick={handleSend} disabled={!text.trim() || sending}
              className="w-11 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0 transition">
              <Send size={18} />
            </button>
          </div>
        )}
        {sending && <p className="text-[11px] text-slate-500 mt-2 text-center">{t('msg.sending')}</p>}
      </div>

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
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
        setPeople(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)).filter(p => p.uid !== user.uid))
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
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/5 text-slate-400"><X size={20} /></button>
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
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 break-words">{error}</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <p className="text-center text-slate-400 py-10 text-sm">{t('msg.noPeople')}</p>
          )}
          <div className="space-y-1">
            {visible.map(p => {
              const meta = roleMeta(p.role, t)
              return (
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
                      {p.churchName || p.memberChurchName || p.phone || ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${meta.chip}`}>
                    {meta.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== STAFF INBOX ====================

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
    // Same constraint as above: an unfiltered "all conversations" query can't
    // be proven safe, so Firestore denies it outright. Split into two queries
    // that CAN be proven - the channel this account answers, and direct
    // threads it belongs to - then merged here.
    const myChannel = user.role === 'pastor' ? 'pastor' : 'tech'
    let channelRows: Conversation[] = []
    let directRows: Conversation[] = []

    const publish = () => {
      const byId = new Map<string, Conversation>()
      for (const row of [...channelRows, ...directRows]) byId.set(row.id, row)
      const merged = Array.from(byId.values())
      merged.sort((a, b) => {
        const ta = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : 0
        const tb = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : 0
        return tb - ta
      })
      setConversations(merged)
      setLoading(false)
    }

    const unsubChannel = onSnapshot(
      query(collection(db, 'conversations'), where('type', '==', myChannel), limit(200)),
      snap => {
        channelRows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation))
        setError('')
        publish()
      },
      err => { setError(err?.message || String(err)); setLoading(false) }
    )

    const unsubDirect = onSnapshot(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', user.uid), limit(200)),
      snap => {
        directRows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation))
        publish()
      },
      err => { setError(err?.message || String(err)); setLoading(false) }
    )

    return () => { unsubChannel(); unsubDirect() }
  }, [user.uid, user.role])

  const visible = useMemo(() => {
    // The pastor sees pastoral threads; the technical admin sees technical
    // threads. Both see their own direct conversations. This split is
    // deliberate - pastoral messages are often personal, and shouldn't land
    // in a technical support queue.
    let result = conversations
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(c =>
        Object.values(c.participantNames || {}).some(n => (n || '').toLowerCase().includes(q)) ||
        (c.lastMessage || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [conversations, user.uid, user.role, search])

  const startDirect = async (target: AppUser) => {
    setPicking(false)
    setError('')
    const id = directConversationId(user.uid, target.uid)
    const base: Conversation = {
      id,
      type: 'direct',
      participantIds: [user.uid, target.uid],
      participantNames: { [user.uid]: user.displayName, [target.uid]: target.displayName },
      ownerRole: target.role
    }
    // Deliberately NOT doing a getDoc() first. Reading a conversation that
    // doesn't exist yet makes the security rule dereference a null resource,
    // which Firestore reports as permission-denied - so starting a brand new
    // thread always failed, and staff could only ever reply to people who
    // wrote first. Opening the constructed thread directly works whether or
    // not it already exists: ChatView subscribes to the real messages, and
    // the conversation document is upserted on first send.
    onOpen(base)
  }

  const titleFor = (c: Conversation) => {
    if (c.type === 'direct') {
      const other = c.participantIds.find(id => id !== user.uid) || ''
      return c.participantNames?.[other] || t('msg.conversation')
    }
    return c.participantNames?.[c.participantIds[0]] || t('msg.conversation')
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
                  c.type === 'pastor' ? 'bg-indigo-100 text-indigo-600'
                    : c.type === 'tech' ? 'bg-blue-100 text-blue-600'
                    : 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold'}`}>
                  {c.type === 'pastor' ? <HeartHandshake size={18} />
                    : c.type === 'tech' ? <LifeBuoy size={18} />
                    : titleFor(c).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {titleFor(c)}
                    </span>
                    {c.type !== 'direct' && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                        c.type === 'pastor' ? 'text-indigo-600 bg-indigo-50' : 'text-blue-600 bg-blue-50'}`}>
                        {c.type === 'pastor' ? t('msg.pastorTag') : t('msg.techTag')}
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

      {picking && <NewMessagePicker user={user} onPick={startDirect} onClose={() => setPicking(false)} />}
    </div>
  )
}

// ==================== CHANNEL CHOOSER (members + churches) ====================

function ChannelChooser({ user, onOpen }: {
  user: AppUser
  onOpen: (c: Conversation) => void
}) {
  const { t } = useLanguage()
  const [existing, setExisting] = useState<Record<string, Conversation>>({})

  // Subscribe to this person's own threads so the chooser can show a preview
  // and an unread dot - without this a member had no way to know the pastor
  // had replied except by opening each channel and checking.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', user.uid), limit(20)),
      snap => {
        const map: Record<string, Conversation> = {}
        snap.docs.forEach(d => {
          const row = { id: d.id, ...d.data() } as Conversation
          map[row.type] = row
        })
        setExisting(map)
      },
      () => {}
    )
    return () => unsub()
  }, [user.uid])

  const open = (type: 'pastor' | 'tech') => {
    // Prefer the stored document so createdAt, read state, and names come
    // with it rather than being rebuilt (and overwritten) from scratch.
    const stored = existing[type]
    if (stored) { onOpen(stored); return }
    onOpen({
      id: type === 'pastor' ? pastorConversationId(user.uid) : techConversationId(user.uid),
      type,
      participantIds: [user.uid],
      participantNames: { [user.uid]: user.displayName },
      ownerRole: user.role
    })
  }

  const unreadFor = (type: string) => {
    const conv = existing[type]
    if (!conv || !conv.lastMessageAt || conv.lastSenderId === user.uid) return false
    const readAt = conv.readBy?.[user.uid]
    if (!readAt) return true
    const r = readAt.toDate ? readAt.toDate() : new Date(readAt)
    const l = conv.lastMessageAt.toDate ? conv.lastMessageAt.toDate() : new Date(conv.lastMessageAt)
    return l > r
  }

  const channels = [
    {
      type: 'pastor' as const,
      Icon: HeartHandshake,
      title: t('msg.pastorChannel'),
      desc: t('msg.pastorChannelDesc'),
      tone: 'bg-indigo-100 text-indigo-600'
    },
    {
      type: 'tech' as const,
      Icon: LifeBuoy,
      title: t('msg.techChannel'),
      desc: t('msg.techChannelDesc'),
      tone: 'bg-blue-100 text-blue-600'
    }
  ]

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400 px-1">{t('msg.chooseChannel')}</p>
      {channels.map(ch => {
        const conv = existing[ch.type]
        const unread = unreadFor(ch.type)
        return (
          <button key={ch.type} onClick={() => open(ch.type)}
            className="w-full flex items-center gap-4 p-5 rounded-3xl bg-white shadow-sm border border-slate-100 hover:border-emerald-200 hover:shadow-md transition text-left">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${ch.tone}`}>
              <ch.Icon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className={`text-slate-900 ${unread ? 'font-extrabold' : 'font-bold'}`}>{ch.title}</h3>
              <p className={`text-xs mt-0.5 leading-relaxed truncate ${
                unread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                {conv?.lastMessage || ch.desc}
              </p>
            </div>
            {unread && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

// ==================== TAB ENTRY POINT ====================

export function MessagesTab({ user }: { user: AppUser }) {
  const [open, setOpen] = useState<Conversation | null>(null)

  if (open) {
    return <ChatView conversation={open} user={user} onBack={() => setOpen(null)} />
  }

  return isStaff(user)
    ? <ConversationList user={user} onOpen={setOpen} />
    : <ChannelChooser user={user} onOpen={setOpen} />
}
