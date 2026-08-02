// Registers currently-playing audio with the operating system's media
// session. This is what produces lock-screen / notification-shade playback
// controls, and it's also what tells Android this is genuine media playback
// worth keeping alive when the app is backgrounded or a call comes in -
// rather than incidental page audio it can freely kill.
//
// Honest scope note: this is the correct web-standard approach and gives a
// real improvement, but a WebView is still not a native audio service.
// Android may still stop playback under memory pressure or aggressive
// battery-optimization settings (which vary a lot by manufacturer -
// Samsung and Xiaomi are notably aggressive). Guaranteeing playback in
// every one of those cases would require a native foreground-service
// plugin, which is a substantially larger piece of work.

interface MediaMeta {
  title: string
  artist: string
  artwork?: string
}

export function attachMediaSession(audio: HTMLAudioElement, meta: MediaMeta) {
  if (!('mediaSession' in navigator)) return

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: 'ELIM',
      artwork: [
        {
          src: meta.artwork || '/elim-logo-mark.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    })

    navigator.mediaSession.setActionHandler('play', () => { audio.play().catch(() => {}) })
    navigator.mediaSession.setActionHandler('pause', () => { audio.pause() })
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 15))
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (details.seekOffset || 15))
    })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) audio.currentTime = details.seekTime
    })
  } catch {
    // MediaMetadata/setActionHandler support varies - never let this break
    // ordinary playback.
  }
}

export function updateMediaSessionState(playing: boolean) {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  } catch {
    // ignore
  }
}
