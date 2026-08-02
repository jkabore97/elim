import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { app, db } from './firebase'

// From Firebase console -> Project settings -> Cloud Messaging -> Web
// Push certificates. Needed only for the web (browser) notification path -
// native Android doesn't use this at all.
const VAPID_KEY = 'BEzXpoz9xvmdt4JbRDSd8ADZifrAznxCz32Mv1YQamcjRKKrgA_rnNXCWPNI94pGQi6Vek2zRaWWpREffMBFDsw'

async function saveToken(uid: string, token: string) {
  await updateDoc(doc(db, 'users', uid), {
    fcmTokens: arrayUnion(token),
    notificationsEnabled: true
  })
}

// Call this when the user turns the notifications toggle on. Returns true on
// success, false if permission was denied or something went wrong - the
// caller decides how to reflect that in the UI.
export async function enableNotifications(uid: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const permStatus = await PushNotifications.requestPermissions()
      if (permStatus.receive !== 'granted') return false

      return await new Promise<boolean>((resolve) => {
        PushNotifications.addListener('registration', async (token) => {
          await saveToken(uid, token.value)
          resolve(true)
        })
        PushNotifications.addListener('registrationError', () => {
          resolve(false)
        })
        PushNotifications.register()
      })
    } else {
      if (!('Notification' in window)) return false
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return false

      const messaging = getMessaging(app)
      const token = await getToken(messaging, { vapidKey: VAPID_KEY })
      if (!token) return false
      await saveToken(uid, token)
      return true
    }
  } catch {
    return false
  }
}

export async function disableNotifications(uid: string) {
  await updateDoc(doc(db, 'users', uid), { notificationsEnabled: false })
}

// Reads the REAL current permission state from the OS/browser, rather than
// trusting our own stored notificationsEnabled flag. These can drift apart:
// someone can revoke notification permission in system settings at any time,
// and nothing tells the app that happened - which is why the toggle could
// appear on while notifications silently no longer worked.
export async function checkNotificationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const status = await PushNotifications.checkPermissions()
      if (status.receive === 'granted') return 'granted'
      if (status.receive === 'denied') return 'denied'
      return 'prompt'
    }
    if (!('Notification' in window)) return 'denied'
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'denied'
  }
}

// Called at startup: if our stored flag says notifications are on but the OS
// disagrees, the flag is stale and gets corrected so the UI reflects reality.
export async function reconcileNotificationState(uid: string, storedEnabled: boolean): Promise<boolean> {
  const actual = await checkNotificationPermission()
  if (storedEnabled && actual !== 'granted') {
    await updateDoc(doc(db, 'users', uid), { notificationsEnabled: false }).catch(() => {})
    return false
  }
  // Permission is granted and the flag agrees - but the token may have been
  // rotated or cleared (OS reinstall, cleared data), so re-register to be safe.
  if (storedEnabled && actual === 'granted') {
    enableNotifications(uid).catch(() => {})
  }
  return storedEnabled && actual === 'granted'
}

// Foreground web notifications don't show natively (that's browser
// behavior, not a bug) - this listens while the tab is open and shows one
// manually so web users get the same experience as the native app.
export function listenForForegroundMessages() {
  if (Capacitor.isNativePlatform() || !('Notification' in window)) return
  try {
    const messaging = getMessaging(app)
    onMessage(messaging, (payload) => {
      if (Notification.permission === 'granted' && payload.notification) {
        new Notification(payload.notification.title || 'ELIM', {
          body: payload.notification.body,
          icon: '/elim-logo-mark.png'
        })
      }
    })
  } catch {
    // Messaging isn't supported in every browser context (e.g. some
    // in-app browsers) - fail quietly rather than break the app over it.
  }
}
