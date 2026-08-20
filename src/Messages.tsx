import { useState, useEffect, useRef, useMemo } from 'react'
import {
  collection, doc, setDoc, addDoc, onSnapshot, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, limit, serverTimestamp, getDocs
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  ArrowLeft, Send, Search, MessageCircle, Plus, X, LifeBuoy,
  ShieldCheck, HeartHandshake, Image as ImageIcon, Mic, Trash2, Play, Pause, Pencil, Check, CheckCheck, Download
} from 'lucide-react'
import { db, storage } from './firebase'
import { useLanguage } from './i18n'
import { useMediaPlayer } from './MediaPlayer'
import { useBackHandler } from './backButton'
import { ImageLightbox } from './ImageLightbox'
import { TranslateToggle } from './TranslateToggle'
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
      return { label: t('role.church'), chip: 'bg-affirm-100 text-affirm-700', Icon: ShieldCheck }
    case 'pending_church':
      return { label: t('role.pendingChurch'), chip: 'bg-amber-100 text-amber-700', Icon: ShieldCheck }
    default:
      return { label: t('role.member'), chip: 'bg-slate-100 text-slate-600', Icon: MessageCircle }
  }
}

// Same reasoning as the feed: cross-origin Storage URLs need fetching into a
// local blob before a filename and a real save will take effect.
async function downloadMessageMedia(url: string, name: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
  } catch {
    window.open(url, '_blank')
  }
}

export function conversationIsUnread(conv: Conversation, uid: string): boolean {
  if (!conv.lastMessageAt || conv.lastSenderId === uid) return false
  const readAt = conv.readBy?.[uid]
  if (!readAt) return true
  const r = readAt.toDate ? readAt.toDate() : new Date(readAt)
  const l = conv.lastMessageAt.toDate ? conv.lastMessageAt.toDate() : new Date(conv.lastMessageAt)
  return l > r
}

// Live count of threads with something unread, for the nav badge. Subscribes
// to the same queries the inbox uses, so the number and the list always agree.
export function useUnreadCount(user: AppUser): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!user?.uid) return
    let mine: Conversation[] = []
    let channel: Conversation[] = []

    const publish = () => {
      const byId = new Map<string, Conversation>()
      for (const row of [...mine, ...channel]) byId.set(row.id, row)
      setCount(Array.from(byId.values()).filter(cv => conversationIsUnread(cv, user.uid)).length)
    }

    const unsubMine = onSnapshot(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', user.uid), limit(200)),
      snap => { mine = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)); publish() },
      () => {}
    )

    // Staff also answer a shared channel they are not a participant of.
    let unsubChannel = () => {}
    if (isStaff(user)) {
      const myChannel = user.role === 'pastor' ? 'pastor' : 'tech'
      unsubChannel = onSnapshot(
        query(collection(db, 'conversations'), where('type', '==', myChannel), limit(200)),
        snap => { channel = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)); publish() },
        () => {}
      )
    }

    return () => { unsubMine(); unsubChannel() }
  }, [user?.uid, user?.role])

  return count
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

function dayKey(date: any): string {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  return d.toDateString()
}

function daySeparatorLabel(date: any, t: (k: any) => string): string {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return t('logs.today')
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return t('logs.yesterday')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
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
          mine ? 'bg-white/20 text-white' : 'bg-affirm-500/20 text-affirm-400'}`}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="flex items-end gap-0.5 h-6">
        {[6, 11, 8, 16, 12, 20, 14, 9, 17, 11, 7, 13, 9, 5].map((h, i) => (
          <span key={i} className={`w-0.5 rounded-full ${mine ? 'bg-white/80' : 'bg-affirm-400/80'}`}
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
  const { track } = useMediaPlayer()
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [othersTyping, setOthersTyping] = useState<string[]>([])
  const lastTypingWrite = useRef(0)
  const [liveConv, setLiveConv] = useState<Conversation | null>(null)

  // Heartbeat rather than start/stop events: a 'stopped typing' write can be
  // lost if someone closes the app mid-sentence, leaving the indicator stuck
  // on forever. A timestamp that simply goes stale can't get stuck.
  const signalTyping = () => {
    const now = Date.now()
    if (now - lastTypingWrite.current < 3000) return   // at most one write per 3s
    lastTypingWrite.current = now
    setDoc(doc(db, 'conversations', conversation.id), {
      typing: { [user.uid]: serverTimestamp() }
    }, { merge: true }).catch(() => {})
  }

  // Watch the conversation document for the other side's typing heartbeat and
  // read receipts.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'conversations', conversation.id),
      snap => {
        if (!snap.exists()) { setLiveConv(null); return }
        const data = { id: snap.id, ...snap.data() } as Conversation
        setLiveConv(data)
        const typing = (data as any).typing || {}
        const active: string[] = []
        Object.entries(typing).forEach(([uid, ts]: [string, any]) => {
          if (uid === user.uid || !ts?.toDate) return
          // Anything older than 8 seconds is treated as stopped.
          if (Date.now() - ts.toDate().getTime() < 8000) {
            active.push(data.participantNames?.[uid] || t('msg.someone'))
          }
        })
        setOthersTyping(active)
      },
      () => {}
    )
    return () => unsub()
  }, [conversation.id, user.uid])

  // The heartbeat only refreshes on keystrokes, so a stale one has to expire
  // on a timer too - otherwise the indicator lingers after someone stops.
  useEffect(() => {
    if (othersTyping.length === 0) return
    const timer = setTimeout(() => setOthersTyping([]), 8000)
    return () => clearTimeout(timer)
  }, [othersTyping])
  const [openActions, setOpenActions] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmDeleteThread, setConfirmDeleteThread] = useState(false)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // If the chat unmounts mid-recording (tab switch, back), stop the recorder
  // and clear the tick timer. Without this the interval leaks and the mic
  // stream stays live - the OS "microphone in use" indicator stays on with no
  // way to turn it off short of killing the app. recorder.onstop releases the
  // tracks.
  useEffect(() => () => {
    clearInterval(timerRef.current)
    const r = recorderRef.current
    if (r && r.state !== 'inactive') { try { r.stop() } catch { /* already stopped */ } }
  }, [])

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
    // orderBy createdAt DESC + limit(500) fetches the 500 MOST RECENT messages.
    // Without the orderBy, limit(500) returned an arbitrary 500 (ordered by
    // document id), so once a thread passed 500 messages the newest ones could
    // silently drop out. Needs the composite indexes in firestore.indexes.json
    // (one for the staff filter, one for the member participantIds filter).
    const q = query(collection(db, 'messages'), ...constraints, orderBy('createdAt', 'desc'), limit(500))

    const unsub = onSnapshot(q, snap => {
      // Server returns newest-first; flip to chronological for display.
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
      // NOTE the nested-object form. Dotted keys ('readBy.uid') are only
      // interpreted as a field PATH by updateDoc; setDoc+merge treats them as
      // a literal field name containing a dot, which silently wrote junk to
      // the top level and left readBy empty - so every thread stayed marked
      // unread forever no matter how many times it was opened.
      setDoc(doc(db, 'conversations', conversation.id), {
        readBy: { [user.uid]: serverTimestamp() }
      }, { merge: true }).catch(() => {})
    }
  }, [conversation.id, messages.length, user.uid])

  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, atBottom])

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
      readBy: { [user.uid]: serverTimestamp() }
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

  const saveEdit = async (id: string) => {
    const body = editText.trim()
    if (!body) return
    try {
      await updateDoc(doc(db, 'messages', id), { text: body, editedAt: serverTimestamp() })
      setEditingId(null)
      setOpenActions(null)
    } catch (err: any) {
      setError(err?.message || t('msg.editFailed'))
    }
  }

  const deleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'messages', id))
      setOpenActions(null)
    } catch (err: any) {
      setError(err?.message || t('msg.deleteFailed'))
    }
  }

  // Removes the thread AND its messages. Messages are deleted in chunks of
  // 400: a single batch caps at 500 operations, so a thread with 500+ messages
  // (the busy pastor channels will get there) would either exceed the limit
  // and throw - deleting nothing - or silently orphan the remainder. We drain
  // the messages first, then delete the conversation doc last so a failure
  // partway through can be safely retried.
  const deleteThread = async () => {
    try {
      for (;;) {
        const snap = await getDocs(query(
          collection(db, 'messages'),
          where('conversationId', '==', conversation.id),
          limit(400)
        ))
        if (snap.empty) break
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
        if (snap.size < 400) break
      }
      await deleteDoc(doc(db, 'conversations', conversation.id))
      setConfirmDeleteThread(false)
      onBack?.()
    } catch (err: any) {
      setError(err?.message || t('msg.deleteFailed'))
      setConfirmDeleteThread(false)
    }
  }

  // A message counts as read when someone other than the sender has a readBy
  // timestamp later than it. Derived from the readBy map that already drives
  // unread state, rather than storing per-message receipts - which would mean
  // a write for every message every time a thread is opened.
  const readByOthersAt = (() => {
    const map = (liveConv?.readBy || conversation.readBy || {}) as Record<string, any>
    let latest = 0
    Object.entries(map).forEach(([uid, ts]: [string, any]) => {
      if (uid === user.uid || !ts?.toDate) return
      latest = Math.max(latest, ts.toDate().getTime())
    })
    return latest
  })()

  const isSeen = (m: Message) => {
    if (!m.createdAt?.toDate || readByOthersAt === 0) return false
    return readByOthersAt >= m.createdAt.toDate().getTime()
  }

  const staff = isStaff(user)
  const channelMeta = conversation.type === 'pastor'
    ? { label: t('msg.pastorChannel'), Icon: HeartHandshake, tone: 'bg-indigo-500/15 text-indigo-400' }
    : conversation.type === 'tech'
      ? { label: t('msg.techChannel'), Icon: LifeBuoy, tone: 'bg-blue-500/15 text-blue-400' }
      : { label: '', Icon: MessageCircle, tone: 'bg-affirm-500/15 text-affirm-400' }

  const otherUid = conversation.participantIds.find(id => id !== user.uid) || conversation.participantIds[0]
  const title = conversation.type === 'direct'
    ? (conversation.participantNames?.[otherUid] || t('msg.conversation'))
    : staff
      ? (conversation.participantNames?.[conversation.participantIds[0]] || t('msg.conversation'))
      : channelMeta.label

  const ChannelIcon = channelMeta.Icon

  return (
    <div className={`flex flex-col ${
      // The mini-player docks above the bottom nav, so the thread has to give
      // up that height - otherwise the player sits on top of the message
      // input and blocks typing entirely.
      track
        ? 'h-[calc(100vh-18rem)] lg:h-[calc(100vh-15rem)]'
        : 'h-[calc(100vh-13rem)] lg:h-[calc(100vh-10rem)]'
    }`}>
      <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
        {onBack && (
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-slate-100 text-slate-500">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${channelMeta.tone}`}>
          <ChannelIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-slate-800 truncate">{title}</h2>
          <p className="text-[11px] text-slate-400 truncate">
            {conversation.type === 'direct'
              ? roleMeta(conversation.ownerRole || 'member', t).label
              : staff ? channelMeta.label : t('msg.usuallyReplies')}
          </p>
        </div>

        {confirmDeleteThread ? (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={deleteThread}
              className="px-3 py-1.5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-semibold">
              {t('msg.deleteConfirm')}
            </button>
            <button onClick={() => setConfirmDeleteThread(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700 px-1">
              {t('post.cancel')}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDeleteThread(true)}
            aria-label={t('msg.deleteThread')}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-red-400 shrink-0 transition">
            <Trash2 size={17} />
          </button>
        )}
      </div>

      <div ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
        }}
        className="flex-1 overflow-y-auto py-4 space-y-3 relative">
        {loading && <p className="text-center py-10"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
            <p className="text-sm text-red-400 break-words">{error}</p>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="text-center py-10 px-6 my-4 scrim">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${channelMeta.tone}`}>
              <ChannelIcon size={24} />
            </div>
            <p className="text-slate-600 text-sm font-medium">{t('msg.noMessages')}</p>
            <p className="text-xs text-slate-500 mt-1 px-8 leading-relaxed">
              {conversation.type === 'pastor' ? t('msg.pastorHint')
                : conversation.type === 'tech' ? t('msg.techHint')
                : t('msg.startHint')}
            </p>
          </div>
        )}

        {messages.map((m, idx) => {
          const mine = m.senderId === user.uid
          const meta = roleMeta(m.senderRole, t)
          const showDay = idx === 0 || dayKey(m.createdAt) !== dayKey(messages[idx - 1]?.createdAt)
          return (
            <div key={m.id}>
            {showDay && m.createdAt && (
              <div className="flex justify-center my-3">
                <span className="text-[10px] font-semibold text-slate-500 glass-soft px-3 py-1 rounded-full">
                  {daySeparatorLabel(m.createdAt, t)}
                </span>
              </div>
            )}
            <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${
                mine ? 'bg-affirm-600 text-white' : 'bg-white border border-slate-200 text-slate-800 shadow-sm'}`}>
                {!mine && (
                  <p className="text-[11px] font-semibold text-affirm-600 mb-1 flex items-center gap-1.5 flex-wrap">
                    {m.senderName}
                    {(m.senderRole === 'pastor' || m.senderRole === 'admin') && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.chip}`}>
                        {meta.label}
                      </span>
                    )}
                  </p>
                )}

                {m.mediaType === 'image' && m.mediaUrl && (
                  <div className="relative mb-1">
                    <img src={m.mediaUrl} alt="" onClick={() => setLightbox(m.mediaUrl!)}
                      className="rounded-xl max-h-64 w-auto cursor-zoom-in" />
                    <button onClick={() => downloadMessageMedia(m.mediaUrl!, `elim-photo-${m.id}.jpg`)}
                      aria-label="Download"
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center">
                      <Download size={14} />
                    </button>
                  </div>
                )}

                {m.mediaType === 'audio' && m.mediaUrl && (
                  <div className="flex items-center gap-1">
                    <div className="flex-1" onClick={() => setOpenActions(openActions === m.id ? null : m.id)}>
                      <AudioBubble url={m.mediaUrl} mine={mine} />
                    </div>
                    <button onClick={() => downloadMessageMedia(m.mediaUrl!, `elim-audio-${m.id}.webm`)}
                      aria-label="Download"
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        mine ? 'hover:bg-white/20 text-white/80' : 'hover:bg-white/10 text-slate-400'}`}>
                      <Download size={14} />
                    </button>
                  </div>
                )}

                {editingId === m.id ? (
                  <div className="flex items-end gap-2">
                    <textarea value={editText} onChange={e => setEditText(e.target.value)}
                      rows={2}
                      className="flex-1 min-w-0 rounded-xl bg-black/20 border border-white/20 px-3 py-2 text-[15px] text-white resize-none focus:outline-none" />
                    <button onClick={() => saveEdit(m.id)}
                      aria-label={t('post.save')}
                      className="w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center shrink-0">
                      <Check size={15} />
                    </button>
                    <button onClick={() => setEditingId(null)}
                      aria-label={t('post.cancel')}
                      className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0">
                      <X size={15} />
                    </button>
                  </div>
                ) : m.text ? (
                  <>
                    <p onClick={() => setOpenActions(openActions === m.id ? null : m.id)}
                      className="text-[15px] leading-relaxed whitespace-pre-wrap break-words cursor-pointer">
                      {m.text}
                    </p>
                    {/* Only offer to translate the other person's words - you
                        don't need your own message translated. */}
                    {!mine && <TranslateToggle text={m.text} tone="light" className="mt-1" />}
                  </>
                ) : null}

                <p className={`text-[10px] mt-1 flex items-center gap-1 ${mine ? 'text-affirm-100/70' : 'text-slate-500'}`}>
                  {m.mediaType === 'audio' && m.mediaDuration ? `${fmtDuration(m.mediaDuration)} · ` : ''}
                  {/* A pending server timestamp means it hasn't landed yet -
                      showing a clock instead of a blank time tells the sender
                      the message is in flight rather than lost. */}
                  {m.createdAt ? timeShort(m.createdAt) : t('msg.sending')}
                  {m.editedAt ? ` · ${t('msg.edited')}` : ''}
                  {mine && m.createdAt && (
                    isSeen(m)
                      ? <CheckCheck size={12} className="text-sky-300" />
                      : <Check size={11} className="opacity-70" />
                  )}
                </p>

                {/* Actions revealed by tapping a message. Editing is limited to
                    the sender - rewriting someone else's words would leave
                    them attributed to a person who never wrote them. Deleting
                    is available to the sender, and to staff for moderation. */}
                {openActions === m.id && editingId !== m.id && (mine || staff) && (
                  <div className={`flex items-center gap-3 mt-2 pt-2 border-t ${
                    mine ? 'border-white/20' : 'border-white/10'}`}>
                    {mine && m.text && !m.mediaType && (
                      <button onClick={() => { setEditingId(m.id); setEditText(m.text); }}
                        className={`flex items-center gap-1 text-[11px] font-semibold ${
                          mine ? 'text-affirm-100' : 'text-slate-300'}`}>
                        <Pencil size={12} /> {t('post.edit')}
                      </button>
                    )}
                    <button onClick={() => deleteMessage(m.id)}
                      className={`flex items-center gap-1 text-[11px] font-semibold ${
                        mine ? 'text-red-100' : 'text-red-400'}`}>
                      <Trash2 size={12} /> {t('post.delete')}
                    </button>
                    <button onClick={() => setOpenActions(null)}
                      className={`ml-auto text-[11px] ${mine ? 'text-affirm-100/70' : 'text-slate-500'}`}>
                      {t('post.cancel')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!atBottom && messages.length > 0 && (
        <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          aria-label={t('msg.scrollToLatest')}
          className="absolute bottom-24 right-6 w-10 h-10 rounded-full bg-affirm-600 hover:bg-affirm-700 text-white shadow-lg flex items-center justify-center z-10">
          <ArrowLeft size={17} className="-rotate-90" />
        </button>
      )}

      {othersTyping.length > 0 && (
        <div className="flex items-center gap-2 px-1 pb-1.5">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-affirm-400"
                style={{ animation: `typingDot 1.2s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </div>
          <span className="text-[11px] text-slate-400">
            {othersTyping[0]} {t('msg.isTyping')}
          </span>
        </div>
      )}

      <div className="pt-3 border-t border-slate-200">
        {recording ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-sm font-medium text-red-300 tabular-nums">{fmtDuration(elapsed)}</span>
            <span className="text-xs text-slate-400 flex-1 truncate">{t('msg.recording')}</span>
            <button onClick={() => stopRecording(false)}
              className="w-9 h-9 rounded-full glass-soft hover:bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
              <Trash2 size={16} />
            </button>
            <button onClick={() => stopRecording(true)}
              className="w-9 h-9 rounded-full bg-affirm-600 hover:bg-affirm-700 text-white flex items-center justify-center shrink-0">
              <Send size={15} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <label className="w-11 h-11 rounded-2xl glass-soft hover:bg-slate-200 text-slate-500 flex items-center justify-center shrink-0 cursor-pointer transition">
              <ImageIcon size={18} />
              <input type="file" accept="image/*" className="hidden" onChange={handleImage} disabled={sending} />
            </label>
            <button onClick={startRecording} disabled={sending}
              className="w-11 h-11 rounded-2xl glass-soft hover:bg-slate-200 text-slate-500 flex items-center justify-center shrink-0 transition disabled:opacity-50">
              <Mic size={18} />
            </button>
            <input
              value={text}
              onChange={e => { setText(e.target.value); signalTyping() }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={t('msg.writePlaceholder')}
              className="flex-1 min-w-0 px-4 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]"
            />
            <button onClick={handleSend} disabled={!text.trim() || sending}
              className="w-11 h-11 rounded-2xl bg-affirm-600 hover:bg-affirm-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0 transition">
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
      <div className="glass-bar w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-white/40 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{t('msg.newMessage')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500"><X size={20} /></button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('msg.searchPeople')}
              className="w-full pl-11 pr-4 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5">
          {loading && <p className="text-center py-10"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}
          {!loading && error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 break-words">{error}</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <p className="text-center py-10"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('msg.noPeople')}</span></p>
          )}
          <div className="space-y-1">
            {visible.map(p => {
              const meta = roleMeta(p.role, t)
              return (
                <button key={p.uid} onClick={() => onPick(p)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-900/5 transition text-left">
                  {p.avatar ? (
                    <img src={p.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 flex items-center justify-center text-white font-bold shrink-0">
                      {(p.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.displayName}</p>
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

  const isUnread = (c: Conversation) => conversationIsUnread(c, user.uid)

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('msg.searchConversations')}
            className="w-full pl-11 pr-4 py-3 rounded-2xl glass-input text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-affirm-400/60 text-[15px]" />
        </div>
        <button onClick={() => setPicking(true)}
          className="w-12 h-12 rounded-2xl bg-affirm-600 hover:bg-affirm-700 text-white flex items-center justify-center shrink-0 transition shadow-lg shadow-affirm-500/20">
          <Plus size={20} />
        </button>
      </div>

      {loading && <p className="text-center py-16"><span className="scrim inline-block px-4 py-2 text-sm text-slate-600">{t('app.loading')}</span></p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <p className="text-sm font-semibold text-red-400">{t('msg.loadFailed')}</p>
          <p className="text-xs text-red-300 mt-1.5 break-words">{error}</p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-12 px-6 my-6 scrim">
          <div className="w-16 h-16 rounded-full bg-affirm-500/10 flex items-center justify-center mx-auto mb-4">
            <MessageCircle size={28} className="text-affirm-400" />
          </div>
          <p className="text-slate-800 font-medium">{t('msg.noConversations')}</p>
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
                    : 'bg-gradient-to-br from-affirm-400 to-teal-500 text-white font-bold'}`}>
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
                {unread && (
                  <span className="shrink-0 px-2.5 py-1 rounded-full bg-affirm-600 text-white text-[10px] font-bold uppercase tracking-wide">
                    {t('msg.newBadge')}
                  </span>
                )}
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
  const [directs, setDirects] = useState<Conversation[]>([])

  // Subscribe to this person's own threads so the chooser can show a preview
  // and an unread dot - without this a member had no way to know the pastor
  // had replied except by opening each channel and checking.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', user.uid), limit(20)),
      snap => {
        const map: Record<string, Conversation> = {}
        const direct: Conversation[] = []
        snap.docs.forEach(d => {
          const row = { id: d.id, ...d.data() } as Conversation
          // Direct threads were previously collapsed into map['direct'], which
          // the chooser never rendered - so a conversation started BY staff was
          // invisible to the member. The notification arrived and opened
          // Messages, and there was simply nothing there.
          if (row.type === 'direct') direct.push(row)
          else map[row.type] = row
        })
        direct.sort((a, b) => {
          const ta = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : 0
          const tb = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : 0
          return tb - ta
        })
        setExisting(map)
        setDirects(direct)
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

  const isUnread = (conv?: Conversation) => !!conv && conversationIsUnread(conv, user.uid)
  const unreadFor = (type: string) => isUnread(existing[type])

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
            className="w-full flex items-center gap-4 p-5 rounded-3xl bg-white shadow-sm border border-slate-100 hover:border-affirm-200 hover:shadow-md transition text-left">
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
            {unread && (
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-affirm-600 text-white text-[10px] font-bold uppercase tracking-wide">
                {t('msg.newBadge')}
              </span>
            )}
          </button>
        )
      })}

      {directs.length > 0 && (
        <>
          <p className="text-sm text-slate-400 px-1 pt-3">{t('msg.directThreads')}</p>
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            {directs.map((conv, i) => {
              const other = conv.participantIds.find(id => id !== user.uid) || ''
              const name = conv.participantNames?.[other] || t('msg.conversation')
              const unread = isUnread(conv)
              return (
                <button key={conv.id} onClick={() => onOpen(conv)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition ${
                    i !== directs.length - 1 ? 'border-b border-slate-50' : ''}`}>
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-affirm-400 to-teal-500 flex items-center justify-center text-white font-bold shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {name}
                    </p>
                    <p className={`text-xs truncate mt-0.5 ${unread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                      {conv.lastMessage || t('msg.noMessagesYet')}
                    </p>
                  </div>
                  {unread && (
                    <span className="shrink-0 px-2.5 py-1 rounded-full bg-affirm-600 text-white text-[10px] font-bold uppercase tracking-wide">
                      {t('msg.newBadge')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ==================== TAB ENTRY POINT ====================

export function MessagesTab({ user }: { user: AppUser }) {
  const [open, setOpen] = useState<Conversation | null>(null)

  // Back returns to the inbox / channel list rather than leaving the app.
  useBackHandler(!!open, () => setOpen(null))

  if (open) {
    return <ChatView conversation={open} user={user} onBack={() => setOpen(null)} />
  }

  return isStaff(user)
    ? <ConversationList user={user} onOpen={setOpen} />
    : <ChannelChooser user={user} onOpen={setOpen} />
}
