const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { Translate } = require('@google-cloud/translate').v2;
const crypto = require('crypto');

initializeApp();

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

  // Reply -> the parent comment's author.
  if (comment.parentId) {
    const parentSnap = await db.collection('comments').doc(comment.parentId).get();
    if (parentSnap.exists) {
      const parentAuthor = parentSnap.data().userId;
      if (parentAuthor && !notified.has(parentAuthor)) {
        notified.add(parentAuthor);
        await addNotification(db, {
          recipientId: parentAuthor, type: 'comment_reply',
          actorId: comment.userId, actorName: actor.name, actorAvatar: actor.avatar,
          postId: comment.postId, commentId, preview: (comment.text || '').slice(0, 80)
        });
      }
    }
  }

  // Comment on a post -> the post's author.
  const postSnap = await db.collection('posts').doc(comment.postId).get();
  if (postSnap.exists) {
    const postAuthor = postSnap.data().churchId;
    if (postAuthor && !notified.has(postAuthor)) {
      notified.add(postAuthor);
      await addNotification(db, {
        recipientId: postAuthor, type: 'post_comment',
        actorId: comment.userId, actorName: actor.name, actorAvatar: actor.avatar,
        postId: comment.postId, commentId, preview: (comment.text || '').slice(0, 80)
      });
    }
  }
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
  if (!donation || !donation.donorId) return;
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

  const convId = `pastor_${donation.donorId}`;
  const convRef = db.collection('conversations').doc(convId);
  const convSnap = await convRef.get();

  const SENDER_ID = 'church-elim';
  const SENDER_NAME = 'Centre Chrétien E.L.I.M.';

  // Upsert the conversation the same way the client does (it may not exist if
  // the donor never opened the pastor channel). participantIds stays just the
  // member - staff access to pastor channels is by role, not membership.
  const convPayload = {
    type: 'pastor',
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
    senderRole: 'pastor',
    text,
    participantIds: [donation.donorId],
    createdAt: FieldValue.serverTimestamp(),
  });
});

// Translates a single piece of user content into the reader's language, on
// demand from the "Translate" button. Callable (not an HTTP endpoint) so the
// Firebase Auth token rides along automatically - only signed-in members can
// use it, which keeps it from being an open, abusable translation proxy.
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
  try {
    const [translation, meta] = await translateClient.translate(text, target);
    const detected = meta && meta.data && meta.data.translations
      && meta.data.translations[0]
      ? meta.data.translations[0].detectedSourceLanguage
      : null;
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

// Creates a Square-hosted checkout for a fixed amount and returns its URL.
// The donor's uid rides along in payment_note so the webhook can match the
// payment back to the person.
exports.createSquareCheckout = onCall(
  { region: 'us-central1', secrets: [SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to give.');
    const uid = request.auth.uid;
    const amount = Math.round(Number(request.data && request.data.amountCents));
    const type = String((request.data && request.data.type) || 'autre');
    const purpose = String((request.data && request.data.purpose) || '').slice(0, 120);
    if (!Number.isFinite(amount) || amount < 100) {
      throw new HttpsError('invalid-argument', 'Enter a valid amount.');
    }

    const accessToken = SQUARE_ACCESS_TOKEN.value();
    const locationId = SQUARE_LOCATION_ID.value();

    // A quick_pay price must be in the location's own currency, or Square
    // rejects the link. The seller could be in the US (USD), Canada (CAD), etc.,
    // so ask Square what this location uses instead of guessing.
    let currency = 'USD';
    try {
      const locRes = await fetch(`${SQUARE_API}/locations/${locationId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Square-Version': SQUARE_VERSION,
        },
      });
      const locJson = await locRes.json();
      if (locRes.ok && locJson.location && locJson.location.currency) {
        currency = String(locJson.location.currency).toUpperCase();
      } else {
        console.error('Square location lookup returned no currency', locRes.status, JSON.stringify(locJson));
      }
    } catch (err) {
      console.error('Square location lookup failed; defaulting to USD', err);
    }

    const body = {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: purpose ? `Don — ${purpose}` : 'Don — Centre Chrétien E.L.I.M',
        price_money: { amount, currency },
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
      const res = await fetch(`${SQUARE_API}/online-checkout/payment-links`, {
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
      url: json.payment_link && json.payment_link.url,
      orderId: (json.payment_link && json.payment_link.order_id) || null,
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
      // Idempotency: a payment.updated can arrive more than once.
      const dup = await db.collection('donations')
        .where('squarePaymentId', '==', payment.id).limit(1).get();
      if (!dup.empty) return res.status(200).send('duplicate');

      const m = /^elim:([^:]+):?(.*)$/.exec(payment.note || '');
      const donorId = m ? m[1] : 'unknown';
      const donType = m && ['dime', 'offrande', 'autre'].includes(m[2]) ? m[2] : 'autre';
      const cents = (payment.amount_money && payment.amount_money.amount) || 0;
      const currency = (payment.amount_money && payment.amount_money.currency) || 'USD';

      let donorName = '';
      if (donorId !== 'unknown') {
        try {
          const u = await db.collection('users').doc(donorId).get();
          donorName = u.exists ? (u.data().displayName || '') : '';
        } catch (_e) { /* name is best-effort */ }
      }

      await db.collection('donations').add({
        donorId,
        donorName,
        type: donType,
        amount: `${(cents / 100).toFixed(2)} ${currency}`,
        amountCents: cents,
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

      return res.status(200).send('ok');
    } catch (err) {
      // Return 200 so Square doesn't retry-storm on our own bug; it's logged.
      console.error('squareWebhook error', err);
      return res.status(200).send('error-logged');
    }
  },
);
