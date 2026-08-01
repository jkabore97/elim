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
        webpush: {
          notification: { icon: 'https://ccelim.com/elim-logo-mark.png' },
          fcmOptions: { link: 'https://ccelim.com' }
        },
        android: {
          notification: { color: '#10b981' }
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
