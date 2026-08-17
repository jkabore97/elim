import { createContext, useContext, useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { Play, Pause, X, SkipBack, SkipForward, Mic } from 'lucide-react'
import { attachMediaSession, updateMediaSessionState, updateMediaSessionPosition, clearMediaSession } from './mediaSession'

interface Track {
  id: string
  url: string
  title: string
  artist: string
  artwork?: string
}

interface PlayerValue {
  track: Track | null
  playing: boolean
  play: (track: Track) => void
  toggle: () => void
  stop: () => void
  isCurrent: (id: string) => boolean
}

const PlayerContext = createContext<PlayerValue | null>(null)

export function useMediaPlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('useMediaPlayer must be used within MediaPlayerProvider')
  return ctx
}

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// The single <audio> element for the whole app. It lives here, above the tab
// switcher, so it is never unmounted - which is what previously restarted
// playback from zero every time someone changed tabs. Individual posts now
// ask this player to play rather than owning their own element.
export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  const play = useCallback((next: Track) => {
    const audio = audioRef.current
    if (!audio) return
    if (track?.id === next.id) {
      audio.play().catch(() => {})
      return
    }
    setTrack(next)
    setCurrent(0)
    setDuration(0)
    // Source is set on the element directly rather than waiting a render, so
    // playback starts inside the user-gesture window browsers require.
    audio.src = next.url
    audio.play().catch(() => {})
    attachMediaSession(audio, { title: next.title, artist: next.artist, artwork: next.artwork })
  }, [track?.id])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [track])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    setTrack(null)
    setPlaying(false)
    clearMediaSession()
  }, [])

  const seek = (seconds: number) => {
    const audio = audioRef.current
    if (audio && isFinite(seconds)) audio.currentTime = seconds
  }

  // Drives the scrubber and timestamps in the OS notification. Throttled to
  // whole seconds: timeupdate fires ~4x a second, and pushing every one of
  // those across the native bridge is needless traffic for a display that
  // only shows seconds anyway.
  const lastReported = useRef(-1)
  useEffect(() => {
    if (!track || duration <= 0) return
    const whole = Math.floor(current)
    if (whole === lastReported.current) return
    lastReported.current = whole
    updateMediaSessionPosition(current, duration)
  }, [current, duration, track])

  const contextValue = useMemo(() => ({
    track, playing, play, toggle, stop,
    isCurrent: (id: string) => track?.id === id
  }), [track, playing, play, toggle, stop])

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}

      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => { setPlaying(true); updateMediaSessionState(true) }}
        onPause={() => { setPlaying(false); updateMediaSessionState(false) }}
        onEnded={() => { setPlaying(false); updateMediaSessionState(false) }}
        onTimeUpdate={e => { if (!scrubbing) setCurrent(e.currentTarget.currentTime) }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
      />

      {track && (
        <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-40 px-3 pb-2 lg:px-0 lg:pb-0 pointer-events-none">
          <div className="glass-dark max-w-lg lg:max-w-none mx-auto pointer-events-auto lg:border-x-0 lg:border-b-0 rounded-2xl lg:rounded-none shadow-2xl overflow-hidden">
            {/* Scrubber — tap or drag anywhere to jump to that point */}
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={Math.min(current, duration || 0)}
              step={0.1}
              onMouseDown={() => setScrubbing(true)}
              onTouchStart={() => setScrubbing(true)}
              onChange={e => setCurrent(Number(e.target.value))}
              onMouseUp={e => { seek(Number((e.target as HTMLInputElement).value)); setScrubbing(false) }}
              onTouchEnd={e => { seek(Number((e.target as HTMLInputElement).value)); setScrubbing(false) }}
              className="w-full h-1 accent-emerald-400 bg-white/10 cursor-pointer"
              aria-label="Seek"
            />

            <div className="flex items-center gap-3 px-3 py-2.5">
              {track.artwork ? (
                <img src={track.artwork} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                  <Mic size={17} />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white truncate">{track.title}</p>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {fmt(current)} / {fmt(duration)}
                </p>
              </div>

              <button onClick={() => seek(Math.max(0, current - 15))}
                aria-label="Back 15 seconds"
                className="w-9 h-9 rounded-full hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0">
                <SkipBack size={16} />
              </button>

              <button onClick={toggle}
                aria-label={playing ? 'Pause' : 'Play'}
                className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0">
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>

              <button onClick={() => seek(Math.min(duration, current + 15))}
                aria-label="Forward 15 seconds"
                className="w-9 h-9 rounded-full hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0">
                <SkipForward size={16} />
              </button>

              <button onClick={stop}
                aria-label="Close player"
                className="w-9 h-9 rounded-full hover:bg-white/10 text-slate-400 flex items-center justify-center shrink-0">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </PlayerContext.Provider>
  )
}
