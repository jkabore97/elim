// Required by Firebase Web Messaging for notifications to work when the
// tab isn't focused or is closed. Must be at the site root (not /src) and
// named exactly this - Firebase's SDK looks for it at this fixed path.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCBlMDHYeMK-MNd_bi0vMCd3ztgPMIggrU",
  authDomain: "elim-b1fff.firebaseapp.com",
  projectId: "elim-b1fff",
  storageBucket: "elim-b1fff.firebasestorage.app",
  messagingSenderId: "81584374169",
  appId: "1:81584374169:web:738850ef41e050ac389308"
});

const messaging = firebase.messaging();

// NOTE: there is deliberately no onBackgroundMessage handler here.
//
// Our Cloud Functions send a payload containing a `notification` block, and
// when one is present the browser displays it AUTOMATICALLY. Calling
// showNotification() from onBackgroundMessage as well produced a second,
// identical notification - which is why every post arrived twice.
//
// Letting the automatic display do the work gives exactly one. Its icon and
// click target come from the webpush block in functions/index.js. Foreground
// messages are unaffected: onMessage in src/notifications.ts handles those,
// and the browser does NOT auto-display while the tab is focused, so that
// path stays at one as well.
//
// If a data-only payload is ever needed, the handler has to come back - but
// then the `notification` block must be dropped from the function payload at
// the same time, or the duplicate returns.

// Route a clicked notification to the right screen. Focuses an already-open
// tab where possible rather than piling up new ones.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data?.FCM_MSG?.data || event.notification.data || {};
  const target = data.kind === 'message'
    ? '/?tab=messages'
    : data.postId ? `/?post=${data.postId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
