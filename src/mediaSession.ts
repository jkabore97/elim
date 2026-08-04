import { Capacitor } from '@capacitor/core'
import { MediaSession } from '@capgo/capacitor-media-session'

// Registers currently-playing audio with the operating system so it appears as
// a proper media notification - artwork, title, scrubber, transport controls -
// the same way Chrome does for web audio.
//
// Why a plugin rather than the Web API: Android's WebView does NOT implement
// the Media Session Web API. Chrome shows a rich media notification because
// Chrome implements it natively; a Capacitor WebView gets nothing. This plugin
// provides the native implementation on Android and is a thin passthrough to
// the Web API on web/iOS, so one call path covers every platform.

interface MediaMeta {
  title: string
  artist: string
  artwork?: string
}

// Artwork must be an absolute URL for the native side to fetch it - a relative
// path like '/elim-logo-mark.png' resolves inside the WebView but means
// nothing to the Android notification renderer.
function absoluteArtwork(src?: string) {
  const fallback = 'https://ccelim.com/elim-logo-mark.png'
  if (!src) return fallback
  if (src.startsWith('http')) return src
  return `https://ccelim.com${src.startsWith('/') ? '' : '/'}${src}`
}

export async function attachMediaSession(audio: HTMLAudioElement, meta: MediaMeta) {
  try {
    await MediaSession.setMetadata({
      title: meta.title,
      artist: meta.artist,
      album: 'ELIM',
      artwork: [{ src: absoluteArtwork(meta.artwork), sizes: '512x512', type: 'image/png' }]
    })

    // Unlike the browser, the native side can't detect playback on its own, so
    // every handler has to be wired explicitly - and the notification won't
    // appear at all until play/pause handlers exist.
    await MediaSession.setActionHandler({ action: 'play' }, () => { audio.play().catch(() => {}) })
    await MediaSession.setActionHandler({ action: 'pause' }, () => { audio.pause() })
    await MediaSession.setActionHandler({ action: 'stop' }, () => { audio.pause() })
    await MediaSession.setActionHandler({ action: 'seekbackward' }, (d) => {
      audio.currentTime = Math.max(0, audio.currentTime - (d?.seekTime || 15))
    })
    await MediaSession.setActionHandler({ action: 'seekforward' }, (d) => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d?.seekTime || 15))
    })
    await MediaSession.setActionHandler({ action: 'seekto' }, (d) => {
      if (d?.seekTime != null) audio.currentTime = d.seekTime
    })
  } catch {
    // Never let media-session wiring break actual playback.
  }
}

export async function updateMediaSessionState(playing: boolean) {
  try {
    await MediaSession.setPlaybackState({ playbackState: playing ? 'playing' : 'paused' })
  } catch {
    // ignore
  }
}

// Drives the scrubber and elapsed/total time shown in the notification.
export async function updateMediaSessionPosition(position: number, duration: number) {
  if (!isFinite(duration) || duration <= 0) return
  try {
    await MediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1
    })
  } catch {
    // ignore
  }
}

// Clears the notification when playback is dismissed outright.
export async function clearMediaSession() {
  try {
    await MediaSession.setPlaybackState({ playbackState: 'none' })
  } catch {
    // ignore
  }
}

export const isNativeMediaSession = () => Capacitor.isNativePlatform()
