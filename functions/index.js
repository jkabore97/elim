const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getStorage } = require('firebase-admin/storage');
const { Translate } = require('@google-cloud/translate').v2;
const speech = require('@google-cloud/speech');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

initializeApp();

ffmpeg.setFfmpegPath(ffmpegPath);
// One Speech-to-Text client, reused across warm invocations. Authenticates
// with the function's own service account (ADC) - no API key stored anywhere;
// the Cloud Speech-to-Text API just needs to be enabled on the project.
const speechClient = new speech.SpeechClient();

// Square credentials, stored in Secret Manager (never in the repo). Set with:
//   gcloud secrets create SQUARE_ACCESS_TOKEN --data-file=- ...
// See MOBILE.md / the release notes for the full setup.
const SQUARE_ACCESS_TOKEN = defineSecret('SQUARE_ACCESS_TOKEN');
const SQUARE_LOCATION_ID = defineSecret('SQUARE_LOCATION_ID');
const SQUARE_WEBHOOK_SIGNATURE_KEY = defineSecret('SQUARE_WEBHOOK_SIGNATURE_KEY');
// The exact public URL of the squareWebhook function - Square signs each
// webhook with (this URL + body), so verification needs the same string.
const SQUARE_WEBHOOK_URL = defineSecret('SQUARE_WEBHOOK_URL');

const SQUARE_API = 'https://connect.squareup.com/v2';
const SQUARE_VERSION = '2024-12-18';

// One Translate client, reused across warm invocations. It authenticates with
// the function's own service account (Application Default Credentials), so no
// API key is stored anywhere - the Cloud Translation API just needs to be
// enabled on the project.
const translateClient = new Translate();

// FCM's multicast send accepts at most 500 tokens per call - this batches
// a longer token list into chunks that size, sending each chunk in parallel.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The church is in Burkina Faso (UTC+0, no DST). Day/time keys for the quiz
// use this zone so "today" on the server matches "today" on a member's phone.
const CHURCH_TZ = 'Africa/Ouagadougou';
function churchDayKey(d = new Date()) {
  // en-CA formats as YYYY-MM-DD, matching the client's todayKey().
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Send one notification to every user who has push enabled. Mirrors the
// per-event senders: multicast in batches of 500, then prune dead tokens.
async function broadcastPush(db, { title, body, data }, opts = {}) {
  // Record every broadcast in the in-app notification center too, so members who
  // miss (or clear) the system push still find it in the bell. A single shared
  // doc that all clients read - read state is tracked per-device on the client -
  // so there's no write-per-user fan-out. Best-effort: never fail the push.
  // When announcementId is given (scheduled broadcasts), the doc is keyed
  // deterministically so a retry overwrites it instead of adding a duplicate.
  try {
    const payload = {
      title,
      body,
      kind: (data && data.kind) || 'info',
      url: (data && data.url) || null,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (opts.announcementId) {
      await db.collection('announcements').doc(opts.announcementId).set(payload, { merge: true });
    } else {
      await db.collection('announcements').add(payload);
    }
  } catch (e) {
    console.error('announcement log failed', e);
  }

  const usersSnap = await db.collection('users').where('notificationsEnabled', '==', true).get();
  const tokenSet = new Set();
  usersSnap.forEach((doc) => {
    const arr = doc.data().fcmTokens;
    if (Array.isArray(arr)) arr.forEach((t) => t && tokenSet.add(t));
  });
  const tokens = [...tokenSet]; // dedupe: the same device token can appear twice
  if (tokens.length === 0) return;

  // Where a clicked web notification lands: an explicit http(s) link wins,
  // otherwise map the route hint to the right in-app screen.
  const kind = (data && data.kind) || 'info';
  const webLink =
    (data && data.url && /^https?:\/\/.+/i.test(data.url)) ? data.url
    : kind === 'message' ? 'https://ccelim.com/?tab=messages'
    : kind === 'quiz' ? 'https://ccelim.com/?quiz=1'
    : 'https://ccelim.com/';

  const messaging = getMessaging();
  const batches = chunk(tokens, 500);
  const results = await Promise.allSettled(
    batches.map((batchTokens) =>
      messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: { title, body },
        data: data || {},
        webpush: {
          notification: { icon: 'https://ccelim.com/elim-logo-mark.png' },
          fcmOptions: { link: webLink },
        },
        android: {
          priority: 'high',
          notification: {
            color: '#f97316',
            channelId: 'elim-default',
            icon: 'ic_stat_notify',
            defaultSound: true,
          },
        },
      })
    )
  );

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
    // Best-effort cleanup: a single failed prune (e.g. a user doc deleted between
    // the read and the write) must not fail the whole broadcast, which already
    // went out - otherwise a retried schedule would double-send.
    await Promise.allSettled(
      usersSnap.docs
        .filter((doc) => (doc.data().fcmTokens || []).some((t) => deadSet.has(t)))
        .map((doc) => doc.ref.update({
          fcmTokens: (doc.data().fcmTokens || []).filter((t) => !deadSet.has(t)),
        }))
    );
  }
}

// ---- Editable automatic notifications ----
// The recurring quiz/champion pushes read their title/body/enabled from
// config/autoNotifs (admin-editable in the app). Anything not set falls back to
// the built-in default, so the app still works before an admin touches it.
async function loadAutoConfig(db) {
  try {
    const s = await db.collection('config').doc('autoNotifs').get();
    return s.exists ? (s.data() || {}) : {};
  } catch (_e) {
    return {};
  }
}

// Replace {name}, {count}, ... placeholders with the run's real values.
function fillTemplate(str, vars) {
  return String(str == null ? '' : str).replace(/\{(\w+)\}/g, (m, k) =>
    (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k]) : m);
}

// Returns { title, body } for an automatic notification, or null if an admin
// has switched it off. `def` is the built-in default; `vars` fills placeholders.
function resolveAuto(cfg, key, def, vars, maxBody = 500) {
  const c = (cfg && cfg[key]) || {};
  if (c.enabled === false) return null;
  const title = fillTemplate((c.title != null && String(c.title).trim()) ? c.title : def.title, vars).slice(0, 120);
  const body = fillTemplate((c.body != null && String(c.body).trim()) ? c.body : def.body, vars).slice(0, maxBody);
  if (!title || !body) return null;
  return { title, body };
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

  if (conv.type === 'direct' || conv.type === 'church') {
    // Direct threads and the one-way church channel both go straight to the
    // other participant(s) - the church channel's sender ('church-elim') isn't
    // a participant, so this leaves just the member.
    recipientIds = (conv.participantIds || []).filter((id) => id !== message.senderId);
  } else if (senderIsStaff) {
    recipientIds = (conv.participantIds || []).filter((id) => id !== message.senderId);
  } else {
    const answeringRole = conv.type === 'pastor' ? 'pastor' : 'admin';
    const staffSnap = await db.collection('users').where('role', '==', answeringRole).get();
    recipientIds = staffSnap.docs.map((d) => d.id).filter((id) => id !== message.senderId);
  }

  if (recipientIds.length === 0) return;

  // Record a bell entry for each recipient - WITHOUT the message text, so a
  // shared or glanced-at phone never leaks a private conversation. It just says
  // "you have a new message" and taps through to Messages. Runs for every
  // recipient (even those with push disabled) so the in-app bell is complete.
  //
  // One deterministic doc per (conversation, recipient): each new message
  // overwrites it (bumping createdAt and re-marking unread) instead of piling
  // up, so a busy thread can't flood the bell or crowd out like/comment alerts.
  const convKey = String(message.conversationId || '').replace(/\//g, '_');
  await Promise.allSettled(recipientIds.map((rid) =>
    db.collection('notifications').doc(`msg_${convKey}_${rid}`).set({
      recipientId: rid,
      type: 'message',
      actorId: message.senderId || '',
      actorName: message.senderName || 'Message',
      actorAvatar: null,
      conversationId: message.conversationId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
  ));

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


// ==================== IN-APP NOTIFICATIONS (the bell) ====================
//
// These create documents in the `notifications` collection, read by the bell
// in the app. They run server-side precisely so a notification can't be
// forged: the client has no create access to the collection (see
// firestore.rules). "New post" alerts are handled client-side from a
// last-seen timestamp, so there is deliberately no per-user fan-out here.

// Look up an actor's display name + avatar for the notification label.
async function resolveActor(db, uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    const d = snap.exists ? snap.data() : {};
    return { name: d.displayName || 'Quelqu\'un', avatar: d.avatar || null };
  } catch (_e) {
    return { name: 'Quelqu\'un', avatar: null };
  }
}

// Send a push to one user's devices (if they have notifications on). Used so
// bell notifications (comments, mentions) also reach the phone, not just the
// in-app list.
async function pushToUser(db, uid, { title, body, data }) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return;
    const d = snap.data();
    if (!d.notificationsEnabled || !Array.isArray(d.fcmTokens) || d.fcmTokens.length === 0) return;
    const messaging = getMessaging();
    const link = 'https://ccelim.com/' + (data && data.postId ? ('?post=' + data.postId) : '');
    await Promise.allSettled(chunk(d.fcmTokens, 500).map((tokens) =>
      messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: data || {},
        webpush: { notification: { icon: 'https://ccelim.com/elim-logo-mark.png' }, fcmOptions: { link } },
        android: { priority: 'high', notification: { color: '#f97316', channelId: 'elim-default', icon: 'ic_stat_notify', defaultSound: true } },
      })
    ));
  } catch (_e) { /* best-effort */ }
}

// Push to EVERYONE with notifications on (like a new post), skipping the uids in
// `exclude` (e.g. the commenter and people already sent a specific push). No
// bell/announcement doc is written — this is push-only, matching how new posts
// notify the whole church.
async function pushToEveryone(db, { title, body, data }, exclude = new Set()) {
  try {
    const usersSnap = await db.collection('users').where('notificationsEnabled', '==', true).get();
    const tokenSet = new Set();
    usersSnap.forEach((doc) => {
      if (exclude.has(doc.id)) return;
      const arr = doc.data().fcmTokens;
      if (Array.isArray(arr)) arr.forEach((t) => t && tokenSet.add(t));
    });
    const tokens = [...tokenSet];
    if (tokens.length === 0) return;
    const messaging = getMessaging();
    const link = 'https://ccelim.com/' + (data && data.postId ? ('?post=' + data.postId) : '');
    await Promise.allSettled(chunk(tokens, 500).map((batchTokens) =>
      messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: { title, body },
        data: data || {},
        webpush: { notification: { icon: 'https://ccelim.com/elim-logo-mark.png' }, fcmOptions: { link } },
        android: { priority: 'high', notification: { color: '#f97316', channelId: 'elim-default', icon: 'ic_stat_notify', defaultSound: true } },
      })
    ));
  } catch (_e) { /* best-effort */ }
}

async function addNotification(db, notif) {
  await db.collection('notifications').add({
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    ...notif,
    ...(notif.actorAvatar ? {} : { actorAvatar: null })
  });
}

// Someone liked a post -> tell the post's author.
exports.notifyOnPostLike = onDocumentCreated('likes/{likeId}', async (event) => {
  const like = event.data && event.data.data();
  if (!like || !like.postId || !like.userId) return;
  const db = getFirestore();
  const postSnap = await db.collection('posts').doc(like.postId).get();
  if (!postSnap.exists) return;
  const post = postSnap.data();
  const recipientId = post.churchId; // the account that published the post
  if (!recipientId || recipientId === like.userId) return; // no self-notify
  const actor = await resolveActor(db, like.userId);
  await addNotification(db, {
    recipientId, type: 'post_like',
    actorId: like.userId, actorName: actor.name, actorAvatar: actor.avatar,
    postId: like.postId, preview: (post.content || '').slice(0, 80)
  });
});

// Keep posts.likes and the most-recent-liker fields honest. Recomputed from
// the real `likes` documents on every like/unlike, so the count always equals
// the number of like docs (self-healing, never a client guess) and the
// "Awa and N others" line never goes stale when the last liker unlikes.
exports.reconcilePostLikes = onDocumentWritten('likes/{likeId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const postId = (after && after.postId) || (before && before.postId);
  if (!postId) return;
  const db = getFirestore();
  const col = db.collection('likes').where('postId', '==', postId);
  const countSnap = await col.count().get();
  const update = { likes: countSnap.data().count };
  const recent = await col.orderBy('createdAt', 'desc').limit(1).get();
  if (recent.empty) {
    update.lastLikeName = FieldValue.delete();
    update.lastLikeUid = FieldValue.delete();
  } else {
    const v = recent.docs[0].data();
    update.lastLikeUid = v.userId || FieldValue.delete();
    let name = v.userName;
    if (!name && v.userId) {
      const u = await db.collection('users').doc(v.userId).get();
      name = u.exists ? (u.data().displayName || '') : '';
    }
    update.lastLikeName = name || FieldValue.delete();
  }
  await db.collection('posts').doc(postId).set(update, { merge: true }).catch(() => {});
});

// posts.views = the real number of unique postViews docs for the post.
exports.reconcilePostViews = onDocumentCreated('postViews/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v || !v.postId) return;
  const db = getFirestore();
  const c = await db.collection('postViews').where('postId', '==', v.postId).count().get();
  await db.collection('posts').doc(v.postId).set({ views: c.data().count }, { merge: true }).catch(() => {});
});

// posts.shares = the real number of unique postShares docs for the post.
exports.reconcilePostShares = onDocumentCreated('postShares/{id}', async (event) => {
  const s = event.data && event.data.data();
  if (!s || !s.postId) return;
  const db = getFirestore();
  const c = await db.collection('postShares').where('postId', '==', s.postId).count().get();
  await db.collection('posts').doc(s.postId).set({ shares: c.data().count }, { merge: true }).catch(() => {});
});

// posts.commentsCount = the real number of comment docs for the post. Keeps the
// counter honest (self-healing) if a comment is ever deleted — the client still
// nudges +1 on add for instant feedback, and this sets the exact value.
exports.reconcileCommentsCount = onDocumentWritten('comments/{commentId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const postId = (after && after.postId) || (before && before.postId);
  if (!postId) return;
  const db = getFirestore();
  const c = await db.collection('comments').where('postId', '==', postId).count().get();
  await db.collection('posts').doc(postId).set({ commentsCount: c.data().count }, { merge: true }).catch(() => {});
});

// Names of everyone in the app, for the comment @mention picker. Members can't
// read the users collection directly (privacy), so this callable returns names
// only — no phone, email or anything else. Any signed-in user may call it.
exports.listMemberNames = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const snap = await db.collection('users').limit(3000).get();
  const members = [];
  snap.forEach((d) => {
    const v = d.data();
    const name = (v.displayName || '').toString().trim();
    if (name && v.role !== 'pending_church') members.push({ uid: d.id, name, avatar: v.avatar || null });
  });
  return { members };
});

// One-time backfill so posts from before view-tracking show a sensible view
// count instead of "2 comments, 1 view". Anyone who liked, commented on, or
// authored a post has certainly seen it, so we create a real postViews doc for
// each of them (which the count is then derived from — no faking). Guarded by a
// flag in config/backfills so the heavy pass runs only once; afterwards this is
// a single cheap read per tick. Runs hourly, church time.
exports.backfillPostViews = onSchedule(
  { schedule: '*/10 * * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const flagRef = db.collection('config').doc('backfills');
    const flag = await flagRef.get();
    // Bumped to v3 so it runs once more (last-liker name) soon after deploy —
    // every 10 min instead of hourly so the "X aime…" line appears quickly;
    // no-ops cheaply once the flag is set.
    if (flag.exists && flag.data().postViewsSeeded_v3) return;
    const nameCache = {};
    const nameFor = async (uid) => {
      if (!uid) return '';
      if (nameCache[uid] !== undefined) return nameCache[uid];
      const u = await db.collection('users').doc(uid).get();
      return (nameCache[uid] = u.exists ? (u.data().displayName || '') : '');
    };
    const posts = await db.collection('posts').get();
    for (const p of posts.docs) {
      const postId = p.id;
      const uids = new Set();
      const author = p.data().authorId || p.data().churchId;
      if (author) uids.add(author);
      (await db.collection('likes').where('postId', '==', postId).get())
        .forEach((d) => { const u = d.data().userId; if (u) uids.add(u); });
      (await db.collection('comments').where('postId', '==', postId).get())
        .forEach((d) => { const u = d.data().userId; if (u) uids.add(u); });
      const ids = [...uids];
      for (let i = 0; i < ids.length; i += 400) {
        const b = db.batch();
        ids.slice(i, i + 400).forEach((uid) => b.set(
          db.collection('postViews').doc(`${postId}_${uid}`),
          { postId, userId: uid, createdAt: FieldValue.serverTimestamp() }, { merge: true }));
        await b.commit();
      }
      const update = { views: (await db.collection('postViews').where('postId', '==', postId).count().get()).data().count };
      // Most-recent liker -> the "X aime cette publication" line under the post.
      const likeCount = (await db.collection('likes').where('postId', '==', postId).count().get()).data().count;
      update.likes = likeCount;
      if (likeCount > 0) {
        const recent = await db.collection('likes').where('postId', '==', postId)
          .orderBy('createdAt', 'desc').limit(1).get();
        if (!recent.empty) {
          const v = recent.docs[0].data();
          update.lastLikeUid = v.userId;
          const name = v.userName || (await nameFor(v.userId));
          if (name) update.lastLikeName = name;
        }
      }
      await p.ref.set(update, { merge: true }).catch(() => {});
    }
    await flagRef.set({ postViewsSeeded: true, postViewsSeeded_v2: true, postViewsSeeded_v3: true, postViewsSeededAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`backfillPostViews: seeded ${posts.size} posts`);
  }
);

// comments.likes = the real number of commentLikes docs for that comment, so
// the comment like counter self-heals like the post counters.
exports.reconcileCommentLikes = onDocumentWritten('commentLikes/{likeId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const commentId = (after && after.commentId) || (before && before.commentId);
  if (!commentId) return;
  const db = getFirestore();
  const c = await db.collection('commentLikes').where('commentId', '==', commentId).count().get();
  await db.collection('comments').doc(commentId).set({ likes: c.data().count }, { merge: true }).catch(() => {});
});

// One member's public-ish profile for the tap-to-view popup: name, photo,
// profession, church departments (interests) and role. No phone, email or date
// of birth — members can't read the users collection directly, so this callable
// returns only what's safe to show others. Any signed-in user may call it.
exports.getMemberProfile = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = String(request.data?.uid || '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'No user.');
  const db = getFirestore();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return { found: false };
  const v = snap.data();
  return {
    found: true,
    name: (v.displayName || '').toString(),
    avatar: v.avatar || null,
    profession: v.profession || '',
    interests: Array.isArray(v.interests) ? v.interests.slice(0, 20) : [],
    role: v.role || 'member',
  };
});

// The shareable projection of a user, written to publicProfiles/{uid}. Members
// can't read the users collection (it holds phone/email/DOB), so this mirrors
// ONLY the fields that are safe to show anyone: name, photo, profession, church
// departments (interests) and role. The client reads publicProfiles directly
// (world-readable to signed-in users), which is more robust than a callable.
function publicProfileOf(v) {
  return {
    name: (v.displayName || '').toString().slice(0, 80),
    avatar: v.avatar || null,
    profession: (v.profession || '').toString().slice(0, 80),
    interests: Array.isArray(v.interests) ? v.interests.slice(0, 20) : [],
    role: v.role || 'member',
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// Keep publicProfiles/{uid} in sync with the user doc: upsert on any change to a
// projected field, delete when the user is removed.
exports.syncPublicProfile = onDocumentWritten(
  { region: 'us-central1', document: 'users/{uid}' },
  async (event) => {
    const db = getFirestore();
    const uid = event.params.uid;
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) {
      await db.collection('publicProfiles').doc(uid).delete().catch(() => {});
      return;
    }
    // Skip when no projected field changed, so ordinary user writes (e.g. an
    // fcmToken refresh) don't churn the projection.
    if (before) {
      const same =
        (before.displayName || '') === (after.displayName || '') &&
        (before.avatar || '') === (after.avatar || '') &&
        (before.profession || '') === (after.profession || '') &&
        (before.role || '') === (after.role || '') &&
        JSON.stringify(before.interests || []) === JSON.stringify(after.interests || []);
      if (same) return;
    }
    await db.collection('publicProfiles').doc(uid).set(publicProfileOf(after), { merge: true }).catch(() => {});
  }
);

// One-time (flag-guarded) backfill so publicProfiles exists for every current
// user right after deploy, not only for those who edit their profile later.
// Runs every 10 min until the flag is set, then no-ops cheaply.
exports.backfillPublicProfiles = onSchedule(
  { schedule: '*/10 * * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const flagRef = db.collection('config').doc('backfills');
    const flag = await flagRef.get();
    if (flag.exists && flag.data().publicProfilesSeeded_v1) return;
    const users = await db.collection('users').get();
    let n = 0;
    for (let i = 0; i < users.docs.length; i += 400) {
      const b = db.batch();
      users.docs.slice(i, i + 400).forEach((d) => {
        b.set(db.collection('publicProfiles').doc(d.id), publicProfileOf(d.data()), { merge: true });
        n++;
      });
      await b.commit();
    }
    await flagRef.set({ publicProfilesSeeded_v1: true, publicProfilesSeededAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`backfillPublicProfiles: seeded ${n} profiles`);
  }
);

// While a live broadcast is on, sample the in-app audience once a minute and
// keep the running PEAK (highest simultaneous watchers) and UNIQUE count
// (distinct viewers over the whole broadcast) on config/liveRadio. A client
// can't do this (config is admin-write only, and no single client is present
// the whole time), so the Admin SDK does it here. No-ops cheaply when off.
exports.sampleLivePresence = onSchedule(
  { schedule: '* * * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const ref = db.collection('config').doc('liveRadio');
    const snap = await ref.get();
    if (!snap.exists) return;
    const d = snap.data() || {};
    if (d.status !== 'live' || !d.liveId) return;
    const liveId = String(d.liveId);
    // "Active now": heartbeats seen in the last ~70s (client beats every 20s).
    const cutoff = Timestamp.fromMillis(Date.now() - 70000);
    const active = (await db.collection('livePresence')
      .where('liveId', '==', liveId).where('lastSeen', '>', cutoff).count().get()).data().count;
    // "Unique": every distinct viewer (one doc per uid) tagged with this liveId.
    const unique = (await db.collection('livePresence')
      .where('liveId', '==', liveId).count().get()).data().count;
    const peak = Math.max(Number(d.peak || 0), active);
    await ref.set({ peak, uniqueCount: unique }, { merge: true }).catch(() => {});
  }
);

// Someone liked a comment -> tell the comment's author.
exports.notifyOnCommentLike = onDocumentCreated('commentLikes/{likeId}', async (event) => {
  const like = event.data && event.data.data();
  if (!like || !like.commentId || !like.userId) return;
  const db = getFirestore();
  const commentSnap = await db.collection('comments').doc(like.commentId).get();
  if (!commentSnap.exists) return;
  const comment = commentSnap.data();
  const recipientId = comment.userId;
  if (!recipientId || recipientId === like.userId) return;
  const actor = await resolveActor(db, like.userId);
  await addNotification(db, {
    recipientId, type: 'comment_like',
    actorId: like.userId, actorName: actor.name, actorAvatar: actor.avatar,
    postId: comment.postId, commentId: like.commentId,
    preview: (comment.text || '').slice(0, 80)
  });
});

// Someone commented -> tell the post's author, and (if it's a reply) the
// parent comment's author. A single person is never notified twice for the
// same comment.
exports.notifyOnComment = onDocumentCreated('comments/{commentId}', async (event) => {
  const comment = event.data && event.data.data();
  if (!comment || !comment.postId || !comment.userId) return;
  const commentId = event.params.commentId;
  const db = getFirestore();
  const actor = await resolveActor(db, comment.userId);
  const notified = new Set([comment.userId]); // never the commenter themselves
  const preview = (comment.text || '').slice(0, 80);
  // kind 'post' so tapping the push opens the post (the client routes 'post';
  // 'comment' is not a route it knows).
  const data = { kind: 'post', postId: comment.postId, commentId };

  // Notify + push in one place, so a bell notification always reaches the phone.
  const notify = async (recipientId, type, body) => {
    if (!recipientId || notified.has(recipientId)) return;
    notified.add(recipientId);
    await addNotification(db, {
      recipientId, type,
      actorId: comment.userId, actorName: actor.name, actorAvatar: actor.avatar,
      postId: comment.postId, commentId, preview,
    });
    await pushToUser(db, recipientId, { title: actor.name, body: `${body} : "${preview}"`, data });
  };

  // Mentions FIRST, so a tagged person gets the distinct "mentioned you"
  // notification rather than a generic comment/reply one.
  const mentions = Array.isArray(comment.mentions) ? comment.mentions : [];
  for (const uid of mentions) {
    await notify(uid, 'comment_mention', 'vous a mentionné dans un commentaire');
  }

  // Reply -> the parent comment's author.
  if (comment.parentId) {
    const parentSnap = await db.collection('comments').doc(comment.parentId).get();
    if (parentSnap.exists) {
      await notify(parentSnap.data().userId, 'comment_reply', 'a répondu à votre commentaire');
    }
  }

  // Comment on a post -> the post's author.
  const postSnap = await db.collection('posts').doc(comment.postId).get();
  const post = postSnap.exists ? postSnap.data() : null;
  if (post) {
    await notify(post.churchId, 'post_comment', 'a commenté votre publication');
  }

  // Everyone else gets a push too (like a new post) — the whole church is told
  // a conversation is happening, even if it's not their post and they haven't
  // commented. People already sent a specific notification above (author,
  // mentions, reply) and the commenter are skipped so no one is pushed twice.
  const postName = (post && (post.churchName || post.authorName)) || 'ELIM';
  await pushToEveryone(db, {
    title: postName,
    body: `${actor.name} a commenté : "${preview}"`,
    data: { kind: 'post', postId: comment.postId, commentId },
  }, notified);
});


// ==================== DONATION THANK-YOU ====================
//
// When a member declares a donation (the app writes a doc to `donations`),
// send a thank-you into their Messages from "Centre Chrétien E.L.I.M.".
// Done server-side so the message genuinely comes from the church and can't
// be forged by a client. It lands in the member's pastor channel - the same
// deterministic `pastor_{uid}` conversation the app's Messages tab uses - so
// no new UI is needed on the client, and the existing notifyOnNewMessage
// trigger below picks it up and pushes it to the donor's phone.
exports.thankOnDonation = onDocumentCreated('donations/{donationId}', async (event) => {
  const donation = event.data && event.data.data();
  // 'unknown' is the placeholder the Square webhook uses when a payment note
  // doesn't map to a member (e.g. a payment made outside the app) - there's no
  // real account to thank, so don't spin up a church_unknown conversation.
  if (!donation || !donation.donorId || donation.donorId === 'unknown') return;
  const db = getFirestore();

  // The thank-you text is admin-editable in the donation settings; fall back
  // to a sensible default, personalised by donation type.
  let text = '';
  try {
    const cfg = await db.collection('config').doc('donation').get();
    text = ((cfg.exists && cfg.data().thanksMessage) || '').trim();
  } catch (_e) { /* fall through to the default */ }
  if (!text) {
    const typeWord = donation.type === 'dime' ? 'votre dîme'
      : donation.type === 'offrande' ? 'votre offrande'
      : 'votre don';
    text = `Merci pour ${typeWord} ! Que Dieu vous bénisse abondamment. — Centre Chrétien E.L.I.M.`;
  }

  // Delivered into a dedicated one-way "church" channel - NOT the personal
  // pastor thread - so the donor sees it come from Centre Chrétien E.L.I.M.
  // itself, not from the pastor or an admin. The channel is read-only in the
  // app; only the server writes into it.
  const convId = `church_${donation.donorId}`;
  const convRef = db.collection('conversations').doc(convId);
  const convSnap = await convRef.get();

  const SENDER_ID = 'church-elim';
  const SENDER_NAME = 'Centre Chrétien E.L.I.M.';

  const convPayload = {
    type: 'church',
    participantIds: [donation.donorId],
    participantNames: { [donation.donorId]: donation.donorName || '' },
    lastMessage: text.slice(0, 120),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastSenderId: SENDER_ID,
  };
  if (!convSnap.exists) {
    convPayload.createdAt = FieldValue.serverTimestamp();
    convPayload.ownerRole = 'member';
  }
  await convRef.set(convPayload, { merge: true });

  await db.collection('messages').add({
    conversationId: convId,
    senderId: SENDER_ID,
    senderName: SENDER_NAME,
    senderRole: 'church',
    text,
    participantIds: [donation.donorId],
    createdAt: FieldValue.serverTimestamp(),
  });
});

// Google Cloud Translation gives 500,000 characters/month free, then bills.
// We keep the app permanently inside that free tier two ways:
//   1. A shared server-side cache: each unique (text, language) is translated
//      ONCE for the whole congregation and reused, instead of once per phone.
//   2. A monthly character budget: once the month's real API usage nears the
//      free limit we stop calling the paid API and just return the original
//      text, so a burst can never run up a bill. Both reset every month.
const TRANSLATION_FREE_BUDGET = 450000; // chars/month, safe margin under 500k

// Translates a single piece of user content into the reader's language, on
// demand from the "Translate" button. Callable (not an HTTP endpoint) so the
// Firebase Auth token rides along automatically - only signed-in members can
// use it, which keeps it from being an open, abusable translation proxy.
// ==================== AUDIO/VIDEO TRANSCRIPTION ====================
//
// On-demand speech-to-text for church leads. Any audio/video is normalised to
// mono 16 kHz FLAC with ffmpeg (so any input format, including a video's audio
// track, works), staged in Cloud Storage, and transcribed with Google Cloud
// Speech-to-Text (long-running, so full sermons are fine). French is the
// primary language with English auto-detected as a fallback.
//
// Two entry points share one pipeline:
//  - transcribePost: transcribes an existing audio/video post; the result is
//    cached in transcripts/{postId} (lead-readable) so it is produced once.
//  - transcribeUpload: transcribes a file a lead just uploaded via the Read-tab
//    tool, then DELETES that upload from Storage - it is a scratch transcription.

// /tmp is memory-backed on gen2, so the downloaded media + FLAC both count
// against RAM; 4 GiB leaves headroom for a long sermon or a large video.
// concurrency:1 keeps one transcription per instance so several large jobs on
// one warm instance can't stack their /tmp usage and OOM-kill each other.
const TRANSCRIBE_OPTS = { region: 'us-central1', memory: '4GiB', timeoutSeconds: 3600, concurrency: 1 };

// Authorize a transcription caller. Must be church/admin/pastor; a plain
// 'church' lead additionally needs the 'transcribe' group capability (admins
// and pastors always pass). Mirrors the database-level check in firestore.rules.
async function requireLead(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const snap = await db.collection('users').doc(request.auth.uid).get();
  const d = snap.exists ? snap.data() : {};
  const role = d.role;
  if (!['church', 'admin', 'pastor'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only church leads can transcribe.');
  }
  // A managed lead (assigned to groups) needs the transcribe capability;
  // legacy accounts never placed in a group are grandfathered, matching
  // managedByGroups() in firestore.rules.
  if (role === 'church' && d.groupCaps && !d.groupCaps.transcribe) {
    throw new HttpsError('permission-denied', 'Your group does not have the transcription permission.');
  }
  return request.auth.uid;
}

// Turn a stored media reference into a Storage object path. Handles the Firebase
// download URL shape (…/o/<url-encoded-path>?…), a gs:// URI, or a plain path.
function storageObjectPath(mediaUrl) {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('gs://')) return mediaUrl.replace(/^gs:\/\/[^/]+\//, '');
  const m = mediaUrl.match(/\/o\/([^?]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (!mediaUrl.startsWith('http')) return mediaUrl.replace(/^\/+/, '');
  return null;
}

// How long each transcription chunk is. A single recognize request over a full
// 45-minute sermon can come back incomplete, so we split the audio into fixed
// segments, transcribe each, and stitch them in order - which reliably covers
// the whole file however long it is.
const CHUNK_SECONDS = 480; // 8 minutes per chunk

// Transcribe one already-staged FLAC chunk in GCS. Returns its transcript text.
async function recognizeChunk(bucket, stagedPath) {
  const [operation] = await speechClient.longRunningRecognize({
    config: {
      encoding: 'FLAC',
      sampleRateHertz: 16000,
      audioChannelCount: 1,
      languageCode: 'fr-FR',
      alternativeLanguageCodes: ['en-US'],
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    },
    audio: { uri: `gs://${bucket.name}/${stagedPath}` },
  });
  const [response] = await operation.promise();
  return (response.results || [])
    .map((r) => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '')
    .filter(Boolean)
    .join(' ')
    .trim();
}

// Download -> ffmpeg to 16 kHz mono FLAC, split into fixed-length chunks ->
// transcribe each chunk from GCS -> stitch in order -> clean up. Returns the
// joined transcript. Throws on failure; callers record the error.
async function runTranscription(objectPath, onProgress) {
  const bucket = getStorage().bucket();
  const id = crypto.randomUUID();
  const localIn = path.join(os.tmpdir(), `stt-in-${id}`);
  const chunkPattern = path.join(os.tmpdir(), `stt-${id}-%03d.flac`);
  const stagedPrefix = `transcribe-temp/${id}/`;

  const localChunks = () => {
    try {
      return fs.readdirSync(os.tmpdir())
        .filter((f) => f.startsWith(`stt-${id}-`) && f.endsWith('.flac'))
        .sort()
        .map((f) => path.join(os.tmpdir(), f));
    } catch (_e) { return []; }
  };

  const cleanup = async () => {
    try { fs.existsSync(localIn) && fs.unlinkSync(localIn); } catch (_e) { /* ignore */ }
    for (const f of localChunks()) { try { fs.unlinkSync(f); } catch (_e) { /* ignore */ } }
    try { await bucket.deleteFiles({ prefix: stagedPrefix, force: true }); } catch (_e) { /* ignore */ }
  };

  try {
    await bucket.file(objectPath).download({ destination: localIn });
    // -vn drops any video stream; take one 16 kHz mono FLAC track, split into
    // CHUNK_SECONDS segments with timestamps reset so each is self-contained.
    await new Promise((resolve, reject) => {
      ffmpeg(localIn)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .audioCodec('flac')
        .format('segment')
        .outputOptions([`-segment_time`, String(CHUNK_SECONDS), '-reset_timestamps', '1'])
        .on('end', resolve)
        .on('error', reject)
        .save(chunkPattern);
    });
    // The source is fully consumed into chunks now; free it before the recognize
    // loop so /tmp (memory-backed) doesn't hold the whole download the whole time.
    try { fs.unlinkSync(localIn); } catch (_e) { /* ignore */ }

    const chunks = localChunks();
    if (chunks.length === 0) { await cleanup(); return ''; }

    // Splitting done: report a little progress before the (longer) recognize loop.
    if (onProgress) { try { await onProgress(0.05); } catch (_e) { /* ignore */ } }

    const parts = [];
    // Sequential: one chunk in memory/GCS at a time keeps a long file well
    // within the function's memory and avoids hammering the STT quota. A single
    // chunk failing (transient STT error, one bad segment) must not discard the
    // whole sermon, so each chunk is tried independently and gaps are tolerated.
    for (let i = 0; i < chunks.length; i++) {
      const staged = `${stagedPrefix}${String(i).padStart(3, '0')}.flac`;
      try {
        await bucket.upload(chunks[i], { destination: staged, resumable: false });
        parts.push(await recognizeChunk(bucket, staged));
      } catch (_e) {
        parts.push(''); // keep going; this segment is simply missing from the transcript
      }
      try { await bucket.file(staged).delete({ ignoreNotFound: true }); } catch (_e) { /* ignore */ }
      try { fs.unlinkSync(chunks[i]); } catch (_e) { /* ignore */ }
      // Progress across the recognize loop: 5% (split) -> 100% (last chunk).
      if (onProgress) { try { await onProgress(0.05 + 0.95 * ((i + 1) / chunks.length)); } catch (_e) { /* ignore */ } }
    }
    await cleanup();
    return parts.filter(Boolean).join(' ').trim();
  } catch (err) {
    await cleanup();
    throw err;
  }
}

// (transcribePost was removed: the per-post "Script" button no longer exists,
// and transcribing an arbitrary post.mediaUrl let a caller reach files outside
// their own space. Only the scoped scratch-upload path below remains.)

// Transcribe a lead's scratch UPLOAD, then delete it from Storage. The result
// is written to the caller-created transcribeJobs/{jobId} doc they subscribe to.
// When a transcript is ready, tell the lead who requested it AND every
// admin/pastor: a bell entry + a push, both carrying the .txt download link.
async function notifyTranscriptReady(db, requesterUid, name, fileUrl) {
  const staff = await db.collection('users').where('role', 'in', ['admin', 'pastor']).get();
  const recipients = [...new Set([requesterUid, ...staff.docs.map((d) => d.id)])];
  const title = '📝 Transcription prête';
  const body = `« ${name} » est prête. Touchez pour télécharger le fichier texte.`;

  await Promise.allSettled(recipients.map((rid) => addNotification(db, {
    recipientId: rid, type: 'transcript', actorId: requesterUid, actorName: name,
    url: fileUrl || null,
  })));

  const tokens = [];
  for (const grp of chunk(recipients, 30)) {
    const us = await db.collection('users').where('__name__', 'in', grp).get();
    us.forEach((d) => { const x = d.data(); if (x.notificationsEnabled && Array.isArray(x.fcmTokens)) tokens.push(...x.fcmTokens); });
  }
  const uniq = [...new Set(tokens)];
  if (uniq.length === 0) return;
  const messaging = getMessaging();
  await Promise.allSettled(chunk(uniq, 500).map((batch) => messaging.sendEachForMulticast({
    tokens: batch,
    notification: { title, body },
    data: { kind: 'transcript', ...(fileUrl ? { url: fileUrl } : {}) },
    webpush: { notification: { icon: 'https://ccelim.com/elim-logo-mark.png' }, fcmOptions: { link: fileUrl || 'https://ccelim.com/' } },
    android: { priority: 'high', notification: { color: '#f97316', channelId: 'elim-default', icon: 'ic_stat_notify', defaultSound: true } },
  })));
}

exports.transcribeUpload = onCall(TRANSCRIBE_OPTS, async (request) => {
  const uid = await requireLead(request);
  const jobId = String(request.data?.jobId || '').trim();
  const objectPath = String(request.data?.path || '').trim();
  if (!jobId || !objectPath) throw new HttpsError('invalid-argument', 'jobId and path are required.');
  // A lead may only transcribe files they uploaded to their own scratch space.
  if (!objectPath.startsWith(`transcribe-uploads/${uid}/`)) {
    throw new HttpsError('permission-denied', 'You can only transcribe your own uploads.');
  }

  const db = getFirestore();
  const ref = db.collection('transcribeJobs').doc(jobId);
  const snap0 = await ref.get();
  const origName = (snap0.exists && snap0.data().fileName) ? String(snap0.data().fileName) : '';
  try {
    // Report progress to the job doc as each chunk finishes, so the UI shows a
    // real progress bar.
    let lastPct = -1;
    const text = await runTranscription(objectPath, async (frac) => {
      const pct = Math.min(99, Math.max(0, Math.round(frac * 100)));
      if (pct === lastPct) return;
      lastPct = pct;
      try { await ref.set({ progress: pct }, { merge: true }); } catch (_e) { /* ignore */ }
    });
    // The upload was a scratch file only needed for the transcript: remove it.
    try { await getStorage().bucket().file(objectPath).delete({ ignoreNotFound: true }); } catch (_e) { /* ignore */ }

    // Save the transcript as a downloadable .txt (token URL, forced download).
    const base = (origName.replace(/\.[^.]+$/, '') || 'transcription').replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'transcription';
    const filePath = `transcripts/${uid}/${jobId}.txt`;
    const token = crypto.randomUUID();
    let fileUrl = null;
    try {
      await getStorage().bucket().file(filePath).save(Buffer.from(text || '', 'utf8'), {
        contentType: 'text/plain; charset=utf-8',
        metadata: {
          contentDisposition: `attachment; filename="${base}.txt"`,
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
      const bucketName = getStorage().bucket().name;
      fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
    } catch (e) { console.error('transcript file save failed', e); }

    await ref.set({ ownerUid: uid, status: 'done', text, progress: 100, fileUrl, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    try { await notifyTranscriptReady(db, uid, base, fileUrl); } catch (e) { console.error('transcript notify failed', e); }
    return { text };
  } catch (err) {
    try { await getStorage().bucket().file(objectPath).delete({ ignoreNotFound: true }); } catch (_e) { /* ignore */ }
    await ref.set({ ownerUid: uid, status: 'error', error: String(err && err.message || err).slice(0, 300), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpsError('internal', 'Transcription failed.');
  }
});

// ==================== GROUP PERMISSIONS -> USER CAPS ====================
//
// Security rules can't query "any group where this user is a lead", so we
// denormalise each lead's effective permissions onto their user document as
// `groupCaps`. This runs whenever a group changes and recomputes caps for every
// lead that group touches (added or removed), by unioning the perms of all the
// groups they lead. The rules then enforce these caps at the database level
// (see firestore.rules), so a lead genuinely cannot post/upload/transcribe a
// surface their groups don't grant - not just a hidden button.
exports.syncGroupCaps = onDocumentWritten(
  { region: 'us-central1', document: 'groups/{groupId}' },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const affected = new Set([
      ...((before && before.leadIds) || []),
      ...((after && after.leadIds) || []),
    ]);
    if (affected.size === 0) return;

    const db = getFirestore();
    // Recompute each affected lead's caps inside a transaction that reads the
    // CURRENT set of groups they lead. Concurrent group edits then retry rather
    // than clobbering each other (a plain read-all-then-write races and can drop
    // a cap until the next unrelated group change re-syncs).
    await Promise.allSettled([...affected].map((uid) =>
      db.runTransaction(async (tx) => {
        const gsnap = await tx.get(db.collection('groups').where('leadIds', 'array-contains', uid));
        const caps = { post: false, sante: false, books: false, transcribe: false };
        gsnap.forEach((doc) => {
          const g = doc.data();
          if (!g.leads || !g.leads[uid]) return;
          const p = g.perms || {};
          if (p.post) caps.post = true;
          if (p.sante) caps.sante = true;
          if (p.books) caps.books = true;
          if (p.transcribe) caps.transcribe = true;
        });
        tx.set(db.collection('users').doc(uid), { groupCaps: caps }, { merge: true });
      })
    ));
  }
);

// Keep date-of-birth OUT of the church-readable user document. Leads can read
// the users collection (for the message picker / member list), so DOB - the
// most sensitive personal field - is moved to users/{uid}/private/profile,
// which only the owner and admins can read. Runs on any user-doc write, so it
// both handles new signups and back-fills existing accounts as they're touched.
exports.stripDobToPrivate = onDocumentWritten(
  { region: 'us-central1', document: 'users/{uid}' },
  async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.dateOfBirth == null) return; // nothing to move
    const uid = event.params.uid;
    const db = getFirestore();
    await db.doc(`users/${uid}/private/profile`).set(
      { dateOfBirth: after.dateOfBirth }, { merge: true });
    // Remove it from the public doc (this write re-triggers the function, which
    // then no-ops because dateOfBirth is gone).
    await db.collection('users').doc(uid).update({ dateOfBirth: FieldValue.delete() });
  }
);

// Keep the quiz's DENORMALISED name copies in sync with the user's real name.
// The leaderboards store a copy of displayName on the score docs (stamped when a
// game is played), so editing users/{uid}.displayName alone leaves the old name
// on the boards. On any user-doc write we compare the quiz career name and, if
// it's stale, fix it everywhere it's copied: the career profile (General
// board), the weekly rows (name), and the kids rows (parentName). Cheap: one
// read per write, and it only writes when there's an actual mismatch — so it
// also back-fills a rename that happened before this function existed, the next
// time that user's doc is touched (their own app open re-writes it).
// Sync a user's name to every place the app copied it at write time: the quiz
// score docs (career profile, weekly rows, kids rows), plus posts (authorName)
// and comments (userName). Only stale docs are written. Shared by the automatic
// trigger and the admin "resync" button. Returns what it touched.
async function syncDisplayName(db, uid, name) {
  const setField = async (refs, field) => {
    for (let i = 0; i < refs.length; i += 450) {
      const b = db.batch();
      refs.slice(i, i + 450).forEach((r) => b.update(r, { [field]: name }));
      await b.commit();
    }
  };
  // Quiz.
  const prof = await db.collection('quizProfiles').doc(uid).get();
  const qb = db.batch();
  let quizWrites = 0;
  if (prof.exists && (prof.data().displayName || '') !== name) { qb.set(prof.ref, { displayName: name }, { merge: true }); quizWrites++; }
  const weekly = await db.collection('quizWeekly').where('uid', '==', uid).get();
  weekly.forEach((d) => { if ((d.data().name || '') !== name) { qb.update(d.ref, { name }); quizWrites++; } });
  const kids = await db.collection('quizKids').where('uid', '==', uid).get();
  kids.forEach((d) => { if ((d.data().parentName || '') !== name) { qb.update(d.ref, { parentName: name }); quizWrites++; } });
  if (quizWrites) await qb.commit();
  // Posts (authorName) — modern authorId + legacy churchId.
  const postRefs = new Map();
  for (const field of ['authorId', 'churchId']) {
    const snap = await db.collection('posts').where(field, '==', uid).get();
    snap.forEach((d) => { const an = d.data().authorName; if (an != null && an !== name) postRefs.set(d.id, d.ref); });
  }
  await setField([...postRefs.values()], 'authorName');
  // Comments (userName).
  const csnap = await db.collection('comments').where('userId', '==', uid).get();
  const cRefs = csnap.docs.filter((d) => (d.data().userName || '') !== name).map((d) => d.ref);
  await setField(cRefs, 'userName');
  // Likes (userName) — the denormalized liker name behind "Awa and N others".
  const lsnap = await db.collection('likes').where('userId', '==', uid).get();
  const lRefs = lsnap.docs.filter((d) => (d.data().userName || '') !== name).map((d) => d.ref);
  await setField(lRefs, 'userName');
  // Posts where this person is the shown most-recent liker.
  const llsnap = await db.collection('posts').where('lastLikeUid', '==', uid).get();
  const llRefs = llsnap.docs.filter((d) => (d.data().lastLikeName || '') !== name).map((d) => d.ref);
  await setField(llRefs, 'lastLikeName');
  return { quiz: quizWrites, posts: postRefs.size, comments: cRefs.length, likes: lRefs.length };
}

// Automatic: whenever a user's displayName actually changes, propagate it.
exports.propagateDisplayName = onDocumentWritten(
  { region: 'us-central1', document: 'users/{uid}' },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    const name = (after.displayName || '').toString().slice(0, 80);
    if (!name) return;
    if (before && (before.displayName || '') === name) return; // name didn't change
    const r = await syncDisplayName(getFirestore(), event.params.uid, name);
    console.log(`propagateDisplayName: ${event.params.uid} -> "${name}"`, r);
  }
);

// Manual: an admin resyncs a chosen user's name everywhere — for a rename made
// (e.g. directly in the database) before the automatic trigger could catch it.
exports.adminResyncName = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const me = await db.collection('users').doc(request.auth.uid).get();
  if (!['admin', 'pastor'].includes(me.exists ? me.data().role : null)) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }
  const uid = String(request.data?.uid || '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'No user selected.');
  const target = await db.collection('users').doc(uid).get();
  if (!target.exists) throw new HttpsError('not-found', 'That user no longer exists.');
  const name = (target.data().displayName || '').toString().slice(0, 80);
  if (!name) throw new HttpsError('failed-precondition', 'That user has no name set.');
  const r = await syncDisplayName(db, uid, name);
  return { ok: true, name, ...r };
});

exports.translateContent = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to translate.');
  }
  const text = String(request.data?.text || '').trim();
  const target = String(request.data?.target || '').trim();
  if (!text || !target) {
    throw new HttpsError('invalid-argument', 'text and target are required.');
  }
  // A church post or message; anything longer is almost certainly abuse.
  if (text.length > 5000) {
    throw new HttpsError('invalid-argument', 'Text is too long to translate.');
  }

  const db = getFirestore();
  const cacheKey = crypto.createHash('sha1').update(`${target}\n${text}`).digest('hex');
  const cacheRef = db.collection('translationCache').doc(cacheKey);

  // 1. Shared cache - free, and instant on a repeat.
  try {
    const hit = await cacheRef.get();
    if (hit.exists) {
      return { text: hit.data().text, source: hit.data().source || null };
    }
  } catch (_e) { /* cache is best-effort; fall through to translate */ }

  // 2. Monthly free-tier guard.
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const usageRef = db.collection('translationUsage').doc(month);
  let used = 0;
  try {
    const u = await usageRef.get();
    used = (u.exists && u.data().chars) || 0;
  } catch (_e) { /* if we can't read usage, be conservative and still translate */ }
  if (used + text.length > TRANSLATION_FREE_BUDGET) {
    // Over budget for the month: show the original rather than spend money.
    return { text, source: null, capped: true };
  }

  try {
    const [translation, meta] = await translateClient.translate(text, target);
    const detected = meta && meta.data && meta.data.translations
      && meta.data.translations[0]
      ? meta.data.translations[0].detectedSourceLanguage
      : null;
    // Persist to the shared cache and count the characters we actually spent.
    cacheRef.set({ text: translation, source: detected || null, target, at: FieldValue.serverTimestamp() })
      .catch(() => {});
    usageRef.set({ chars: FieldValue.increment(text.length), month }, { merge: true })
      .catch(() => {});
    return { text: translation, source: detected || null };
  } catch (err) {
    console.error('translateContent failed', err);
    throw new HttpsError('internal', 'Translation failed. Please try again.');
  }
});


// ==================== SQUARE DONATIONS ====================
//
// Real payment <-> record linking. The app asks createSquareCheckout for a
// Square payment page carrying the donor's uid; after the donor pays, Square
// calls squareWebhook, which verifies the signature, reads the real amount,
// and writes a VERIFIED donation matched to that donor. thankOnDonation then
// sends the thank-you automatically. No self-declaration, no guesswork.

// Currencies with no minor unit ("cents"): 200 JPY / 200 XOF is 200, not
// 20000. Square expects the smallest unit, so the multiplier depends on this.
const ZERO_DECIMAL = new Set([
  'JPY', 'XOF', 'XAF', 'XPF', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF',
  'GNF', 'PYG', 'BIF', 'DJF', 'KMF', 'MGA', 'VUV',
]);
const minorFactor = (cur) => (ZERO_DECIMAL.has(cur) ? 1 : 100);

// The CFA francs are pegged to the euro at a fixed, published rate, so we can
// convert them exactly with no network call - a reliable fallback if the live
// rate service is unreachable, and the source of truth for the EUR pairs.
const CFA_PER_EUR = { XOF: 655.957, XAF: 655.957, XPF: 119.33174 };
function cfaPeg(amount, from, to) {
  if (from === 'EUR' && CFA_PER_EUR[to]) return amount * CFA_PER_EUR[to];
  if (CFA_PER_EUR[from] && to === 'EUR') return amount / CFA_PER_EUR[from];
  return null;
}

// fetch with a hard timeout so a hung upstream can't tie up an instance until
// the function's own (much longer) timeout.
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Convert a major-unit amount between currencies. Live rates from the free
// open.er-api.com; the fixed CFA<->EUR peg backs it up. Returns null if we
// genuinely can't get a rate (caller turns that into a friendly error).
async function fxConvert(amount, from, to) {
  if (from === to) return amount;
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return cfaPeg(amount, from, to);
  try {
    const r = await fetchWithTimeout(`https://open.er-api.com/v6/latest/${from}`);
    const j = await r.json();
    if (j && j.result === 'success' && j.rates && typeof j.rates[to] === 'number') {
      return amount * j.rates[to];
    }
    console.error('FX API returned no rate', from, to, JSON.stringify(j).slice(0, 200));
  } catch (err) {
    console.error('FX API failed', err);
  }
  return cfaPeg(amount, from, to);
}

// Reads the Square location's own currency (USD, CAD, EUR, ...). A quick_pay
// price MUST be in this currency or Square rejects the link.
async function squareLocationCurrency(accessToken, locationId) {
  try {
    const locRes = await fetchWithTimeout(`${SQUARE_API}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_VERSION },
    });
    const locJson = await locRes.json();
    if (locRes.ok && locJson.location && locJson.location.currency) {
      return String(locJson.location.currency).toUpperCase();
    }
    console.error('Square location lookup returned no currency', locRes.status, JSON.stringify(locJson));
  } catch (err) {
    console.error('Square location lookup failed', err);
  }
  return null;
}

// Tells the app which currency this Square account actually charges in, so the
// donation form can label the amount and default its currency picker.
exports.squareChargeCurrency = onCall(
  { region: 'us-central1', secrets: [SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const currency = await squareLocationCurrency(SQUARE_ACCESS_TOKEN.value(), SQUARE_LOCATION_ID.value());
    return { currency: currency || 'USD' };
  },
);

// Creates a Square-hosted checkout and returns its URL. The donor enters an
// amount in a currency they choose (e.g. FCFA); we convert it into the Square
// account's real currency and charge THAT, so "200 FCFA" is never mistaken for
// "$200". The donor's uid rides along in payment_note so the webhook can match
// the payment back to the person.
exports.createSquareCheckout = onCall(
  { region: 'us-central1', secrets: [SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to give.');
    const uid = request.auth.uid;
    const rawAmount = Number(request.data && request.data.amount);
    const inputCurrency = String((request.data && request.data.currency) || '').toUpperCase();
    const type = String((request.data && request.data.type) || 'autre');
    const purpose = String((request.data && request.data.purpose) || '').slice(0, 120);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      throw new HttpsError('invalid-argument', 'Enter a valid amount.');
    }

    const accessToken = SQUARE_ACCESS_TOKEN.value();
    const locationId = SQUARE_LOCATION_ID.value();
    const chargeCurrency = (await squareLocationCurrency(accessToken, locationId)) || 'USD';
    const from = inputCurrency || chargeCurrency;

    // Convert the entered amount into the account's charge currency.
    let chargedMajor;
    if (from === chargeCurrency) {
      chargedMajor = rawAmount;
    } else {
      const converted = await fxConvert(rawAmount, from, chargeCurrency);
      if (converted == null) {
        throw new HttpsError('failed-precondition', 'conversion_unavailable');
      }
      chargedMajor = converted;
    }

    const factor = minorFactor(chargeCurrency);
    const chargeMinor = Math.round(chargedMajor * factor);
    const source = { amount: rawAmount, currency: from };

    // Card processors won't take micro-payments; Square's floor is ~1 unit of
    // the charge currency. Tell the giver kindly instead of failing at Square.
    const MIN_MINOR = 100;
    if (chargeMinor < MIN_MINOR) {
      return {
        ok: false,
        reason: 'below_min',
        min: { amount: MIN_MINOR / factor, currency: chargeCurrency },
        charge: { amount: chargeMinor / factor, currency: chargeCurrency },
        source,
      };
    }

    const body = {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: purpose ? `Don — ${purpose}` : 'Don — Centre Chrétien E.L.I.M',
        price_money: { amount: chargeMinor, currency: chargeCurrency },
        location_id: locationId,
      },
      // Carries the donor + gift type through to the webhook.
      payment_note: `elim:${uid}:${['dime', 'offrande', 'autre'].includes(type) ? type : 'autre'}`,
      checkout_options: {
        redirect_url: 'https://ccelim.com/?donation=thanks',
        ask_for_shipping_address: false,
      },
    };

    let json;
    try {
      const res = await fetchWithTimeout(`${SQUARE_API}/online-checkout/payment-links`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': SQUARE_VERSION,
        },
        body: JSON.stringify(body),
      });
      json = await res.json();
      if (!res.ok) {
        console.error('Square payment-link error', res.status, JSON.stringify(json));
        throw new HttpsError('internal', 'Could not start the Square checkout.');
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('Square request failed', err);
      throw new HttpsError('internal', 'Could not reach Square. Please try again.');
    }

    return {
      ok: true,
      url: json.payment_link && json.payment_link.url,
      orderId: (json.payment_link && json.payment_link.order_id) || null,
      charge: { amount: chargeMinor / factor, currency: chargeCurrency },
      source,
      converted: from !== chargeCurrency,
    };
  },
);

// Receives Square webhooks. Verifies the HMAC signature, then on a COMPLETED
// payment records a verified donation for the donor named in payment_note.
exports.squareWebhook = onRequest(
  { region: 'us-central1', secrets: [SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL] },
  async (req, res) => {
    try {
      const signature = req.get('x-square-hmacsha256-signature') || '';
      const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
      const expected = crypto
        .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY.value())
        .update(SQUARE_WEBHOOK_URL.value() + raw)
        .digest('base64');
      // Constant-time compare, guarding against a length mismatch throwing.
      const ok = signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!ok) {
        console.warn('Square webhook: signature mismatch');
        return res.status(403).send('bad signature');
      }

      const event = req.body || {};
      if (event.type !== 'payment.created' && event.type !== 'payment.updated') {
        return res.status(200).send('ignored');
      }
      const payment = event.data && event.data.object && event.data.object.payment;
      if (!payment || payment.status !== 'COMPLETED') {
        return res.status(200).send('not completed');
      }

      const db = getFirestore();

      const m = /^elim:([^:]+):?(.*)$/.exec(payment.note || '');
      const donorId = m ? m[1] : 'unknown';
      const donType = m && ['dime', 'offrande', 'autre'].includes(m[2]) ? m[2] : 'autre';
      const minor = (payment.amount_money && payment.amount_money.amount) || 0;
      const currency = (payment.amount_money && payment.amount_money.currency) || 'USD';
      // amount_money is already in the currency's smallest unit. For zero-decimal
      // currencies (JPY, XOF, ...) that IS the whole number - don't divide by 100.
      const factor = minorFactor(currency);
      const major = minor / factor;
      const amountStr = factor === 100 ? `${major.toFixed(2)} ${currency}` : `${major} ${currency}`;

      let donorName = '';
      if (donorId !== 'unknown') {
        try {
          const u = await db.collection('users').doc(donorId).get();
          donorName = u.exists ? (u.data().displayName || '') : '';
        } catch (_e) { /* name is best-effort */ }
      }

      // Idempotency: key the doc on the Square payment id and create() it, so
      // payment.created and payment.updated (which arrive near-simultaneously
      // and can retry) can never write two donation records for one payment.
      try {
        await db.collection('donations').doc(`sq_${payment.id}`).create({
          donorId,
          donorName,
          type: donType,
          amount: amountStr,
          amountCents: minor,
          currency,
          provider: 'square',
          squarePaymentId: payment.id,
          squareOrderId: payment.order_id || null,
          status: 'verified',
          verifiedById: 'square',
          verifiedByName: 'Square',
          verifiedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        // ALREADY_EXISTS (gRPC code 6): this payment was already recorded.
        if (err && err.code === 6) return res.status(200).send('duplicate');
        throw err;
      }

      return res.status(200).send('ok');
    } catch (err) {
      // Return 200 so Square doesn't retry-storm on our own bug; it's logged.
      console.error('squareWebhook error', err);
      return res.status(200).send('error-logged');
    }
  },
);


// ==================== BIBLE QUIZ PUSH ====================

// Morning nudge: remind everyone the daily challenge is ready. Fires once a
// day at 08:00 church time. Body is French (the congregation's language).
exports.dailyQuizReminder = onSchedule(
  { schedule: '0 8 * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const cfg = await loadAutoConfig(db);
    const m = resolveAuto(cfg, 'quizReminder', {
      title: 'Quiz Biblique 🏆',
      body: "Le défi du jour t'attend : 5 questions, +50 points et un badge !",
    }, {});
    if (!m) return; // admin switched it off
    await broadcastPush(db, { title: m.title, body: m.body, data: { kind: 'quiz' } });
  }
);

// ── One-time announcement: v1.25 (build 129) is live on the Play Store ────────
// Tells members a new version with the Bible Quiz is available, with the store
// link in the body. A config flag makes it send EXACTLY ONCE, then it no-ops on
// every later daily run - so the cron never nags twice, and the function is safe
// to leave deployed (or remove in a later cleanup).
//
// NOTE: the flag key was bumped to `updateV125Sent2` for a deliberate re-send
// (the first attempt didn't reach members), so this ignores the old flag and
// delivers once more, then stays idempotent against its own retries.
const ELIM_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.elim.app';
exports.announceUpdateV125 = onSchedule(
  { schedule: '45 11 * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const ref = db.collection('config').doc('broadcasts');
    const snap = await ref.get();
    if (snap.exists && snap.data().updateV125Sent2) return; // already sent once
    await broadcastPush(db, {
      title: '🎉 Nouvelle version E.L.I.M disponible',
      body: `Mettez à jour l'application sur le Play Store pour découvrir le nouveau Quiz Biblique 🏆 et de nombreuses améliorations ! 👉 ${ELIM_PLAY_URL}`,
      data: { kind: 'update', url: ELIM_PLAY_URL },
    });
    // Mark as sent only after the push went out, so a failed run retries next
    // day rather than silently swallowing the announcement.
    await ref.set({ updateV125Sent2: true, updateV125At: FieldValue.serverTimestamp() }, { merge: true });
  }
);

// One-time notice: after the live-site switch, everyone must sign in once. Sent
// once (guarded by a marker), reassuring and actionable — it points a member
// who forgot their PIN to a leader, who can now reset it in the admin tool.
// Runs daily at 09:00 church time; the first run sends it, then it stops.
exports.announceReloginNotice = onSchedule(
  { schedule: '0 9 * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const ref = db.collection('config').doc('broadcasts');
    const snap = await ref.get();
    if (snap.exists && snap.data().reloginNoticeSent) return; // already sent once
    await broadcastPush(db, {
      title: '🔐 Reconnexion requise une seule fois',
      body: "Après la récente mise à jour, veuillez vous reconnecter une seule fois avec votre numéro de téléphone et votre code PIN. Ensuite, tout fonctionne comme avant. Code PIN oublié ? Un responsable peut le réinitialiser pour vous. 🙏",
      data: { kind: 'info' },
    });
    await ref.set({ reloginNoticeSent: true, reloginNoticeAt: FieldValue.serverTimestamp() }, { merge: true });
  }
);

// ==================== ADMIN BROADCASTS ====================

// Only admins/pastors may broadcast to the whole congregation.
async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const snap = await db.collection('users').doc(request.auth.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'pastor'].includes(role)) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }
  return request.auth.uid;
}

function cleanBroadcast(data) {
  const title = String((data && data.title) || '').trim().slice(0, 120);
  const body = String((data && data.body) || '').trim().slice(0, 500);
  let url = data && data.url ? String(data.url).trim().slice(0, 500) : null;
  // Only http(s) links. Rejecting javascript:/data:/etc. is critical: this url
  // becomes the href of a bell entry shown to every member, so an unsafe scheme
  // would be stored XSS in each member's authenticated session.
  if (url && !/^https?:\/\//i.test(url)) url = null;
  // A safe in-app route hint the bell + tap handlers understand; falls back to
  // plain info. These MUST match the kinds handled in notifications.ts / the
  // service worker / the bell tap handler.
  const allowedRoutes = ['info', 'quiz', 'feed', 'update', 'message'];
  const route = data && allowedRoutes.includes(data.route) ? data.route : 'info';
  if (!title || !body) throw new HttpsError('invalid-argument', 'Titre et message requis.');
  return { title, body, url, route };
}

// Send a broadcast to everyone right now (push + in-app bell entry).
exports.sendBroadcast = onCall({ region: 'us-central1' }, async (request) => {
  await requireAdmin(request);
  const db = getFirestore();
  const { title, body, url, route } = cleanBroadcast(request.data);
  await broadcastPush(db, { title, body, data: { kind: route, ...(url ? { url } : {}) } });
  return { ok: true };
});

// Every 5 minutes, send any admin-scheduled broadcasts that have come due.
exports.dispatchScheduledBroadcasts = onSchedule(
  { schedule: '*/5 * * * *', region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const due = await db.collection('scheduledBroadcasts')
      .where('sent', '==', false)
      .where('sendAt', '<=', now)
      .limit(20)
      .get();
    for (const d of due.docs) {
      // Sanitize the same way sendBroadcast does (length bounds, route
      // allowlist, http(s)-only url) - the doc was written straight to
      // Firestore by the client, so it never passed through cleanBroadcast.
      let clean;
      try {
        clean = cleanBroadcast(d.data());
      } catch (e) {
        // Malformed (e.g. missing title/body): don't retry it every 5 minutes.
        console.error('invalid scheduled broadcast', d.id, e);
        await d.ref.update({ sent: true, sentAt: FieldValue.serverTimestamp(), error: 'invalid' }).catch(() => {});
        continue;
      }
      // Claim it BEFORE sending (mark sent), so a failure of the post-send
      // bookkeeping can't leave it to re-send next tick. If the send itself
      // throws, un-claim it so it retries. The announcement doc is keyed on this
      // scheduled id, so even a rare double-run overwrites one bell entry rather
      // than adding a duplicate.
      try {
        await d.ref.update({ sent: true, sentAt: FieldValue.serverTimestamp() });
      } catch (e) {
        console.error('scheduled broadcast claim failed', d.id, e);
        continue; // couldn't claim - try again next tick
      }
      try {
        await broadcastPush(db, {
          title: clean.title,
          body: clean.body,
          data: { kind: clean.route, ...(clean.url ? { url: clean.url } : {}) },
        }, { announcementId: `sched_${d.id}` });
      } catch (e) {
        // Send failed after claiming: release the claim so it retries.
        console.error('scheduled broadcast send failed', d.id, e);
        await d.ref.update({ sent: false, sentAt: FieldValue.delete() }).catch(() => {});
      }
    }
  }
);

// Keep the bell tidy: drop personal notifications and broadcast announcements
// older than 30 days. Also clears already-sent scheduled broadcasts.
exports.cleanupOldNotifications = onSchedule(
  { schedule: '30 3 * * *', region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const col of ['notifications', 'announcements', 'scheduledBroadcasts', 'transcribeJobs']) {
      const field = col === 'scheduledBroadcasts' ? 'sentAt' : 'createdAt';
      // Page through in batches so a large backlog can't blow the 500-write cap.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const snap = await db.collection(col).where(field, '<', cutoff).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < 400) break;
      }
    }
  }
);

// Evening encouragement: gently celebrate the member who studied the most
// today, to encourage everyone to keep learning the Bible - not a competitive
// scoreboard. Fires at 20:00 church time. Skips quietly if nobody played.
// (No raw points in the message: the daily figure is a subset of the weekly
// total shown in the ranking, so surfacing it only confused people.)
exports.dailyTopScore = onSchedule(
  { schedule: '0 20 * * *', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const dayId = churchDayKey();
    const snap = await db.collection('quizProfiles')
      .where('dayId', '==', dayId)
      .orderBy('dayPoints', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return;
    const top = snap.docs[0].data();
    const pts = top.dayPoints || 0;
    if (pts <= 0) return;
    const name = (top.displayName || 'Un membre').toString().slice(0, 40);
    const cfg = await loadAutoConfig(db);
    const m = resolveAuto(cfg, 'topScore', {
      title: '📖 On apprend la Bible ensemble',
      body: "Aujourd'hui, {name} a pris le temps d'étudier la Parole avec E.L.I.M Quiz Biblique. Et toi, quel verset vas-tu découvrir ce soir ? 📖🙏",
    }, { name });
    if (!m) return;
    await broadcastPush(db, { title: m.title, body: m.body, data: { kind: 'quiz' } });
  }
);

// ==================== BIBLE QUIZ WEEKLY CHAMPIONS ====================

const QUIZ_ADULT_CATEGORIES = ['ot', 'nt', 'parables', 'people', 'verses', 'miracles', 'geography', 'business', 'morality'];

// ISO week id (Mon-Sun), computed in church time (UTC+0). Matches the client.
function isoWeekKey(now) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Kids week id (Sunday-based), church time. Matches the client's kidsWeekKey.
function kidsWeekKeyUTC(now) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.floor((day.getTime() - yearStart.getTime()) / (7 * 86400000)) + 1;
  return `${day.getUTCFullYear()}-K${String(week).padStart(2, '0')}`;
}

function frDate(d) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: CHURCH_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

async function topOfLeague(db, weekId, league) {
  const snap = await db.collection('quizWeekly')
    .where('weekId', '==', weekId).where('league', '==', league)
    .orderBy('points', 'desc').limit(1).get();
  if (snap.empty) return null;
  const v = snap.docs[0].data();
  if (!(v.points > 0)) return null;
  return { uid: v.uid, name: (v.name || 'Un membre').toString().slice(0, 60), points: v.points };
}

// Top N of a league for a week (e.g. the grand-league podium), highest first.
async function podiumOfLeague(db, weekId, league, n = 3) {
  const snap = await db.collection('quizWeekly')
    .where('weekId', '==', weekId).where('league', '==', league)
    .orderBy('points', 'desc').limit(n).get();
  return snap.docs
    .map((d) => d.data())
    .filter((v) => v.points > 0)
    .map((v) => ({ uid: v.uid, name: (v.name || 'Un membre').toString().slice(0, 60), points: v.points }));
}

// French labels + emojis for the adult categories, for the weekly champion
// message. Kept in sync with CATEGORY_META / quiz.cat.* on the client.
const QUIZ_CAT_LABELS_FR = {
  ot: '📜 Ancien Testament',
  nt: '✝️ Nouveau Testament',
  parables: '🌱 Paraboles de Jésus',
  people: '👑 Personnages bibliques',
  verses: '📖 Versets à compléter',
  miracles: '✨ Miracles',
  geography: '🗺️ Géographie biblique',
  business: '💼 Principes des affaires',
  morality: '⚖️ Moralité',
};
const PODIUM_MEDALS = ['🥇', '🥈', '🥉'];

// Monday 08:00 church time: snapshot last week's category + grand champions
// into the Palmarès, bump the grand champion's crown, and announce it.
exports.weeklyCategoryChampions = onSchedule(
  { schedule: '0 8 * * 1', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const weekId = isoWeekKey(yesterday);
    const champRef = db.collection('quizChampions').doc(weekId);
    if ((await champRef.get()).exists) return; // already recorded

    // Grand champion comes from the IMMUTABLE per-week grand docs (quizWeekly),
    // same as the category winners. Reading quizProfiles.weekPoints would be
    // wrong: a profile's week fields are reset the moment that player starts a
    // new-week game (e.g. Monday morning before 08:00), so the true champion
    // could be excluded and a lower-ranked player crowned instead.
    const grand = await topOfLeague(db, weekId, 'grand');
    if (!grand) return; // nobody played

    const categories = {};
    for (const cat of QUIZ_ADULT_CATEGORIES) {
      const w = await topOfLeague(db, weekId, cat);
      if (w) categories[cat] = w;
    }

    // Record the champion and award the crown ATOMICALLY: a re-check of the
    // existence guard, the Palmarès write, and weeksWon++ all commit together,
    // so overlapping runs can't double-crown and a crash can't record the week
    // without awarding the crown.
    let created = false;
    await db.runTransaction(async (tx) => {
      if ((await tx.get(champRef)).exists) return;
      tx.set(champRef, {
        kind: 'adult', weekId, weekLabel: `Semaine du ${frDate(yesterday)}`,
        endedAt: FieldValue.serverTimestamp(), grand, categories,
      });
      tx.set(db.collection('quizProfiles').doc(grand.uid),
        { weeksWon: FieldValue.increment(1) }, { merge: true });
      created = true;
    });
    if (!created) return; // another run already recorded this week; don't re-announce

    const catCount = Object.keys(categories).length;

    // Build the message content: the overall top-3 podium and EVERY category
    // champion by name. The podium is the grand league's top 3; categories lists
    // only those that had a winner this week, in a fixed order.
    const podium = await podiumOfLeague(db, weekId, 'grand', 3);
    const top3 = podium.map((p, i) => `${PODIUM_MEDALS[i] || '•'} ${p.name}`).join(' · ');
    const categoriesList = Object.keys(QUIZ_CAT_LABELS_FR)
      .filter((cat) => categories[cat])
      .map((cat) => `${QUIZ_CAT_LABELS_FR[cat]} : ${categories[cat].name}`)
      .join('\n');

    const cfg = await loadAutoConfig(db);
    const m = resolveAuto(cfg, 'weeklyChampions', {
      title: '🏆 Champions de la semaine',
      body: "Top 3 : {top3}\n\nChampions par catégorie :\n{categories}\n\nBravo à tous pour ce que vous avez appris dans la Parole cette semaine ! Une nouvelle semaine pour grandir commence. 📖",
    }, { name: grand.name, count: catCount, top3, categories: categoriesList }, 1200);
    // Recording/crowning already happened above; only the announcement is
    // editable/skippable.
    if (m) await broadcastPush(db, { title: m.title, body: m.body, data: { kind: 'quiz' } });
  }
);

// Sunday 08:00 church time: crown the kids champion of the week that just
// ended (Saturday night) and announce the FULL name for the Sunday-school
// prize.
exports.kidsWeeklyChampion = onSchedule(
  { schedule: '0 8 * * 0', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000); // Saturday
    const kidsWeekId = kidsWeekKeyUTC(yesterday);
    const champRef = db.collection('quizChampions').doc(`kids-${kidsWeekId}`);
    if ((await champRef.get()).exists) return;

    const snap = await db.collection('quizKids')
      .where('kidsWeekId', '==', kidsWeekId)
      .orderBy('points', 'desc').limit(1).get();
    if (snap.empty) return;
    const v = snap.docs[0].data();
    if (!(v.points > 0)) return;
    const childName = (v.childName || 'Un enfant').toString().slice(0, 60);
    const parentName = (v.parentName || '').toString().slice(0, 60);

    await champRef.set({
      kind: 'kids', kidsWeekId, weekLabel: `Semaine du ${frDate(yesterday)}`,
      endedAt: FieldValue.serverTimestamp(),
      winner: { uid: v.uid, childName, parentName, points: v.points },
    });

    const cfg = await loadAutoConfig(db);
    const m = resolveAuto(cfg, 'kidsChampion', {
      title: '🎉 Champion du Quiz Enfants',
      body: "Bravo {name} ! Champion des enfants cette semaine. Récompense aujourd'hui à l'école du dimanche. 👏",
    }, { name: childName });
    // The winner is already recorded above; only the announcement is editable.
    if (m) await broadcastPush(db, { title: m.title, body: m.body, data: { kind: 'quiz' } });
  }
);

// Weekly quiz difficulty CALIBRATION. Turns the congregation's own answers
// (quizStats: attempts + correct per question, written by the client) into a
// MEASURED difficulty per question — a 1-parameter logit where higher = harder
// — so mislabelled questions surface and future selection can target difficulty
// precisely instead of trusting the authored easy/medium/hard tier. Only
// questions with enough data are calibrated. Runs Sunday 03:00 church time.
exports.calibrateQuiz = onSchedule(
  { schedule: '0 3 * * 0', timeZone: CHURCH_TZ, region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const MIN_ATTEMPTS = 20; // below this a rate is too noisy to trust
    const snap = await db.collection('quizStats').get();
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      const v = d.data() || {};
      const attempts = v.attempts || 0;
      const correct = v.correct || 0;
      if (attempts < MIN_ATTEMPTS) continue;
      const rate = Math.min(0.99, Math.max(0.01, correct / attempts));
      const b = -Math.log(rate / (1 - rate)); // logit difficulty; higher = harder
      batch.set(d.ref, {
        b: Number(b.toFixed(3)),
        rate: Number(rate.toFixed(3)),
        n: attempts,
        calibratedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (n % 400 !== 0) await batch.commit();
    console.log(`calibrateQuiz: calibrated ${n} questions`);
  }
);

// Admin-driven password / PIN reset. Members here aren't comfortable with
// self-service resets, so an admin or pastor sets a new sign-in code for anyone
// and reads it out to them. Only the Admin SDK can set another user's password
// (a client never can), so this runs server-side and is gated to staff. For a
// member the auth password IS their PIN, so the same call resets either.
exports.adminSetPassword = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const me = await db.collection('users').doc(request.auth.uid).get();
  const role = me.exists ? me.data().role : null;
  if (!['admin', 'pastor'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only an admin or pastor can reset a code.');
  }
  const uid = String(request.data?.uid || '').trim();
  const password = String(request.data?.password || '');
  if (!uid) throw new HttpsError('invalid-argument', 'No user selected.');
  if (password.length < 4 || password.length > 64) {
    throw new HttpsError('invalid-argument', 'The code must be 4 to 64 characters.');
  }
  const target = await db.collection('users').doc(uid).get();
  if (!target.exists) throw new HttpsError('not-found', 'That user no longer exists.');
  const { getAuth } = require('firebase-admin/auth');
  await getAuth().updateUser(uid, { password });
  console.log(`adminSetPassword: ${request.auth.uid} reset the code for ${uid}`);
  return { ok: true, name: target.data().displayName || '' };
});
