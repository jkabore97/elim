// Unit test for the Parcours progression (src/quiz/lessons.ts).
// Run: npm run test:lessons
//
// Verifies: stable lesson partitioning, completion derived from `mastered`
// (back-fill), the local 4/5 pass flag, and the level unlock chain.

import {
  lessonsOf, lessonId, lessonPassed, levelState, levelUnlocked, recordLessonResult, LESSON_SIZE,
} from '../src/quiz/lessons.ts'
import type { BankQuestion } from '../src/quiz/engine.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => {
  if (cond) { console.log('  ok  ', name); pass++ } else { console.log('  FAIL', name); fail++ }
}

const mk = (id: string): BankQuestion => ({
  id, ref: { fr: '', en: '' },
  fr: { q: id, options: ['a', 'b', 'c', 'd'], explain: '' },
  en: { q: id, options: ['a', 'b', 'c', 'd'], explain: '' },
})
// 12 questions → 3 lessons (5, 5, 2). Ids deliberately out of order to prove sorting.
const bank: BankQuestion[] = ['q09','q02','q11','q04','q07','q01','q08','q03','q12','q05','q10','q06'].map(mk)

// --- 1. Stable partition ----------------------------------------------------
const lessons = lessonsOf(bank)
ok('partitions into ceil(n/5) lessons', lessons.length === 3)
ok('lesson size is 5', lessons[0].length === LESSON_SIZE)
ok('is sorted by id (lesson 0 starts at q01)', lessons[0][0].id === 'q01')
ok('is stable across calls', JSON.stringify(lessonsOf(bank)) === JSON.stringify(lessons))

// --- 2. Completion derived from mastered (back-fill) ------------------------
const mastered: Record<string, true> = {}
ok('a fresh lesson is not passed', !lessonPassed(lessons[0], mastered))
for (const q of lessons[0]) mastered[q.id] = true // master all 5 of lesson 0
ok('mastering all 5 marks the lesson passed (back-fill)', lessonPassed(lessons[0], mastered))
ok('an untouched lesson stays unpassed', !lessonPassed(lessons[1], mastered))

// --- 3. Local 4/5 pass flag -------------------------------------------------
const UID = 'u' + Math.random().toString(36).slice(2)
const id1 = lessonId('nt', 'easy', 1)
ok('lesson 1 not passed before playing', !lessonPassed(lessons[1], {}, UID, id1))
recordLessonResult(UID, id1, 4, 5) // 4/5 → passes locally
ok('scoring 4/5 passes a lesson locally (no mastered needed)', lessonPassed(lessons[1], {}, UID, id1))
recordLessonResult(UID, lessonId('nt','easy',2), 2, 5) // 2/5 → not passed
ok('scoring 2/5 does NOT pass', !lessonPassed(lessons[2], {}, UID, lessonId('nt','easy',2)))

// --- 4. Level state & unlock chain ------------------------------------------
const easy = levelState(bank, mastered, 'nt', 'easy', UID) // lesson0 mastered + lesson1 local pass
ok('level counts passed lessons', easy.passed === 2 && easy.total === 3)
ok('level not complete until all lessons passed', !easy.complete)

const allMastered: Record<string, true> = {}
for (const q of bank) allMastered[q.id] = true
const easyDone = levelState(bank, allMastered, 'nt', 'easy')
ok('mastering everything completes the level', easyDone.complete)

ok('easy is always unlocked', levelUnlocked('easy', { easy: false, medium: false, hard: false }))
ok('medium locked until easy complete', !levelUnlocked('medium', { easy: false, medium: false, hard: false }))
ok('medium unlocks when easy complete', levelUnlocked('medium', { easy: true, medium: false, hard: false }))
ok('hard locked until medium complete', !levelUnlocked('hard', { easy: true, medium: false, hard: false }))
ok('hard unlocks when medium complete', levelUnlocked('hard', { easy: true, medium: true, hard: false }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
