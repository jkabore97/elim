# ELIM App — Deep Audit Report

**Date:** 2026-08-16 · **Commit audited:** `23bdd44` · **Branch:** `claude/app-audit-c46qgd`

**Scope:** full source (`src/`, ~7,800 lines), Firestore/Storage security rules, Cloud Functions, service worker, Android and iOS platform projects, CI workflow, build tooling, and dependencies. Every finding below was verified against the actual code at the cited location.

---

## Executive summary

The app builds clean (`tsc` passes, oxlint shows only 3 trivial warnings, production build succeeds in ~1.4 s) and several security-sensitive areas are genuinely well done — self-role escalation is blocked in rules, storage writes are owner-scoped and size-validated, CI keystore handling is correct, and no secrets of any kind are committed or present in git history.

However, the audit found **4 High-severity security/privacy issues**, **10 High-severity correctness issues**, and a long tail of Medium/Low findings. The most urgent themes:

1. **Privacy:** any signed-in member can download the entire congregation directory (names, phones, emails, birth dates); FCM push tokens are never removed on logout, so on a shared phone one user receives another user's private-message notifications.
2. **Messaging integrity:** messages can be injected into private conversations the sender is not part of; threads hit a hard failure at 500 messages (delete breaks, display becomes an arbitrary subset).
3. **Resilience:** an offline app launch permanently bricks the UI on the loading spinner; several user actions (posts, comments, deletes) silently discard content on failure.
4. **iOS is not shippable:** push notifications cannot work (no Firebase plist, no entitlement, no AppDelegate hooks) and recording a voice message will crash the app (missing `NSMicrophoneUsageDescription`).
5. **Scale:** every client subscribes to *every post and every comment in the database* with no `limit()` — costs and startup payload grow forever.

---

## Verified current state

| Check | Result |
|---|---|
| `tsc -b` | ✅ clean |
| `oxlint` | ⚠️ 3 minor warnings (unused vars, useless escape) |
| `vite build` | ✅ succeeds — but single 1.25 MB JS chunk (368 KB gzip) + 1.05 MB PDF worker |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| `npm audit` (with dev) | ⚠️ 10 vulns (1 critical `tar`, via `@capacitor/assets`) — build-time only |
| Secrets in repo/history | ✅ none (keystore via CI secrets; VAPID private key absent; only public Firebase config) |

---

## 1. Security (rules, storage, functions)

### SEC-1 · HIGH — Entire user directory readable by any authenticated user
`firestore.rules:30` — `match /users/{userId} { allow read: if isSignedIn(); }`

User docs contain `email`, `phone`, `dateOfBirth`, `gender`, `profession`, names, city/quartier, and `fcmTokens` (`src/types.ts`). Any member — the lowest-trust account type, authenticated with phone + 6-digit PIN — can run `getDocs(collection(db,'users'))` from a browser console and exfiltrate the full congregation's PII. SECURITY.md itself says this collection "shouldn't" be broadly exposed.

**Fix:** `allow read: if isAdmin() || request.auth.uid == userId;`. Posts/comments already denormalize `authorName`/avatar, so the feed doesn't need user-doc reads. If a member directory is needed, expose a slim projection collection (display name + avatar only).

### SEC-2 · HIGH — Message injection into arbitrary private conversations
`firestore.rules:113-118` — message `create` checks only `senderId == auth.uid` and `auth.uid in request.resource.data.participantIds`. `participantIds` is **client-supplied** and never validated against the parent conversation.

An attacker crafts a message with `conversationId` of a private pastoral thread they are not in and `participantIds: [attackerUid, victimUid]` — the check passes, and the forged message appears inside the victim's private thread (and the attacker can plant themselves into `participantIds` to read replies). Related: `senderRole` is also client-supplied (`src/Messages.tsx:336`) and drives the "Pasteur" badge — any member can send messages badged as pastor.

**Fix:** on create, `get()` the parent conversation and require `request.resource.data.participantIds == parent.participantIds` (one extra read per send is the right price). Pin `senderRole` to the caller's actual role via the rules' `role()` helper.

### SEC-3 · MEDIUM — Staff can grant admin/pastor roles in-app, contradicting SECURITY.md
`firestore.rules:50-52` — the final `isAdmin()` clause on `users` update allows any `admin` **or `pastor`** to write *any* field of *any* user doc, including `role`. The client path exists: `src/DataManagement.tsx:18` lists `role` as editable and line 169 writes it. SECURITY.md claims admin is granted "only via direct console action."

**Fix:** add `&& request.resource.data.role == resource.data.role` to that clause (the narrow pending-church approval clause at lines 45-48 already handles legitimate role changes correctly).

### SEC-4 · MEDIUM — Post like/comment counters writable to arbitrary values
`firestore.rules:187-191` — any signed-in user may update a post if the write only touches `likes`/`commentsCount`; the *values* are unconstrained. `updateDoc(post, { likes: 999999 })` works on any post.

**Fix:** require ±1 deltas in rules, or maintain counters from a Cloud Function on like/comment create/delete.

### SEC-5 · MEDIUM — Audit log is forgeable and unbounded
`firestore.rules:152-159` + `src/activityLog.ts` — `activityLogs` create only checks `userId == auth.uid`; `userName`, `userRole`, `action`, `detail` are client-supplied. A member can write entries with `userRole: 'admin'` and any spoofed name/action, or flood the collection (the 200-char `detail` cap is client-side only). SECURITY.md positions this log as safeguarding evidence.

**Fix:** in rules, pin `userRole` to `role()`, whitelist `action`, cap `detail.size() <= 200`, require `createdAt == request.time`; for real integrity write logs from a Cloud Function.

### SEC-6 · LOW — All Storage buckets are world-readable, forever
`storage.rules:19,31,45,55` — `allow read: if true` on profile pictures, post media, **message attachments** (incl. private voice notes), and books. Firebase download URLs are long-lived bearer links: once leaked, a private voice note is public with no revocation.

**Fix:** at minimum `allow read: if isSignedIn()` for `message-media` and profile pictures; truly private attachments should go through short-lived signed URLs.

### SEC-7 · LOW — Storage CORS opened to `*`
`cors.json` — widened to fix native-app PDFs. Given SEC-6 the incremental exposure is hotlinking/cross-site fetching. **Fix:** allowlist `https://ccelim.com`, `capacitor://localhost`, `https://localhost`, `http://localhost` instead of `*`.

### SEC-8 · INFO — Accepted-risk items to keep on record
- 6-digit PIN auth with enumerable synthetic emails (`{cc}{digits}@elim-member.app`) — documented tradeoff; Firebase throttling is the only brute-force barrier. Enable **App Check** (already on the SECURITY.md roadmap) — it also raises the cost of the direct-SDK abuse behind SEC-2/4/5.
- Firebase web/Android API keys in source and committed `android/app/google-services.json` — public by design, but add HTTP-referrer / package+SHA-1 restrictions in Google Cloud Console. The `android/.gitignore` entry for it is commented out (line 65).
- Cloud Functions are Firestore-triggered only (no callable/HTTP surface), correctly chunk FCM multicast at 500, and clean dead tokens. `cleanup-old-accounts.cjs` is dry-run-by-default with a `--confirm` gate. Good.

---

## 2. Correctness & data integrity

### COR-1 · HIGH — Offline launch bricks the app on the spinner
`src/App.tsx:1126-1138` — the `onAuthStateChanged` callback does `await getDoc(...)` with no try/catch; on rejection (offline start, expired token) `setAuthLoading(false)` never runs and the app renders the loading spinner **forever**.
**Fix:** try/catch with `setAuthLoading(false)` in `finally`; fall back to `setUser(null)` on error.

### COR-2 · HIGH — Posts, comments, and deletes are fire-and-forget; failures silently destroy content
- `src/App.tsx:2861-2872` — CreatePostModal calls `onSubmit(...)` unawaited then closes; a failed write loses the entire typed post with no error.
- `src/App.tsx:3049-3050` — comment input is cleared before the write resolves; failure drops the comment.
- `src/App.tsx:2509` — post delete unawaited/uncaught; failure looks like success.

**Fix:** await the writes, keep the modal/input populated until success, surface errors — `ChatView.handleSend` (`src/Messages.tsx:345-355`) is the in-codebase pattern to copy.

### COR-3 · HIGH — Microphone keeps recording after leaving the chat
`src/Messages.tsx:375-421` — `startRecording` starts `getUserMedia` + `MediaRecorder` + a 1 s interval; there is **no unmount cleanup**. Tap mic, then switch tabs: the interval leaks, and the mic stays live (OS mic indicator on) with no way to stop it short of killing the app.
**Fix:** `useEffect(() => () => { clearInterval(timerRef.current); if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop() }, [])`.

### COR-4 · HIGH — Thread deletion breaks at exactly 500 messages and orphans the rest
`src/Messages.tsx:447-457` — `getDocs(limit(500))` + one batch: at 500 messages the batch holds **501 ops** (over Firestore's hard limit) and `commit()` throws; above 500, the remainder is silently orphaned and resurrects when the deterministic `pastor_{uid}` thread is recreated.
**Fix:** loop `limit(400)` → batch delete → repeat until empty, then delete the conversation doc.

### COR-5 · HIGH — Message query has `limit(500)` but no `orderBy`
`src/Messages.tsx:263-277` — without `orderBy`, Firestore returns the 500 lexicographically-first doc IDs — effectively a random subset — so once a thread passes 500 messages, *recent messages silently vanish* while old ones remain.
**Fix:** `orderBy('createdAt','desc'), limit(500)` (accept the composite index) or `limitToLast`.

### COR-6 · HIGH — Admin Data explorer silently corrupts map fields on Save
`src/DataManagement.tsx:147-166` — `openRecord` serializes objects with `JSON.stringify`, but `save()` compares against `String(original)` (`"[object Object]"`), so any map field (e.g. `readBy`) is always "changed" and gets **overwritten with its JSON string** — opening a record and tapping Save without editing anything corrupts it.
**Fix:** use the identical serialization in both places; skip object fields from editing (like timestamps are) or `JSON.parse` before writing.

### COR-7 · HIGH — Library book delete is one un-confirmed tap and leaks the Storage file
`src/Library.tsx:316-319,396-400` — a single tap on a 16 px trash icon permanently deletes a book for everyone (no confirm, unlike DataManagement's two-step pattern), and only the Firestore doc is deleted — the up-to-100 MB PDF stays in Storage forever (`deleteObject` never called).
**Fix:** add the confirm pattern + `deleteObject(ref(storage, b.fileUrl))`.

### COR-8 · MEDIUM — Like handler double-tap corrupts the counter permanently
`src/App.tsx:1247-1264` — two quick taps both read `alreadyLiked=false` and both `increment(1)` while the like doc is idempotent → counter +2 forever (unlike mid-flight can drive it negative). **Fix:** `runTransaction` or disable the button while in flight. (Server-side: SEC-4.)

### COR-9 · MEDIUM — Auth race can show a signed-in UI after sign-out
`src/App.tsx:1126-1138` — a sign-out arriving while the profile `getDoc` is in flight lets the stale resolution call `setUser(profile)` after `setUser(null)`. **Fix:** verify `auth.currentUser?.uid === firebaseUser.uid` after the await (or use a call-sequence guard).

### COR-10 · MEDIUM — Core `onSnapshot` subscriptions have no error callback
`src/App.tsx:1144,1159,1169,1179` — a rules denial leaves the feed on "Chargement…" forever with zero diagnostics; `useUnreadCount` swallows errors (`Messages.tsx:93,103`), freezing the badge. **Fix:** add the error callback already used in `LogsPanel` (`App.tsx:2217-2223`).

### COR-11 · MEDIUM — Upload completion can strand the uploader
`src/App.tsx:2846-2852` — `getDownloadURL` rejection inside the `uploadBytesResumable` completion callback is unhandled: spinner forever, Publish disabled, bandwidth wasted. **Fix:** try/catch/finally with an error state.

### COR-12 · MEDIUM — Conversation preview written before the message
`src/Messages.tsx:330-343` — `upsertConversation` (lastMessage + unread badge) commits before `addDoc(message)`; if the message write fails, every participant sees a preview/badge for a message that doesn't exist. **Fix:** write the message first.

### COR-13 · MEDIUM — `javascript:` URLs accepted in post media links
`src/App.tsx:2949 → 2572,2587,2637` — the free-text `mediaUrl` lands in `<a href>` with no scheme validation (and the "facebook" check is merely `includes('facebook.com')`). A compromised church account gets a stored-XSS-style tappable link for every user. **Fix:** parse with `new URL()` and allow only `https:`; allowlist embed hosts.

### COR-14 · MEDIUM — Admin edit coercion writes `NaN` / mis-parses booleans
`src/DataManagement.tsx:164-165` — `Number("12x")` → `NaN` stored silently; `"True"`/`"yes"` → `false`. **Fix:** validate before writing; reject with a notice.

### COR-15 · MEDIUM — Data exports silently truncate
`src/DataManagement.tsx:326,363-380` — people export derives from a `limit(1000)` snapshot; past 1,000 members the "authoritative registry" export is silently incomplete (browse/search likewise capped at 500). **Fix:** page with `startAfter` until exhausted, or warn at the cap.

### COR-16 · MEDIUM — CSV export vulnerable to spreadsheet formula injection
`src/DataManagement.tsx:71-83` — user-controlled fields (profession, city, name) are exported unneutralized; `=HYPERLINK(...)`/DDE payloads execute when the admin opens the file in Excel (which the UI explicitly suggests). **Fix:** prefix cells starting with `= + - @ \t \r` with `'`.

### COR-17 · MEDIUM — `useMemo` in Library sorts React state in place
`src/Library.tsx:299-313` — with category "all" and empty search, `rows` *is* the `books` state array and `.sort()` mutates it. **Fix:** `[...rows].sort(...)`.

### COR-18 · MEDIUM — Church leads see an empty Admin tab
`src/App.tsx:1019-1021` — `adminSection` is initialized from `user?.role` while `user` is still `null`, so church users land on `'approvals'`, whose chip isn't rendered for them → blank panel until they tap "Données". **Fix:** derive the effective section from role at render time, or reset in an effect.

### COR-19 · MEDIUM — Web back button exits the app when nothing is open
`src/backButton.ts:74-82` — the sentinel is only re-pushed when an overlay was closed; with nothing open, back navigates out of the PWA — the exact behavior the comment above it claims to prevent. **Fix:** re-push the sentinel unconditionally.

### COR-20 · LOW — assorted (verified) smaller defects
- `src/App.tsx:271,290-296` — dead `churchDirectory` fetch (full-collection read, never rendered); duplicate mounted `AuthForm` instances.
- `src/App.tsx:281,637-641` — `resetSent` success banner is unreachable dead code.
- `src/App.tsx:1041,1074,1998,2464,2482` — untracked `setTimeout`s (2nd toast within 5 s killed early; setState-after-unmount).
- `src/App.tsx:1517-1520` — inline ref re-runs `scrollIntoView` on every render for 4 s, fighting user scroll.
- `src/Messages.tsx:79-80` — unread badge not reset on logout (previous account's count flashes for the next login).
- `src/Messages.tsx:699-704` — scroll-to-latest button positioned against the wrong (non-`relative`) container.
- `src/Messages.tsx:928-947` — staff re-opening a direct thread re-stamps `createdAt`/overwrites `ownerRole`.
- `src/Messages.tsx:285-299` — read receipts mark messages "seen" while the app is backgrounded (no visibility check).
- `src/Messages.tsx:147-177` — voice-note audio doesn't pause on unmount and can play over the global player.
- `src/App.tsx:1192-1196` — deleting a post orphans its likes and comments forever (they keep shipping to every client via the global comments subscription — see PERF-1).
- `src/App.tsx:185-202` — DOB `max` off by one day in UTC+ timezones (cosmetic).
- `src/Library.tsx:303-305` — a `books` doc missing `title`/`category` throws in `useMemo` → full-app crash screen. Guard with `?? ''`.
- `src/Library.tsx:74-79,138` — restored reading page never clamped to the new PDF's `numPages`.
- `src/Library.tsx:223` — book upload logged as `post_created` ("Published a post") — misleading audit trail.
- `src/DataManagement.tsx:85-95` — download anchor never attached to the DOM (some WebViews reject detached-anchor clicks).

---

## 3. Notifications & push

### PUSH-1 · HIGH — FCM tokens never removed on logout/disable: cross-account notification leakage
`src/notifications.ts:148-150`, `src/App.tsx:1187-1190` — logout is bare `signOut()`; `disableNotifications` only flips the flag. No `arrayRemove`/`deleteToken` anywhere in `src/`. On a shared family phone (a realistic scenario for this congregation), user B receives user A's **private-message previews** (functions send sender name + text) because the device token stays valid in A's `fcmTokens`.
**Fix:** on logout and on disable, `arrayRemove` the current device token and (web) call `deleteToken(messaging)`.

### PUSH-2 · HIGH — `pendingTokenUid` grows forever; token refresh writes to every account seen this session
`src/notifications.ts:14,40,108-110` — uids are added on every `enableNotifications` (which runs on **every app-foregrounding** via `reconcileNotificationState`) and never removed. On the next `registration` event, the token is saved to *all* accumulated uids — compounding PUSH-1.
**Fix:** `pendingTokenUid.delete(uid)` after save; clear the set on logout.

### PUSH-3 · MEDIUM — Foreground web notifications crash on Android Chrome
`src/notifications.ts:197-204` — `new Notification(...)` is an illegal constructor on Android Chrome (must use `ServiceWorkerRegistration.showNotification`); the callback isn't inside the try. Every foreground push throws and shows nothing. Also carries no click routing.
**Fix:** `(await navigator.serviceWorker.getRegistration())?.showNotification(title, { body, icon, data })` in its own try/catch.

### PUSH-4 · MEDIUM — Service worker's `notificationclick` handler is dead code
`public/firebase-messaging-sw.js:16,37-55` — `firebase.messaging()` registers the compat SDK's own click handler first, which calls `stopImmediatePropagation()`, so the hand-written "focus existing tab" handler never runs for FCM notifications; the SDK's exact-URL matching opens a new tab per click.
**Fix:** verify against the SDK version and either remove the dead handler or restructure so routing is owned in one place. Also: the SW pins Firebase SDK **10.14.1** while the app uses **11.x** — align them.

### PUSH-5 · MEDIUM — Tapping a foreground native notification does nothing
`src/notifications.ts:126-142` — the substitute `LocalNotifications.schedule` call copies no `extra` data, and no `localNotificationActionPerformed` listener exists — only the push-notification one, which doesn't fire for local notifications. **Fix:** pass `extra: notification.data` and add the local-notification action listener.

### PUSH-6 · MEDIUM — Global/native listeners registered without cleanup (double-fire under StrictMode)
`src/App.tsx:1052-1083` + `backButton.ts` / `notifications.ts` — `initBackButton`, `initNativeNotifications`, `listenForForegroundMessages` are not idempotent and return no unsubscribe; under dev StrictMode everything registers twice (two local notifications per push, two back-pops per press), masking/faking the exact bug class commit `23bdd44` fixed. **Fix:** module-level init guards or returned cleanups.

### PUSH-7 · MEDIUM — Stale `notificationsEnabled` in the visibility handler
`src/App.tsx:1113-1123` — effect deps are `[user?.uid]`, so after toggling notifications off, the next foregrounding passes the stale `true` to `reconcileNotificationState`, silently re-enabling and re-registering the token. Also pure write amplification: a Firestore write on every foregrounding. **Fix:** keep the flag in a ref (or add it to deps) and short-circuit when the token is already saved.

*(Verified good: the `23bdd44` duplicate-notification fix is complete for the web background path; functions chunk multicast at 500 and clean dead tokens.)*

---

## 4. Performance & scale

### PERF-1 · HIGH — Unbounded live subscriptions: every post and every comment, for every user
- `src/App.tsx:1141-1149` — all posts, no `limit()` (including the hidden Musique bulk imports).
- `src/App.tsx:1166-1173` — **all comments on all posts**, app-lifetime, filtered client-side per post.
- `src/Messages.tsx:780-787` — New Message picker does `getDocs(collection(db,'users'))` — the whole congregation per open.

Read costs and startup payload grow linearly forever; on low-end Android in a low-bandwidth market this is app-breaking before the bill is. **Fix:** paginate posts (`limit` + `startAfter`); subscribe to comments per-post inside `CommentsSheet` (`where('postId','==',…)`); slim directory collection for the picker (which also depends on SEC-1's fix).

### PERF-2 · MEDIUM — Single 1.25 MB JS chunk, no code splitting
`vite.config.ts` has no chunking config; `firebase`, `react-pdf` (pdf.js), `lucide-react`, router and the 3,072-line `App.tsx` land in one bundle → slow first paint and slow WebView boot. **Fix:** `manualChunks` + lazy-`import()` for `react-pdf`/Library.

### PERF-3 · MEDIUM — No offline/precache service worker despite `display: standalone`
The only SW is the FCM one; the installed PWA has zero offline capability. **Fix:** `vite-plugin-pwa` in `injectManifest` mode so FCM logic and precaching share one SW (two SWs on one scope fight over registration).

### PERF-4 · LOW — Google Fonts from CDN
`index.html:15-17` — render-blocking third-party request; silently fails offline in the Capacitor shells; EU-relevant third-party call. **Fix:** self-host via `@fontsource/inter`.

*(Verified good: the audio-tick re-render fix in `ed9dbee` works — the context value is memoized and children are stable; the tree doesn't re-render on ticks. No hooks-after-early-return violations remain from the `5a647f7` fix.)*

---

## 5. Mobile platforms

### IOS-1 · HIGH — Push notifications cannot work on iOS
`ios/App/App/` has **no `GoogleService-Info.plist`**, no `.entitlements` (no `aps-environment`), and the stock `AppDelegate.swift` lacks the APNs token-forwarding methods `@capacitor/push-notifications` requires. A core feature is entirely absent on iOS. **Fix:** add the Firebase iOS app plist, enable the Push capability, add the two delegate methods.

### IOS-2 · HIGH — Voice recording crashes the iOS app
`Info.plist` has no `NSMicrophoneUsageDescription`, but `src/Messages.tsx:378` calls `getUserMedia({audio:true})` — iOS **terminates the app instantly** on first mic access, and App Store review will reject. **Fix:** add the usage description.

### IOS-3 · MEDIUM — No background audio on iOS
No `UIBackgroundModes: audio` in `Info.plist`, while Android provisions full background playback — sermons stop when the app is backgrounded. **Fix:** add the background mode.

### AND-1 · LOW — `android:allowBackup="true"` (WebView localStorage incl. auth tokens in backups); `minifyEnabled false` in release (no R8); version identity drift (Android 2.4/60 vs iOS 1.0/1 vs package.json 1.0.0).

*(Verified good: Android permissions are all justified and commented; only `MainActivity` is exported; targetSdk 36; signing purely via env vars; no ATS exceptions on iOS.)*

---

## 6. Build, CI, dependencies

| ID | Sev | Finding | Fix |
|---|---|---|---|
| CI-1 | MEDIUM | Only workflow is the Android build on push-to-main; **no PR gate** — lint is never run in CI, no tests exist anywhere in the repo | Add a PR workflow: `npm ci`, `oxlint`, `tsc -b`, `vite build`; adopt a test framework (vitest) |
| CI-2 | LOW | CI uses `npm install`, not `npm ci` | `npm ci` + `cache: npm` |
| DEP-1 | HIGH* | Dev-dep chain has 10 vulns incl. critical `tar` path-traversal via `@capacitor/assets` (build-time only, but runs on every CI push) | `npm audit fix`; bump/remove `@capacitor/assets` |
| DEP-2 | MEDIUM | `functions/` has **no lockfile** (non-reproducible deploys) + 8 moderate transitive vulns under `firebase-admin@12`; engines mismatch warning on Node 24 | Commit `package-lock.json`; upgrade `firebase-admin@^13` |
| DEP-3 | INFO | `@capacitor/cli` in `dependencies` instead of `devDependencies` | Move it |
| TS-1 | HIGH | **TypeScript `strict` is off** (no `strictNullChecks`, no `noImplicitAny`) in both tsconfigs — the Vite scaffold default appears to have been removed | Re-enable `"strict": true`; triage incrementally |
| WEB-1 | HIGH | **All PWA manifest icons are broken**: `../icons/icon-*.webp` — the directory doesn't exist, the path escapes site root, and type says `image/png`. Chrome's install prompt won't fire | Point at `/icon-192.png`, `/icon-512.png`; add a real padded `maskable` icon |
| WEB-2 | MEDIUM | No CSP anywhere (no meta, no hosting headers in repo) for an app with user-generated content | CSP via hosting headers: `script-src 'self' https://www.gstatic.com`, scoped `connect-src` |
| WEB-3 | INFO | No `hosting` block in `firebase.json` — cache headers/SPA rewrites for ccelim.com are unversioned; hashed assets should be `immutable`, `index.html`/SW `no-cache` | Commit the hosting config |
| OBS-1 | MEDIUM | No error monitoring at all (no Sentry/Crashlytics) — production crashes on parishioners' devices are invisible | `@sentry/react` + `@sentry/capacitor`, or Crashlytics |

\* build/CI machines only, not shipped to users.

---

## 7. i18n & accessibility

- `src/App.tsx:36-44` — `timeAgo` returns English (`just now`, `5m`, `3h`, `2d`) on every post/comment in a French-default app.
- `src/App.tsx:2829,2833` — upload error messages hardcoded English, bypassing `t()`.
- `toLocaleDateString(undefined, …)` (`App.tsx:95,103`; `Messages.tsx:118-136`) uses device locale, not app language.
- `src/i18n.tsx:254` — the *English* translation reads "Please select Homme or Femme."
- `src/MediaPlayer.tsx` aria-labels and the entire `ErrorBoundary` crash screen are English-only.
- No interpolation/plural mechanism (`{n} {t('data.records')}`) — fragile for any third language.
- `index.html:8` — `user-scalable=no, maximum-scale=1` blocks pinch-zoom for low-vision users on web.

---

## 8. What's done well (verified)

- Self-role escalation blocked at signup and self-update; pending-church approval is tightly scoped with `affectedKeys().hasOnly(['role'])` — a good model.
- Message edits locked to sender + `['text','editedAt']`; like docs enforce composite IDs; activity logs immutable post-create.
- Storage **writes** owner-scoped with content-type and size validation, default-deny catch-all.
- Cloud Functions: no unauthenticated surface, correct 500-token multicast chunking, dead-token cleanup; ops script is dry-run-by-default.
- CI keystore handling entirely via secrets; no secret has ever been committed (history checked).
- Recent fixes verified effective: audio-tick re-render isolation, hooks-order crash, web duplicate notifications.
- `tsc` clean, near-clean lint, fast build.

---

## Priority roadmap

**P0 — this week (privacy & data loss):**
1. SEC-1 lock down `users` reads · 2. PUSH-1/2 token cleanup on logout · 3. SEC-2 validate `participantIds` · 4. COR-1 auth bootstrap try/catch · 5. COR-3 mic cleanup · 6. COR-6 Data-explorer map corruption · 7. WEB-1 manifest icons (trivial).

**P1 — this month (integrity & scale):**
COR-2 awaited writes · COR-4/5 message-thread 500 cliff · PERF-1 bounded queries · SEC-3/4/5 rules hardening · COR-7 library delete confirm · IOS-1/2 if an iOS release is planned · TS-1 strict mode · DEP-2 functions lockfile.

**P2 — next quarter (hardening & hygiene):**
App Check · CSP · error monitoring · CI PR gate + tests · code splitting + offline SW · CSV injection · i18n cleanup · remaining Lows.
