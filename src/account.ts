// Account-safety helpers required by the App Store: blocking abusive users and
// deleting your own account. Blocking is a self-write to the user's own doc
// (blockedUids); deletion is a Cloud Function that also removes the auth account.
import { httpsCallable } from 'firebase/functions'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db, functions } from './firebase'

// Hide another user's content/messages and stop them contacting you.
export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  if (!myUid || !targetUid || myUid === targetUid) return
  await updateDoc(doc(db, 'users', myUid), { blockedUids: arrayUnion(targetUid) })
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  if (!myUid || !targetUid) return
  await updateDoc(doc(db, 'users', myUid), { blockedUids: arrayRemove(targetUid) })
}

// Permanently delete the signed-in user's account and personal data, then sign
// out. The server removes their content, profile and Firebase Auth account.
export async function deleteMyAccount(): Promise<void> {
  await httpsCallable(functions, 'deleteMyAccount')({})
  await signOut(auth).catch(() => { /* signing out locally is best-effort */ })
}
