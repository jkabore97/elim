// Firestore security-rules tests. Run with:
//   npx firebase-tools emulators:exec --only firestore --project demo-elim \
//     "node scripts/firestore-rules.test.mjs"
//
// Verifies the security-relevant rules behave as intended AND that the
// legitimate client operations still succeed (so a deploy can't silently
// break the live app).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'

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
  await setDoc(doc(db, 'comments/cOld'), { postId: 'p1', userId: 'member2', text: 'old' }) // no likes field
  await setDoc(doc(db, 'posts/p1'), { churchId: 'church1', likes: 0, commentsCount: 0 })
  await setDoc(doc(db, 'conversations/convDirect'), { type: 'direct', participantIds: ['pastor1', 'member1'] })
  await setDoc(doc(db, 'conversations/convPastor2'), { type: 'pastor', participantIds: ['member2'] })
  await setDoc(doc(db, 'notifications/n1'), { recipientId: 'member1', type: 'post_like', actorId: 'member2', actorName: 'M2', postId: 'p1', read: false })
  await setDoc(doc(db, 'notifications/n2'), { recipientId: 'member2', type: 'post_like', actorId: 'member1', actorName: 'M1', postId: 'p1', read: false })
  await setDoc(doc(db, 'config/donation'), { title: 'Give', providers: [] })
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

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
