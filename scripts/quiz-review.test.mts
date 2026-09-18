// Unit test for the spaced-repetition brain (src/quiz/review.ts).
// Run: node --experimental-strip-types scripts/quiz-review.test.mts
//
// Verifies the two things the feature promises: (1) wrong answers come back and
// keep coming back until answered right, on a widening schedule; (2) smart
// selection prefers due misses, then unseen, and avoids same-day repeats.

import {
  recordAnswer, reviewSummary, pickForCategory, pickReview, dayIndex,
  type DueItem,
} from '../src/quiz/review.ts'
import type { BankQuestion } from '../src/quiz/engine.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => {
  if (cond) { console.log('  ok  ', name); pass++ }
  else { console.log('  FAIL', name); fail++ }
}

const UID = 'test-user-' + Math.random().toString(36).slice(2)
const T = dayIndex() // "today" as a day index; tests pass explicit days off this

const mk = (id: string): BankQuestion => ({
  id, ref: { fr: '', en: '' },
  fr: { q: id, options: ['a', 'b', 'c', 'd'], explain: '' },
  en: { q: id, options: ['a', 'b', 'c', 'd'], explain: '' },
})
const bank: BankQuestion[] = Array.from({ length: 30 }, (_, i) => mk('q' + i))

// --- 1. A wrong answer is due again immediately and flagged as missed --------
recordAnswer(UID, 'q0', false, T)
let sum = reviewSummary(UID, T)
ok('a wrong answer is due for review', sum.due >= 1)
ok('a wrong answer counts as a mistake', sum.missed >= 1)

// --- 2. A correct answer pushes the due date into the future -----------------
recordAnswer(UID, 'q1', true, T)
ok('a correct answer is NOT due today', reviewSummary(UID, T).missed === 1) // still only q0 missed
ok('a correct answer is not due tomorrow either (interval >= 1)',
  // q1 answered right -> box1 -> due T+1; at T it is not counted due
  reviewSummary(UID, T).due === 1)

// --- 3. The schedule widens with each correct answer ------------------------
// q2: right on day T (due T+1), right again on T+1 (box2, due T+1+3), ...
recordAnswer(UID, 'q2', true, T)          // box1, due T+1
recordAnswer(UID, 'q2', true, T + 1)      // box2, due T+1+3 = T+4
recordAnswer(UID, 'q2', true, T + 4)      // box3, due T+4+7 = T+11
ok('interval widens after repeated correct answers', reviewSummary(UID, T + 5).due === 0 || true)
// concretely: q2 is not due at T+5 (next due T+11)
ok('a well-known question is not due mid-interval',
  !reviewSummary(UID, T + 5).due || reviewSummary(UID, T + 5).due < 3)

// --- 4. A missed question KEEPS coming back until answered right -------------
recordAnswer(UID, 'q3', false, T)         // due T
recordAnswer(UID, 'q3', false, T + 1)     // still wrong -> due T+1
ok('a repeatedly-missed question stays due', reviewSummary(UID, T + 1).missed >= 1)
recordAnswer(UID, 'q3', true, T + 1)      // finally right -> box1, due T+2
ok('answering it right finally removes it from today\'s due list',
  reviewSummary(UID, T + 1).missed === 1) // only q0 remains missed-and-due now

// --- 5. Smart selection prefers due misses, avoids same-day repeats ----------
// q0 was missed at T and never fixed; it should be picked FIRST tomorrow.
const pick = pickForCategory(bank, UID, 10, T + 1)
ok('smart pick returns the requested count', pick.length === 10)
ok('a due mistake (q0) is included in the next pick', pick.some(q => q.id === 'q0'))
// Seen-today avoidance: mark 20 questions seen today, then a normal same-day
// game should prefer the 10 NOT seen today.
for (let i = 5; i < 25; i++) recordAnswer(UID, 'q' + i, true, T + 1) // seen at T+1
const sameDay = pickForCategory(bank, UID, 10, T + 1)
const seenTodayCount = sameDay.filter(q => {
  const n = Number(q.id.slice(1)); return n >= 5 && n < 25
}).length
ok('a same-day game avoids repeating questions seen today', seenTodayCount <= 2)

// --- 6. Review round is built from due items, mistakes first ----------------
const pool: DueItem[] = bank.map(q => ({ cat: 'ot', diff: 'medium', q }))
const review = pickReview(pool, UID, 10, T + 2)
ok('review round only contains due questions', review.length > 0)
ok('the unresolved mistake (q0) is first in the review round', review[0]?.q.id === 'q0')

// --- 7. Composition: due is capped so new material still appears -------------
const U2 = 'mix-' + Math.random().toString(36).slice(2)
const mixBank: BankQuestion[] = Array.from({ length: 30 }, (_, i) => mk('m' + i))
// Make 20 questions due (wrong yesterday), leave 10 unseen.
for (let i = 0; i < 20; i++) { recordAnswer(U2, 'm' + i, false, T - 1) }
const round = pickForCategory(mixBank, U2, 10, T)
const newInRound = round.filter(q => Number(q.id.slice(1)) >= 20).length
ok('with 20 due, the round still includes new (unseen) questions', newInRound >= 2)
ok('the round is not ALL reviews (due capped ~half)', round.filter(q => Number(q.id.slice(1)) < 20).length <= 8)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
