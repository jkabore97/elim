// Firestore security-rules tests. Run with:
//   npx firebase-tools emulators:exec --only firestore --project demo-elim \
//     "node scripts/firestore-rules.test.mjs"
//
// Verifies the security-relevant rules behave as intended AND that the
// legitimate client operations still succeed (so a deploy can't silently
// break the live app).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, deleteDoc } from 'firebase/firestore'

let pass = 0, fail = 0
const check = async (name, p) => {
  try { await p; console.log('  ok  ', name); pass++ }
  catch (e) { console.log('  FAIL', name, '-', e.message); fail++ }
}

const env = await initializeTestEnvironment({
  projectId: 'demo-elim',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
})

// Seed data with rules disabled.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/member1'), { role: 'member', displayName: 'M1', phone: '111' })
  await setDoc(doc(db, 'users/member2'), { role: 'member', displayName: 'M2', phone: '222' })
  await setDoc(doc(db, 'users/pastor1'), { role: 'pastor', displayName: 'P1' })
  await setDoc(doc(db, 'users/church1'), { role: 'church', displayName: 'C1' })
  await setDoc(doc(db, 'comments/c1'), { postId: 'p1', userId: 'member2', text: 'hi', likes: 0 })
  await setDoc(doc(db, 'reports/r1'), { targetType: 'post', targetId: 'p1', reason: 'child_safety', reporterId: 'member2', reporterName: 'M2', status: 'open' })
  await setDoc(doc(db, 'donations/d1'), { donorId: 'member2', donorName: 'M2', type: 'dime', purpose: 'construction', status: 'declared' })
  await setDoc(doc(db, 'comments/cOld'), { postId: 'p1', userId: 'member2', text: 'old' }) // no likes field
  await setDoc(doc(db, 'posts/p1'), { churchId: 'church1', likes: 0, commentsCount: 0 })
  await setDoc(doc(db, 'conversations/convDirect'), { type: 'direct', participantIds: ['pastor1', 'member1'] })
  await setDoc(doc(db, 'conversations/convPastor2'), { type: 'pastor', participantIds: ['member2'] })
  await setDoc(doc(db, 'conversations/convChurch'), { type: 'church', participantIds: ['member1'] })
  await setDoc(doc(db, 'notifications/n1'), { recipientId: 'member1', type: 'post_like', actorId: 'member2', actorName: 'M2', postId: 'p1', read: false })
  await setDoc(doc(db, 'notifications/n2'), { recipientId: 'member2', type: 'post_like', actorId: 'member1', actorName: 'M1', postId: 'p1', read: false })
  await setDoc(doc(db, 'config/donation'), { title: 'Give', providers: [] })
  await setDoc(doc(db, 'quizKids/wk1__member1__leo'), { kidsWeekId: 'wk1', uid: 'member1', parentName: 'M1', childName: 'Leo', points: 10 })
  await setDoc(doc(db, 'quizKids/wk1__member2__mia'), { kidsWeekId: 'wk1', uid: 'member2', parentName: 'M2', childName: 'Mia', points: 5 })
  await setDoc(doc(db, 'announcements/a1'), { title: 'Hi', body: 'x', createdAt: serverTimestamp() })
  await setDoc(doc(db, 'scheduledBroadcasts/s1'), { title: 'S', body: 'x', sent: false, sendAt: serverTimestamp() })
  await setDoc(doc(db, 'transcribeJobs/jobChurch'), { ownerUid: 'church1', status: 'done', text: 'sermon', createdAt: serverTimestamp() })
  await setDoc(doc(db, 'transcribeJobs/jobPastor'), { ownerUid: 'pastor1', status: 'processing', createdAt: serverTimestamp() })
})

const m1 = env.authenticatedContext('member1').firestore()
const pastor = env.authenticatedContext('pastor1').firestore()
const church = env.authenticatedContext('church1').firestore()

console.log('SEC-1 users read:')
await check('member reads own doc', assertSucceeds(getDoc(doc(m1, 'users/member1'))))
await check('member CANNOT read another member', assertFails(getDoc(doc(m1, 'users/member2'))))
await check('pastor reads any member', assertSucceeds(getDoc(doc(pastor, 'users/member2'))))
await check('church lead reads any member', assertSucceeds(getDoc(doc(church, 'users/member2'))))

console.log('Comment likes:')
await check('member creates own commentLike', assertSucceeds(setDoc(doc(m1, 'commentLikes/c1_member1'), { commentId: 'c1', userId: 'member1', createdAt: serverTimestamp() })))
await check('member CANNOT forge another user commentLike', assertFails(setDoc(doc(m1, 'commentLikes/c1_member2'), { commentId: 'c1', userId: 'member2', createdAt: serverTimestamp() })))
await check('member CANNOT use mismatched docId', assertFails(setDoc(doc(m1, 'commentLikes/wrong_member1'), { commentId: 'c1', userId: 'member1', createdAt: serverTimestamp() })))
await check('member bumps comment likes +1', assertSucceeds(updateDoc(doc(m1, 'comments/c1'), { likes: 1 })))
await check('first like on comment with no likes field', assertSucceeds(updateDoc(doc(m1, 'comments/cOld'), { likes: 1 })))
await check('member CANNOT set comment likes to 999', assertFails(updateDoc(doc(m1, 'comments/c1'), { likes: 999 })))

console.log('SEC-4 post counters:')
await check('member likes post +1', assertSucceeds(updateDoc(doc(m1, 'posts/p1'), { likes: 1 })))
await check('member CANNOT set post likes to 999', assertFails(updateDoc(doc(m1, 'posts/p1'), { likes: 999 })))
await check('member bumps commentsCount +1', assertSucceeds(updateDoc(doc(m1, 'posts/p1'), { commentsCount: 1 })))

console.log('SEC-2 message injection:')
await check('member sends matching message', assertSucceeds(addDoc(collection(m1, 'messages'), { conversationId: 'convDirect', senderId: 'member1', senderName: 'M1', senderRole: 'member', text: 'hey', participantIds: ['pastor1', 'member1'], createdAt: serverTimestamp() })))
await check('member CANNOT inject into a thread they are not in', assertFails(addDoc(collection(m1, 'messages'), { conversationId: 'convPastor2', senderId: 'member1', senderName: 'M1', senderRole: 'member', text: 'intrude', participantIds: ['member1', 'member2'], createdAt: serverTimestamp() })))
await check('member CANNOT forge participantIds mismatching the conversation', assertFails(addDoc(collection(m1, 'messages'), { conversationId: 'convDirect', senderId: 'member1', senderName: 'M1', senderRole: 'member', text: 'x', participantIds: ['member1', 'member2'], createdAt: serverTimestamp() })))

console.log('Church-channel impersonation guards:')
await check('member CANNOT forge a staff senderRole (fake Pastor badge)', assertFails(addDoc(collection(m1, 'messages'), { conversationId: 'convDirect', senderId: 'member1', senderName: 'M1', senderRole: 'pastor', text: 'x', participantIds: ['pastor1', 'member1'], createdAt: serverTimestamp() })))
await check('member CANNOT write into a church (server-only) thread', assertFails(addDoc(collection(m1, 'messages'), { conversationId: 'convChurch', senderId: 'member1', senderName: 'M1', senderRole: 'member', text: 'x', participantIds: ['member1'], createdAt: serverTimestamp() })))
await check('member CANNOT flip a thread type to church', assertFails(updateDoc(doc(m1, 'conversations/convDirect'), { type: 'church' })))
await check('member CANNOT add participants to a thread', assertFails(updateDoc(doc(m1, 'conversations/convDirect'), { participantIds: ['pastor1', 'member1', 'member2'] })))
await check('member CAN update runtime fields on own thread', assertSucceeds(updateDoc(doc(m1, 'conversations/convDirect'), { lastMessage: 'hi', lastMessageAt: serverTimestamp() })))

console.log('SEC-3 / SEC-5:')
await check('member CANNOT change their own role', assertFails(updateDoc(doc(m1, 'users/member1'), { role: 'admin' })))
await check('member writes a valid activity log', assertSucceeds(addDoc(collection(m1, 'activityLogs'), { userId: 'member1', userRole: 'member', action: 'like_added', createdAt: serverTimestamp() })))
await check('member CANNOT forge an admin-role log', assertFails(addDoc(collection(m1, 'activityLogs'), { userId: 'member1', userRole: 'admin', action: 'x', createdAt: serverTimestamp() })))

console.log('Notifications:')
await check('recipient reads own notification', assertSucceeds(getDoc(doc(m1, 'notifications/n1'))))
await check('member CANNOT read another user notification', assertFails(getDoc(doc(m1, 'notifications/n2'))))
await check('recipient marks own notification read', assertSucceeds(updateDoc(doc(m1, 'notifications/n1'), { read: true })))
await check('client CANNOT forge a notification', assertFails(setDoc(doc(m1, 'notifications/forged'), { recipientId: 'member2', type: 'post_like', actorId: 'member1', actorName: 'M1', postId: 'p1', read: false })))
await check('recipient CANNOT change more than read', assertFails(updateDoc(doc(m1, 'notifications/n1'), { read: true, actorName: 'HACKED' })))

console.log('Donation config:')
await check('member reads donation config', assertSucceeds(getDoc(doc(m1, 'config/donation'))))
await check('member CANNOT edit donation config', assertFails(updateDoc(doc(m1, 'config/donation'), { title: 'hacked' })))
await check('admin/pastor edits donation config', assertSucceeds(setDoc(doc(pastor, 'config/donation'), { title: 'Soutenez', providers: [{ id: 'wave', label: 'Wave', number: '+225 07...' }] })))

console.log('Safety reports (in-app reporting):')
await check('member files a report',
  assertSucceeds(addDoc(collection(m1, 'reports'), { targetType: 'post', targetId: 'p1', reason: 'child_safety', details: 'x', preview: 'y', reporterId: 'member1', reporterName: 'M1', status: 'open', createdAt: serverTimestamp() })))
await check('member CANNOT file a report as someone else',
  assertFails(addDoc(collection(m1, 'reports'), { targetType: 'post', targetId: 'p1', reason: 'spam', reporterId: 'member2', reporterName: 'M2', status: 'open', createdAt: serverTimestamp() })))
await check('member CANNOT file a pre-resolved report',
  assertFails(addDoc(collection(m1, 'reports'), { targetType: 'post', targetId: 'p1', reason: 'spam', reporterId: 'member1', reporterName: 'M1', status: 'dismissed', createdAt: serverTimestamp() })))
await check('member CANNOT use an unknown reason',
  assertFails(addDoc(collection(m1, 'reports'), { targetType: 'post', targetId: 'p1', reason: 'whatever', reporterId: 'member1', reporterName: 'M1', status: 'open', createdAt: serverTimestamp() })))
await check('member CANNOT stuff oversized details',
  assertFails(addDoc(collection(m1, 'reports'), { targetType: 'post', targetId: 'p1', reason: 'spam', details: 'z'.repeat(1001), reporterId: 'member1', reporterName: 'M1', status: 'open', createdAt: serverTimestamp() })))
await check('member CANNOT read the report queue',
  assertFails(getDoc(doc(m1, 'reports/r1'))))
await check('staff reads the report queue',
  assertSucceeds(getDoc(doc(pastor, 'reports/r1'))))
await check('staff resolves a report',
  assertSucceeds(updateDoc(doc(pastor, 'reports/r1'), { status: 'actioned', reviewedById: 'pastor1', reviewedByName: 'P', reviewedAt: serverTimestamp() })))
await check('staff CANNOT rewrite the report content',
  assertFails(updateDoc(doc(pastor, 'reports/r1'), { status: 'actioned', reason: 'spam' })))
await check('member CANNOT resolve a report',
  assertFails(updateDoc(doc(m1, 'reports/r1'), { status: 'dismissed' })))
await check('nobody can delete a report',
  assertFails(deleteDoc(doc(pastor, 'reports/r1'))))

console.log('Donations (declarations):')
await check('member declares a dime',
  assertSucceeds(addDoc(collection(m1, 'donations'), { donorId: 'member1', donorName: 'M1', type: 'dime', purpose: 'x', amount: '5000 FCFA', status: 'declared', createdAt: serverTimestamp() })))
await check('member CANNOT declare as someone else',
  assertFails(addDoc(collection(m1, 'donations'), { donorId: 'member2', donorName: 'M2', type: 'dime', status: 'declared', createdAt: serverTimestamp() })))
await check('member CANNOT self-verify at creation',
  assertFails(addDoc(collection(m1, 'donations'), { donorId: 'member1', donorName: 'M1', type: 'dime', status: 'verified', createdAt: serverTimestamp() })))
await check('member CANNOT use an unknown donation type',
  assertFails(addDoc(collection(m1, 'donations'), { donorId: 'member1', donorName: 'M1', type: 'jackpot', status: 'declared', createdAt: serverTimestamp() })))
await check('member declares with a currency field',
  assertSucceeds(addDoc(collection(m1, 'donations'), { donorId: 'member1', donorName: 'M1', type: 'offrande', amount: '10 USD', currency: 'USD', status: 'declared', createdAt: serverTimestamp() })))
await check('member CANNOT smuggle verified fields into a declaration',
  assertFails(addDoc(collection(m1, 'donations'), { donorId: 'member1', donorName: 'M1', type: 'dime', status: 'declared', verifiedById: 'square', provider: 'square', amountCents: 999999, createdAt: serverTimestamp() })))
await check('member CANNOT read another member donation',
  assertFails(getDoc(doc(m1, 'donations/d1'))))
await check('staff reads the donations ledger',
  assertSucceeds(getDoc(doc(pastor, 'donations/d1'))))
await check('staff verifies a donation',
  assertSucceeds(updateDoc(doc(pastor, 'donations/d1'), { status: 'verified', verifiedById: 'pastor1', verifiedByName: 'P', verifiedAt: serverTimestamp() })))
await check('staff CANNOT rewrite the declaration itself',
  assertFails(updateDoc(doc(pastor, 'donations/d1'), { status: 'verified', amount: '999999' })))
await check('member CANNOT verify a donation',
  assertFails(updateDoc(doc(m1, 'donations/d1'), { status: 'verified' })))
await check('nobody can delete a donation',
  assertFails(deleteDoc(doc(pastor, 'donations/d1'))))

console.log('SEC-KIDS quizKids delete/create:')
await check('parent creates own kid score',
  assertSucceeds(setDoc(doc(m1, 'quizKids/wk2__member1__leo'), { kidsWeekId: 'wk2', uid: 'member1', parentName: 'M1', childName: 'Leo', points: 3 })))
await check('parent CANNOT forge another parent kid score',
  assertFails(setDoc(doc(m1, 'quizKids/wk2__member2__mia'), { kidsWeekId: 'wk2', uid: 'member2', parentName: 'M2', childName: 'Mia', points: 3 })))
await check('parent deletes OWN kid score',
  assertSucceeds(deleteDoc(doc(m1, 'quizKids/wk1__member1__leo'))))
await check('parent CANNOT delete another parent kid score',
  assertFails(deleteDoc(doc(m1, 'quizKids/wk1__member2__mia'))))

console.log('SEC-BROADCAST announcements + scheduled + autoNotifs:')
await check('member reads an announcement',
  assertSucceeds(getDoc(doc(m1, 'announcements/a1'))))
await check('member CANNOT write an announcement',
  assertFails(setDoc(doc(m1, 'announcements/a2'), { title: 'x', body: 'y' })))
await check('member CANNOT read scheduledBroadcasts',
  assertFails(getDoc(doc(m1, 'scheduledBroadcasts/s1'))))
await check('member CANNOT create a scheduledBroadcast',
  assertFails(setDoc(doc(m1, 'scheduledBroadcasts/s2'), { title: 'x', body: 'y', sent: false, sendAt: serverTimestamp() })))
await check('admin creates a scheduledBroadcast (sent=false)',
  assertSucceeds(setDoc(doc(pastor, 'scheduledBroadcasts/s3'), { title: 'x', body: 'y', sent: false, sendAt: serverTimestamp() })))
await check('admin CANNOT create an already-sent scheduledBroadcast',
  assertFails(setDoc(doc(pastor, 'scheduledBroadcasts/s4'), { title: 'x', body: 'y', sent: true, sendAt: serverTimestamp() })))
await check('admin CANNOT update a scheduledBroadcast (dispatcher only)',
  assertFails(updateDoc(doc(pastor, 'scheduledBroadcasts/s3'), { sent: true })))
await check('admin deletes a scheduledBroadcast',
  assertSucceeds(deleteDoc(doc(pastor, 'scheduledBroadcasts/s1'))))
await check('member reads autoNotifs config',
  assertSucceeds(getDoc(doc(m1, 'config/autoNotifs'))))
await check('member CANNOT write autoNotifs config',
  assertFails(setDoc(doc(m1, 'config/autoNotifs'), { quizReminder: { enabled: false } })))
await check('admin writes autoNotifs config',
  assertSucceeds(setDoc(doc(pastor, 'config/autoNotifs'), { quizReminder: { title: 'X', body: 'Y', enabled: true } })))

console.log('Transcribe jobs (shared Scripts library):')
// The library is shared among users with transcription access.
await check('lead reads ANOTHER user\'s transcript job (shared library)',
  assertSucceeds(getDoc(doc(church, 'transcribeJobs/jobPastor'))))
await check('admin reads any transcript job',
  assertSucceeds(getDoc(doc(pastor, 'transcribeJobs/jobChurch'))))
await check('member CANNOT read a transcript job they do not own',
  assertFails(getDoc(doc(m1, 'transcribeJobs/jobChurch'))))
await check('lead creates own transcript job (status processing)',
  assertSucceeds(addDoc(collection(church, 'transcribeJobs'), { ownerUid: 'church1', status: 'processing', createdAt: serverTimestamp() })))
await check('member CANNOT create a transcript job',
  assertFails(addDoc(collection(m1, 'transcribeJobs'), { ownerUid: 'member1', status: 'processing', createdAt: serverTimestamp() })))
await check('lead CANNOT update a transcript job (function only)',
  assertFails(updateDoc(doc(church, 'transcribeJobs/jobChurch'), { text: 'tampered' })))
await check('lead deletes own transcript job',
  assertSucceeds(deleteDoc(doc(church, 'transcribeJobs/jobChurch'))))
await check('admin deletes any transcript job',
  assertSucceeds(deleteDoc(doc(pastor, 'transcribeJobs/jobPastor'))))

console.log('Quiz stats (difficulty calibration):')
await check('member writes quizStats counters',
  assertSucceeds(setDoc(doc(m1, 'quizStats/q1'), { attempts: 1, correct: 1, updatedAt: serverTimestamp() }, { merge: true })))
await check('member CANNOT smuggle an extra field into quizStats',
  assertFails(setDoc(doc(m1, 'quizStats/q1'), { attempts: 1, correct: 1, updatedAt: serverTimestamp(), b: -5 })))
await check('member reads quizStats',
  assertSucceeds(getDoc(doc(m1, 'quizStats/q1'))))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
