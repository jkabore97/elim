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
