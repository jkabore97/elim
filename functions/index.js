const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

// FCM's multicast send accepts at most 500 tokens per call - this batches
// a longer token list into chunks that size, sending each chunk in parallel.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

exports.notifyOnNewPost = onDocumentCreated('posts/{postId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const post = snapshot.data();

  const db = getFirestore();
  const usersSnap = await db
    .collection('users')
    .where('notificationsEnabled', '==', true)
    .get();

  const tokens = [];
  usersSnap.forEach((doc) => {
    const data = doc.data();
    // Don't notify the church/admin about their own post.
    if (doc.id === post.churchId) return;
    if (Array.isArray(data.fcmTokens)) tokens.push(...data.fcmTokens);
  });

  if (tokens.length === 0) return;

  const title = post.churchName || 'ELIM';
  const rawBody = (post.content || '').trim();
  const body = rawBody.length > 120 ? rawBody.slice(0, 117) + '...' : rawBody;

  const messaging = getMessaging();
  const batches = chunk(tokens, 500);

  const results = await Promise.allSettled(
    batches.map((batchTokens) =>
      messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: { title, body },
        // Read by the app when the notification is tapped, to route straight
        // to the post rather than dumping the person on the feed.
        data: { kind: 'post', postId: event.params.postId },
        webpush: {
          notification: { icon: 'https://ccelim.com/elim-logo-mark.png' },
          fcmOptions: { link: `https://ccelim.com/?post=${event.params.postId}` }
        },
        android: {
          priority: 'high',
          notification: {
            color: '#10b981',
            // Must match the channel created client-side in
            // initNativeNotifications() - Android 8+ drops notifications
            // that reference a channel which doesn't exist.
            channelId: 'elim-default',
            icon: 'ic_stat_notify',
            defaultSound: true
          }
        }
      })
    )
  );

  // Clean up tokens FCM reports as dead/unregistered (e.g. app uninstalled,
  // notifications revoked at the OS level) so the token list doesn't grow
  // forever with entries that will never succeed again.
  const deadTokens = [];
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    result.value.responses.forEach((res, j) => {
      if (!res.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(res.error?.code)) {
        deadTokens.push(batches[i][j]);
      }
    });
  });

  if (deadTokens.length > 0) {
    const deadSet = new Set(deadTokens);
    await Promise.all(
      usersSnap.docs
        .filter((doc) => (doc.data().fcmTokens || []).some((t) => deadSet.has(t)))
        .map((doc) =>
          doc.ref.update({
            fcmTokens: (doc.data().fcmTokens || []).filter((t) => !deadSet.has(t))
          })
        )
    );
  }
});


// ==================== NEW MESSAGE NOTIFICATIONS ====================

exports.notifyOnNewMessage = onDocumentCreated('messages/{messageId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const message = snapshot.data();

  const db = getFirestore();

  const convSnap = await db.collection('conversations').doc(message.conversationId).get();
  if (!convSnap.exists) return;
  const conv = convSnap.data();

  // Work out who should hear about this.
  //  - A member/church writing into a channel  -> the staff who answer it
  //  - Staff replying in a channel             -> the thread's owner
  //  - Direct thread                           -> the other participant
  const senderIsStaff = message.senderRole === 'pastor' || message.senderRole === 'admin';
  let recipientIds = [];

  if (conv.type === 'direct') {
    recipientIds = (conv.participantIds || []).filter((id) => id !== message.senderId);
  } else if (senderIsStaff) {
    recipientIds = (conv.participantIds || []).filter((id) => id !== message.senderId);
  } else {
    const answeringRole = conv.type === 'pastor' ? 'pastor' : 'admin';
    const staffSnap = await db.collection('users').where('role', '==', answeringRole).get();
    recipientIds = staffSnap.docs.map((d) => d.id).filter((id) => id !== message.senderId);
  }

  if (recipientIds.length === 0) return;

  // Firestore 'in' queries cap at 30 values, and the recipient list here is
  // realistically 1-2 people, but chunking keeps this correct if that changes.
  const tokens = [];
  for (const group of chunk(recipientIds, 30)) {
    const usersSnap = await db.collection('users').where('__name__', 'in', group).get();
    usersSnap.forEach((doc) => {
      const data = doc.data();
      if (data.notificationsEnabled && Array.isArray(data.fcmTokens)) {
        tokens.push(...data.fcmTokens);
      }
    });
  }

  if (tokens.length === 0) return;

  const preview = message.mediaType === 'image' ? '📷 Photo'
    : message.mediaType === 'audio' ? '🎤 Message vocal'
    : (message.text || '').slice(0, 120);

  const messaging = getMessaging();
  const batches = chunk(tokens, 500);

  await Promise.allSettled(
    batches.map((batchTokens) =>
      messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: { title: message.senderName || 'ELIM', body: preview },
        data: { kind: 'message', conversationId: message.conversationId },
        webpush: {
          notification: { icon: 'https://ccelim.com/elim-logo-mark.png' },
          fcmOptions: { link: 'https://ccelim.com/?tab=messages' }
        },
        android: {
          priority: 'high',
          notification: {
            color: '#10b981',
            channelId: 'elim-default',
            icon: 'ic_stat_notify',
            defaultSound: true
          }
        }
      })
    )
  );
});
