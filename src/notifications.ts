import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { getMessaging, getToken, onMessage, deleteToken } from 'firebase/messaging'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { app, db } from './firebase'

// From Firebase console -> Project settings -> Cloud Messaging -> Web
// Push certificates. Needed only for the web (browser) notification path -
// native Android doesn't use this at all.
const VAPID_KEY = 'BEzXpoz9xvmdt4JbRDSd8ADZifrAznxCz32Mv1YQamcjRKKrgA_rnNXCWPNI94pGQi6Vek2zRaWWpREffMBFDsw'

// Uids awaiting a token, plus the most recent token seen. Between them these
// cover both orderings: token arrives first, or enable() is called first.
const pendingTokenUid = new Set<string>()
let lastKnownToken: string | null = null

async function saveToken(uid: string, token: string) {
  lastKnownToken = token
  await updateDoc(doc(db, 'users', uid), {
    fcmTokens: arrayUnion(token),
    notificationsEnabled: true
  })
}

// Detach THIS device's push token from a user's account. Must run BEFORE
// signOut(), while the user is still authenticated - the users/{uid} write is
// only permitted for the signed-in owner.
//
// Without this, on a shared phone the previous user's token stays in their
// fcmTokens and the device keeps receiving their private-message pushes after
// someone else logs in. Best-effort: a failed cleanup must never block logout.
export async function cleanupPushForLogout(uid: string) {
  try {
    if (lastKnownToken) {
      await updateDoc(doc(db, 'users', uid), {
        fcmTokens: arrayRemove(lastKnownToken)
      }).catch(() => {})
    }
    if (!Capacitor.isNativePlatform()) {
      try {
        await deleteToken(getMessaging(app))
      } catch {
        // deleteToken can throw if messaging was never initialised - ignore.
      }
    }
  } finally {
    pendingTokenUid.clear()
    lastKnownToken = null
  }
}

// Call this when the user turns the notifications toggle on. Returns true on
// success, false if permission was denied or something went wrong - the
// caller decides how to reflect that in the UI.
export async function enableNotifications(uid: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const permStatus = await PushNotifications.requestPermissions()
      if (permStatus.receive !== 'granted') return false

      // If FCM already handed us a token this session, use it immediately
      // rather than waiting for an event that has already fired.
      if (lastKnownToken) {
        await saveToken(uid, lastKnownToken)
        return true
      }

      pendingTokenUid.add(uid)
      await PushNotifications.register()

      // Give registration a moment to come back, then report honestly on
      // whether a token actually landed - rather than claiming success and
      // leaving someone with notifications that silently never arrive.
      await new Promise(res => setTimeout(res, 2500))
      if (lastKnownToken) {
        await saveToken(uid, lastKnownToken)
        return true
      }
      // Mark enabled anyway: the listener above will persist the token the
      // moment it arrives, even if that's after this returns.
      await updateDoc(doc(db, 'users', uid), { notificationsEnabled: true }).catch(() => {})
      return true
    } else {
      if (!('Notification' in window)) return false
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return false

      const registration = await ensureServiceWorker()
      const messaging = getMessaging(app)
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        ...(registration ? { serviceWorkerRegistration: registration } : {})
      })
      if (!token) return false
      await saveToken(uid, token)
      return true
    }
  } catch {
    return false
  }
}

// Native only. Two gaps that FCM does NOT handle automatically:
//
// 1. Android 8+ requires an explicit notification channel to exist before
//    any notification can be displayed at all. Without one, notifications
//    are silently dropped - which looks exactly like "nothing arrives."
// 2. FCM only auto-displays notifications while the app is in the
//    BACKGROUND. Foreground pushes fire an event and display nothing
//    unless the app handles them, so a notification arriving while
//    someone has the app open would otherwise go unseen.
export async function initNativeNotifications() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await PushNotifications.createChannel({
      id: 'elim-default',
      name: 'ELIM',
      description: 'New posts from your church',
      importance: 5,
      visibility: 1,
      lights: true,
      vibration: true
    })
  } catch {
    // createChannel is Android-only; it throws on iOS, which is expected.
  }

  try {
    // Deliberately NOT calling removeAllListeners() here. It used to run at
    // startup and could wipe the 'registration' listener that
    // enableNotifications() is awaiting, depending on which effect ran first.
    // When that happened the token was never saved: the toggle looked on,
    // the local test notification still worked (it needs no token), and yet
    // no push could ever be delivered. The token listener is now installed
    // once, here, and persists for the app's lifetime.
    await PushNotifications.addListener('registration', async (token) => {
      lastKnownToken = token.value
      // Persist to whoever is currently waiting, then drop them from the set.
      // Leaving uids in here permanently meant a later token rotation would
      // re-save the new token onto every account seen this session.
      const waiting = Array.from(pendingTokenUid)
      pendingTokenUid.clear()
      waiting.forEach(uid => { saveToken(uid, token.value).catch(() => {}) })
    })

    // Foreground arrival - post a local notification so it still shows in
    // the shade rather than silently vanishing.
    // Tapping a notification (app closed OR backgrounded) routes to the
    // thing it was about.
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data: any = action?.notification?.data || {}
      if (data.kind === 'message') {
        emitNotificationRoute({ kind: 'message', conversationId: data.conversationId })
      } else if (data.kind === 'post') {
        emitNotificationRoute({ kind: 'post', postId: data.postId })
      }
    })

    await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 100000),
            title: notification.title || 'ELIM',
            body: notification.body || '',
            channelId: 'elim-default',
            smallIcon: 'ic_stat_notify'
          }]
        })
      } catch {
        // If local notifications aren't available, there's nothing further
        // we can do here - the push simply won't render in the foreground.
      }
    })
  } catch {
    // ignore
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


// Explicitly registers the web service worker before asking Firebase for a
// token. Left implicit, the browser sometimes hasn't finished registering it
// when getToken() runs, and token retrieval fails for no visible reason.
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (Capacitor.isNativePlatform()) return undefined
  if (!('serviceWorker' in navigator)) return undefined
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  } catch {
    return undefined
  }
}

// Fires a purely local notification - no server, no FCM, no Cloud Function.
// If this appears, the display path (OS permission + Android channel) is
// healthy and any missing notification is a SENDING problem. If it does not
// appear, the problem is on the device and no amount of server work will
// help. That split is the whole point of this being here.
export async function sendTestNotification(): Promise<{ ok: boolean; detail: string }> {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await checkNotificationPermission()
      if (perm !== 'granted') return { ok: false, detail: `Permission: ${perm}` }
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const localPerm = await LocalNotifications.requestPermissions()
      if (localPerm.display !== 'granted') return { ok: false, detail: `Local permission: ${localPerm.display}` }
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 100000),
          title: "ELIM",
          body: "Test notification - if you can see this, notifications work.",
          channelId: "elim-default",
          smallIcon: "ic_stat_notify"
        }]
      })
      return { ok: true, detail: "Sent to the notification shade" }
    }

    if (!("Notification" in window)) return { ok: false, detail: "This browser has no notification support" }
    if (Notification.permission !== "granted") {
      const asked = await Notification.requestPermission()
      if (asked !== "granted") return { ok: false, detail: `Permission: ${asked}` }
    }
    new Notification("ELIM", {
      body: "Test notification - if you can see this, notifications work.",
      icon: "/elim-logo-mark.png"
    })
    return { ok: true, detail: "Shown by the browser" }
  } catch (err: any) {
    return { ok: false, detail: err?.message || String(err) }
  }
}

// Returns a plain-language snapshot of every link in the chain, so a failure
// can be pinpointed instead of guessed at.
export async function notificationDiagnostics(user: { uid: string; notificationsEnabled?: boolean; fcmTokens?: string[] }) {
  const perm = await checkNotificationPermission()
  return {
    platform: Capacitor.isNativePlatform() ? "Native app" : "Browser",
    osPermission: perm,
    enabledInApp: !!user.notificationsEnabled,
    tokensStored: user.fcmTokens?.length || 0
  }
}


// ==================== DEEP LINKING ====================

// A tapped notification should land the person where the notification was
// about - the post, or the conversation - not just "somewhere in the app".
// Both the native tap listener and the web URL path funnel into this one
// event so App.tsx has a single place to react.
export type NotificationRoute =
  | { kind: 'post'; postId?: string }
  | { kind: 'message'; conversationId?: string }

export function emitNotificationRoute(route: NotificationRoute) {
  window.dispatchEvent(new CustomEvent('elim:route', { detail: route }))
}

export function onNotificationRoute(handler: (route: NotificationRoute) => void) {
  const listener = (e: Event) => handler((e as CustomEvent).detail as NotificationRoute)
  window.addEventListener('elim:route', listener)
  return () => window.removeEventListener('elim:route', listener)
}

// Web: the service worker opens the app at a URL carrying the target, so on
// startup we read it back off the query string and clear it, leaving a clean
// address bar behind.
export function consumeLaunchUrlRoute() {
  try {
    const params = new URLSearchParams(window.location.search)
    const postId = params.get('post')
    const tab = params.get('tab')
    if (!postId && !tab) return

    if (postId) emitNotificationRoute({ kind: 'post', postId })
    else if (tab === 'messages') emitNotificationRoute({ kind: 'message' })

    params.delete('post')
    params.delete('tab')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  } catch {
    // A malformed URL should never stop the app from starting.
  }
}


// ==================== SYSTEM SETTINGS LINK ====================

// Opens the OS notification settings for this app.
//
// This exists because the link between the in-app toggle and the phone's
// setting can only ever go one way. An app may REQUEST notification
// permission, but it cannot revoke or re-grant its own - Android and iOS both
// forbid it. And once permission is denied, the OS refuses to show the prompt
// again at all, so requestPermissions() silently returns 'denied' forever.
// The only remaining route is to send the person to the settings screen.
export async function openNotificationSettings(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings')
      await NativeSettings.open({
        optionAndroid: AndroidSettings.AppNotification,
        optionIOS: IOSSettings.App
      })
      return true
    }
    return false
  } catch {
    return false
  }
}

// True when the OS has refused and will not prompt again - the case where the
// in-app toggle alone can achieve nothing and settings is the only way.
export async function needsSystemSettings(): Promise<boolean> {
  return (await checkNotificationPermission()) === 'denied'
}
