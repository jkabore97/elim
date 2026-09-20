import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// Names of everyone in the app, for @mention pickers. Members can't read the
// users collection directly (privacy rules), so this goes through a callable
// that returns names only (no phone/email). Cached for the session so the
// picker is instant after the first open; a failed call clears the cache so a
// later open retries.
export type MemberName = { uid: string; name: string; avatar?: string | null }
let cache: Promise<MemberName[]> | null = null

export function fetchMemberNames(): Promise<MemberName[]> {
  if (!cache) {
    cache = httpsCallable(functions, 'listMemberNames')({})
      .then((r: any) => (r?.data?.members || []) as MemberName[])
      .catch(() => { cache = null; return [] as MemberName[] })
  }
  return cache
}

// One member's public profile for the tap-to-view popup (name, photo,
// profession, interests, role). Fetched on demand; never cached long since a
// person can update their profile.
export type MemberProfile = {
  found: boolean
  name: string
  avatar?: string | null
  profession?: string
  interests?: string[]
  role?: string
}
export async function fetchMemberProfile(uid: string): Promise<MemberProfile | null> {
  try {
    const r: any = await httpsCallable(functions, 'getMemberProfile')({ uid })
    return r?.data as MemberProfile
  } catch { return null }
}
