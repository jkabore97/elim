import { useState } from 'react'
import { Download, Check, Loader2 } from 'lucide-react'
import { useLanguage } from './i18n'
import {
  offlineSupported,
  isDownloaded,
  downloadForOffline,
  removeOffline,
  extFromUrl,
} from './offline'

// A small "Save offline" toggle for a book or audio file. Only appears in the
// installed app (the web can't hold big files). Tapping downloads the file to
// the phone; tapping again when it's saved removes it. Compact mode is an
// icon-only button for tight card layouts.
export function OfflineButton({
  id,
  url,
  kind,
  title,
  compact = false,
  tone = 'dark',
}: {
  id: string
  url: string
  kind: 'book' | 'audio'
  title?: string
  compact?: boolean
  tone?: 'dark' | 'light'
}) {
  const { t } = useLanguage()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(
    isDownloaded(id) ? 'done' : 'idle',
  )

  if (!offlineSupported() || !url) return null

  const handle = async () => {
    if (state === 'busy') return
    if (state === 'done') {
      setState('busy')
      try {
        await removeOffline(id)
        setState('idle')
      } catch {
        setState('done')
      }
      return
    }
    setState('busy')
    try {
      await downloadForOffline(id, url, {
        title,
        kind,
        ext: extFromUrl(url, kind === 'book' ? 'pdf' : 'mp3'),
      })
      setState('done')
    } catch (e) {
      console.error('offline download failed', e)
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const label =
    state === 'busy' ? t('offline.downloading')
    : state === 'done' ? t('offline.downloaded')
    : state === 'error' ? t('offline.failed')
    : t('offline.download')

  const icon =
    state === 'busy' ? <Loader2 size={compact ? 16 : 15} className="animate-spin" />
    : state === 'done' ? <Check size={compact ? 16 : 15} />
    : <Download size={compact ? 16 : 15} />

  const doneColor = tone === 'light' ? 'text-emerald-300' : 'text-emerald-600'
  const idleColor = tone === 'light'
    ? 'text-slate-300 hover:text-white'
    : 'text-slate-400 hover:text-affirm-600'
  const color = state === 'done' ? doneColor : state === 'error' ? 'text-red-500' : idleColor

  if (compact) {
    return (
      <button onClick={handle} aria-label={label} title={label}
        className={`p-2 rounded-full transition ${state === 'done' ? '' : 'hover:bg-slate-100'} ${color}`}>
        {icon}
      </button>
    )
  }

  return (
    <button onClick={handle}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold transition ${color}`}>
      {icon} {label}
    </button>
  )
}
