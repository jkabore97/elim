import { useEffect, useState } from 'react'
import {
  doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
  collection, query, where, getCountFromServer, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Radio, Loader2, Check, Trash2, Eye } from 'lucide-react'
import { db, functions } from './firebase'
import { useLanguage } from './i18n'

// A free "live radio": the church broadcasts audio through YouTube Live (from a
// computer) or Facebook Live (from a phone) — both host the stream AND keep the
// recording for replay at no cost. The app only stores a tiny pointer at
// config/liveRadio (admin-writable, everyone-readable) and embeds the player.
// No live chat and no viewer count are shown, by design.
export type RadioProvider = 'youtube' | 'facebook' | 'unknown'
export interface LiveRadio {
  status: 'live' | 'replay' | 'off'
  provider: RadioProvider
  url: string
  title?: string
  updatedAt?: any
}

const RADIO_DOC = () => doc(db, 'config', 'liveRadio')

// Work out the platform and the embeddable player URL from whatever link the
// admin pastes (a YouTube live/watch/short link, youtu.be, or a Facebook video
// / fb.watch link).
export function parseRadioUrl(raw: string): { provider: RadioProvider; videoId?: string } {
  const u = (raw || '').trim()
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/|v\/))([\w-]{11})/)
  if (yt) return { provider: 'youtube', videoId: yt[1] }
  if (/youtube\.com|youtu\.be/i.test(u)) return { provider: 'youtube' }
  if (/facebook\.com|fb\.watch|fb\.me/i.test(u)) return { provider: 'facebook' }
  return { provider: 'unknown' }
}

function embedUrl(radio: LiveRadio): string | null {
  const { provider, videoId } = parseRadioUrl(radio.url)
  if (provider === 'youtube' && videoId) {
    // nocookie + minimal chrome; autoplay with sound. Chat/related are not part
    // of the embed player, so nothing extra is shown.
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&modestbranding=1`
  }
  if (provider === 'facebook') {
    // show_text=false hides the caption+comments; this plugin has no chat.
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(radio.url)}&show_text=false&autoplay=true`
  }
  return null
}

// Live-syncs the single config/liveRadio doc for everyone.
function useLiveRadio(): LiveRadio | null {
  const [radio, setRadio] = useState<LiveRadio | null>(null)
  useEffect(() => {
    return onSnapshot(RADIO_DOC(), snap => {
      setRadio(snap.exists() ? (snap.data() as LiveRadio) : null)
    }, () => setRadio(null))
  }, [])
  return radio
}

// The number of people watching/listening IN THE APP right now, counted from
// livePresence heartbeats (one doc per uid, refreshed while the player is open).
// Uses a cheap count() aggregation of the docs seen in the last ~45s, so a
// viewer who left (or whose app was killed) drops out on its own.
const PRESENCE_WINDOW_MS = 45000
function useLiveCount(active: boolean, everyMs = 15000): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!active) { setN(null); return }
    let alive = true
    const tick = async () => {
      try {
        const cutoff = Timestamp.fromMillis(Date.now() - PRESENCE_WINDOW_MS)
        const s = await getCountFromServer(query(collection(db, 'livePresence'), where('lastSeen', '>', cutoff)))
        if (alive) setN(s.data().count)
      } catch { /* index building / offline: just don't show a number */ }
    }
    tick()
    const iv = setInterval(tick, everyMs)
    return () => { alive = false; clearInterval(iv) }
  }, [active, everyMs])
  return n
}

// While `active`, mark this viewer present with a heartbeat (doc id = uid, so a
// person is only ever counted once) and remove it on close.
function useLivePresence(uid: string, active: boolean) {
  useEffect(() => {
    if (!uid || !active) return
    const ref = doc(db, 'livePresence', uid)
    const beat = () => setDoc(ref, { uid, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {})
    beat()
    const iv = setInterval(beat, 20000)
    return () => { clearInterval(iv); deleteDoc(ref).catch(() => {}) }
  }, [uid, active])
}

// The live shown as a POST at the top of the feed: the embedded player plays
// inline in the card (no separate screen). Header carries the name, the EN
// DIRECT badge and the live watcher count; the body is the embedded stream.
export function LiveRadioBanner({ uid }: { uid: string }) {
  const { t } = useLanguage()
  const radio = useLiveRadio()
  const live = !!radio && radio.status === 'live'
  // Count this person as watching while the live card is on their feed.
  useLivePresence(uid, live)
  const count = useLiveCount(live, 20000)
  if (!radio || radio.status === 'off' || !radio.url) return null
  const src = embedUrl(radio)
  return (
    <article className="glass rounded-3xl shadow-sm border border-slate-100/80 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white shrink-0 ${
          live ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-slate-500 to-slate-700'}`}>
          <Radio size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {live && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide bg-red-600 text-white rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> {t('radio.live')}
              </span>
            )}
            <h3 className="font-semibold text-slate-900 truncate">{radio.title || t('radio.title')}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{live ? t('radio.live') : t('radio.replay')}</p>
        </div>
        {live && count != null && count > 0 && (
          <span className="shrink-0 flex items-center gap-1 text-xs font-bold text-slate-500" title={t('radio.watching')}>
            <Eye size={15} /> {count.toLocaleString()}
          </span>
        )}
      </div>
      {src ? (
        <div className="w-full aspect-video bg-black">
          <iframe src={src} title={radio.title || 'live'} className="w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <p className="text-sm text-slate-500 px-5 py-8 text-center">{t('radio.badUrl')}</p>
      )}
    </article>
  )
}

// Admin control (in the Admin tab): paste the YouTube/Facebook live link, name
// it, and go live / end (keep as replay) / remove. Going live can also push a
// notice to everyone, reusing the existing broadcast pipeline.
export function LiveRadioAdmin({ onDone }: { onDone?: () => void }) {
  const { t } = useLanguage()
  const radio = useLiveRadio()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Prime the fields from the current doc once it loads (only when the admin
  // hasn't started typing).
  useEffect(() => {
    if (radio && !url && !title) { setUrl(radio.url || ''); setTitle(radio.title || '') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radio?.url])

  const parsed = parseRadioUrl(url)
  // A link is only usable if we can actually embed it: YouTube needs a resolvable
  // video id (a channel/@handle "/live" link has none — paste the video link),
  // Facebook needs a video/permalink URL.
  const urlOk = parsed.provider === 'facebook' || (parsed.provider === 'youtube' && !!parsed.videoId)
  const ytNeedsVideo = parsed.provider === 'youtube' && !parsed.videoId

  const write = async (status: LiveRadio['status']) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      await setDoc(RADIO_DOC(), {
        status,
        provider: parsed.provider,
        url: url.trim(),
        title: title.trim(),
        updatedAt: serverTimestamp(),
      } as LiveRadio, { merge: true })
      if (status === 'live' && notify) {
        try {
          await httpsCallable(functions, 'sendBroadcast')({
            title: `🔴 ${t('radio.title')}`,
            body: title.trim() || t('radio.tapToListen'),
            url: null,
            route: 'feed',
          })
        } catch { /* the go-live still succeeded even if the push didn't */ }
      }
      setMsg(status === 'live' ? t('radio.nowLive') : status === 'replay' ? t('radio.nowReplay') : t('radio.nowOff'))
      onDone?.()
    } catch (e: any) {
      setMsg(e?.message || 'Error')
    } finally { setBusy(false) }
  }

  const clearOff = async () => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      await setDoc(RADIO_DOC(), { status: 'off', updatedAt: serverTimestamp() }, { merge: true })
      setMsg(t('radio.nowOff'))
      onDone?.()
    } catch (e: any) { setMsg(e?.message || 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div className="glass-soft rounded-2xl p-4 space-y-3">
      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Radio size={18} /> {t('radio.admin.title')}</h3>
      <p className="text-xs text-slate-500">{t('radio.admin.intro')}</p>

      {radio && radio.status !== 'off' && (
        <div className={`text-xs font-semibold rounded-xl px-3 py-2 ${radio.status === 'live' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>
          {radio.status === 'live' ? `🔴 ${t('radio.live')}` : t('radio.replay')} · {radio.title || t('radio.title')}
        </div>
      )}

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('radio.admin.name')} maxLength={80}
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder={t('radio.admin.url')}
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-affirm-400" />
      {url && !urlOk && <p className="text-[11px] text-red-500">{ytNeedsVideo ? t('radio.ytHint') : t('radio.badUrl')}</p>}
      {urlOk && <p className="text-[11px] text-slate-400">{parsed.provider === 'youtube' ? 'YouTube' : 'Facebook'}</p>}

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-affirm-600" />
        {t('radio.admin.notify')}
      </label>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => write('live')} disabled={busy || !urlOk}
          className="px-4 py-2 rounded-xl bg-red-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />} {t('radio.goLive')}
        </button>
        <button onClick={() => write('replay')} disabled={busy || !urlOk}
          className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
          <Check size={15} /> {t('radio.endReplay')}
        </button>
        <button onClick={clearOff} disabled={busy}
          className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-500 font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
          <Trash2 size={15} /> {t('radio.remove')}
        </button>
      </div>
      {msg && <p className="text-xs text-affirm-700 font-medium">{msg}</p>}
    </div>
  )
}
