import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { ActivityAction, AppUser } from './types'

// Fire-and-forget: logging must never block or break the action it's
// recording. Every call is wrapped so a failed write (offline, rules
// change, etc.) can't surface as an error in the user's face.
export function logActivity(
  user: Pick<AppUser, 'uid' | 'displayName' | 'role'> | null,
  action: ActivityAction,
  detail?: string
) {
  if (!user) return
  addDoc(collection(db, 'activityLogs'), {
    action,
    userId: user.uid,
    userName: user.displayName || '(unknown)',
    userRole: user.role || 'member',
    ...(detail ? { detail: detail.slice(0, 200) } : {}),
    createdAt: serverTimestamp()
  }).catch(() => {})
}
