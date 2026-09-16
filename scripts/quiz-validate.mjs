// Validates src/quiz/bank/*.json against QUESTION_SPEC.md and prints a report.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const dir = new URL('../src/quiz/bank/', import.meta.url).pathname
const CATS = ['ot','nt','parables','people','verses','miracles','geography','kids','business','morality']
const DIFFS = ['easy','medium','hard']
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
let total = 0, problems = 0
const byCat = {}
const seenGlobal = new Map()
for (const cat of CATS) for (const diff of DIFFS) {
  const f = join(dir, `${cat}-${diff}.json`)
  if (!existsSync(f)) continue
  let arr
  try { arr = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { console.log(`INVALID ${cat}-${diff}: ${e.message.slice(0,80)}`); problems++; continue }
  const ids = new Set(); const seen = new Set(); let bad = 0
  arr.forEach((q, i) => {
    const errs = []
    if (!q.id || ids.has(q.id)) errs.push('id'); ids.add(q.id)
    if (!q.id?.startsWith(`${cat}-${diff}-`)) errs.push('id-prefix')
    if (!q.ref?.fr || !q.ref?.en) errs.push('ref')
    for (const L of ['fr','en']) {
      const o = q[L]
      if (!o?.q || o.q.length > 140) errs.push(`${L}.q`)
      if (!Array.isArray(o?.options) || o.options.length !== 4 || new Set(o.options.map(norm)).size !== 4 || o.options.some(x => typeof x !== 'string' || !x || x.length > 60)) errs.push(`${L}.options`)
      if (!o?.explain || o.explain.length > 160) errs.push(`${L}.explain`)
    }
    const key = norm(q.fr?.q || '')
    if (seen.has(key)) errs.push('dup-in-file'); seen.add(key)
    const g = seenGlobal.get(key); if (g && g !== `${cat}-${diff}`) errs.push(`dup-with:${g}`); seenGlobal.set(key, `${cat}-${diff}`)
    if (errs.length) { bad++; problems++; console.log(`  ${cat}-${diff}[${i}] ${q.id}: ${errs.join(', ')}`) }
  })
  byCat[cat] = (byCat[cat] || 0) + arr.length; total += arr.length
  console.log(`${cat}-${diff}: ${arr.length} questions, ${bad} bad`)
}
console.log('\nper category:', byCat); console.log('TOTAL', total, 'problems', problems)
process.exit(problems ? 1 : 0)
