import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { storageGet, storageSet } from './safeStorage'

// Save books and audio to the phone so they can be read/played with no
// connection. Only meaningful in the installed app - a browser can't reliably
// hold large files, so on the web this is all inert and content just streams.

const REG_KEY = 'elim-offline-v1'

type Entry = { path: string; title?: string; kind?: 'book' | 'audio'; at: number }
type Registry = Record<string, Entry>

export function offlineSupported(): boolean {
  return Capacitor.isNativePlatform()
}

function readReg(): Registry {
  try {
    return JSON.parse(storageGet(REG_KEY) || '{}') as Registry
  } catch {
    return {}
  }
}
function writeReg(reg: Registry) {
  storageSet(REG_KEY, JSON.stringify(reg))
}

export function isDownloaded(id: string): boolean {
  return !!readReg()[id]
}

// A file:// URI the WebView can load, for a downloaded item - or null if it
// isn't downloaded (or we're on the web).
export async function getOfflineSrc(id: string): Promise<string | null> {
  if (!offlineSupported()) return null
  const entry = readReg()[id]
  if (!entry) return null
  try {
    // getUri never checks the file exists, so a stale entry (OS cleared app
    // data, a partial/failed delete) would otherwise return a broken file://
    // src that permanently shadows the working network copy. stat() throws when
    // the file is gone - then we prune the dead entry and fall back to network.
    await Filesystem.stat({ directory: Directory.Data, path: entry.path })
    const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: entry.path })
    return Capacitor.convertFileSrc(uri)
  } catch {
    const reg = readReg()
    delete reg[id]
    writeReg(reg)
    return null
  }
}

export async function downloadForOffline(
  id: string,
  url: string,
  opts: { title?: string; kind?: 'book' | 'audio'; ext?: string } = {},
): Promise<void> {
  if (!offlineSupported()) throw new Error('offline-unsupported')
  const path = `offline/${id}.${opts.ext || 'bin'}`
  // The plugin's downloadFile ignores its own `recursive` flag on Android and
  // does NOT create nested parent folders, so writing to offline/… fails with
  // "No such file or directory" on the very first download. Create the folder
  // ourselves first (a no-op once it exists).
  try {
    await Filesystem.mkdir({ directory: Directory.Data, path: 'offline', recursive: true })
  } catch { /* already exists */ }
  await Filesystem.downloadFile({ url, path, directory: Directory.Data })
  const reg = readReg()
  reg[id] = { path, title: opts.title, kind: opts.kind, at: Date.now() }
  writeReg(reg)
}

export async function removeOffline(id: string): Promise<void> {
  const entry = readReg()[id]
  if (!entry) return
  try {
    await Filesystem.deleteFile({ directory: Directory.Data, path: entry.path })
  } catch {
    /* already gone */
  }
  const reg = readReg()
  delete reg[id]
  writeReg(reg)
}

// A guess at the file extension from a storage URL, so the saved file keeps a
// sensible name (some viewers care).
export function extFromUrl(url: string, fallback: string): string {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url || '')
  return m ? m[1].toLowerCase() : fallback
}
