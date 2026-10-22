'use strict'
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { init, slug, getBrief, requestBrief, listBriefs, listPending, writeStatus, readStatus } = require('../src/analysis')

let pass = 0
function t(name, fn) {
  try {
    fn()
    pass++
    console.log('  ok -', name)
  } catch (e) {
    console.error('  FAIL -', name, '\n   ', e.message)
    process.exitCode = 1
  }
}

/** Fresh isolated store per test; returns the analyses dir for planting briefs. */
function freshStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlnet-analysis-'))
  init(tmp)
  return path.join(tmp, 'analyses')
}

console.log('Match analysis store')

t('slug is stable and filesystem-safe', () => {
  assert.equal(slug('Snow', 'Shine', 'ASL22 Ro16 Group D'), 'asl22-ro16-group-d-snow-vs-shine')
  assert.equal(
    slug('Snow', 'Shine', 'ASL22 Ro16 Group D'),
    slug('snow', 'SHINE', 'asl22 ro16 group d'),
  )
})

t('slug drops TBD sides without dangling vs', () => {
  const s = slug('Snow', 'TBD', 'ASL22')
  assert.ok(!s.endsWith('-vs'), s)
  assert.ok(!/--|^-|-$/.test(s), s)
})

t('missing brief reports missing (not throw)', () => {
  freshStore()
  const r = getBrief({ p1: 'Snow', p2: 'Shine', tournament: 'ASL22' })
  assert.equal(r.status, 'missing')
  assert.equal(r.slug, 'asl22-snow-vs-shine')
})

t('request is idempotent, then resolves to ready once brief lands', () => {
  const aDir = freshStore()
  const meta = { p1: 'Snow', p2: 'Shine', tournament: 'ASL22', game: 'BW', bo: 'Bo3' }
  const s = slug(meta.p1, meta.p2, meta.tournament)
  assert.equal(requestBrief(meta).already, 'requested')
  assert.equal(requestBrief(meta).already, 'requested') // no duplicate, no error
  assert.ok(fs.existsSync(path.join(aDir, '_requests', `${s}.json`)))
  const req = JSON.parse(fs.readFileSync(path.join(aDir, '_requests', `${s}.json`), 'utf8'))
  assert.equal(req.p1, 'Snow')
  assert.equal(req.game, 'BW')
  // agent delivers the brief; widget reads it back
  fs.writeFileSync(path.join(aDir, `${s}.md`), '# Snow vs Shine\n\nTest brief.\n')
  const got = getBrief(meta)
  assert.equal(got.status, 'ready')
  assert.ok(got.markdown.includes('Test brief'))
  assert.ok(got.savedAt > 0)
})

t('request short-circuits when brief already exists', () => {
  const aDir = freshStore()
  const meta = { p1: 'Effort', p2: 'Snow', tournament: 'ASL22' }
  const s = slug(meta.p1, meta.p2, meta.tournament)
  fs.writeFileSync(path.join(aDir, `${s}.md`), '# done\n')
  const r = requestBrief(meta)
  assert.equal(r.ok, true)
  assert.equal(r.already, 'ready')
  assert.ok(!fs.existsSync(path.join(aDir, '_requests', `${s}.json`)))
})

t('listBriefs returns newest-first markdown entries', () => {
  const aDir = freshStore()
  fs.writeFileSync(path.join(aDir, 'old.md'), 'old')
  fs.writeFileSync(path.join(aDir, 'new.md'), 'new')
  const list = listBriefs()
  assert.equal(list.length, 2)
  assert.ok(list[0].savedAt >= list[1].savedAt)
  assert.ok(list.every((b) => b.slug && typeof b.savedAt === 'number'))
})

t('status round-trip: null -> requested -> researching -> ready', () => {
  freshStore()
  const meta = { p1: 'Snow', p2: 'Shine', tournament: 'ASL22' }
  const s = slug(meta.p1, meta.p2, meta.tournament)
  assert.equal(readStatus(s), null)
  const q = requestBrief(meta)
  assert.equal(q.progress && q.progress.stage, 'requested')
  assert.equal(getBrief(meta).progress.stage, 'requested')
  assert.equal(writeStatus(s, 'researching', 'reading TL thread'), true)
  assert.equal(readStatus(s).stage, 'researching')
  assert.equal(readStatus(s).detail, 'reading TL thread')
})

t('corrupt status file reads as null, never throws', () => {
  const aDir = freshStore()
  const s = slug('A', 'B', 'C')
  fs.mkdirSync(path.join(aDir, '_status'), { recursive: true })
  fs.writeFileSync(path.join(aDir, '_status', `${s}.json`), '{not json')
  assert.equal(readStatus(s), null)
  assert.equal(getBrief({ p1: 'A', p2: 'B', tournament: 'C' }).progress, null)
})

t('listBriefs merges request meta for re-opening', () => {
  const aDir = freshStore()
  const meta = { p1: 'Snow', p2: 'Shine', tournament: 'ASL22', game: 'BW', bo: 'Bo3' }
  requestBrief(meta)
  const s = slug(meta.p1, meta.p2, meta.tournament)
  fs.writeFileSync(path.join(aDir, `${s}.md`), '# brief\n')
  const list = listBriefs()
  assert.equal(list.length, 1)
  assert.equal(list[0].p1, 'Snow')
  assert.equal(list[0].p2, 'Shine')
  assert.equal(list[0].tournament, 'ASL22')
  assert.equal(list[0].game, 'BW')
})

t('listBriefs survives missing/corrupt request files', () => {
  const aDir = freshStore()
  fs.writeFileSync(path.join(aDir, 'lonely.md'), '# lonely\n')
  const list = listBriefs()
  assert.equal(list.length, 1)
  assert.equal(list[0].p1, null)
  assert.equal(list[0].slug, 'lonely')
})

console.log(`analysis: ${pass} passed`)

// ---- listPending tests ----
console.log('Pending analysis list')

t('listPending returns empty when no requests exist', () => {
  freshStore()
  assert.equal(listPending().length, 0)
})

t('listPending returns a request with no finished brief', () => {
  const aDir = freshStore()
  const meta = { p1: 'Snow', p2: 'Effort', tournament: 'ASL22', game: 'BW', bo: 'Bo3' }
  const s = slug(meta.p1, meta.p2, meta.tournament)
  requestBrief(meta)
  writeStatus(s, 'researching', 'reading TL thread')
  const list = listPending()
  assert.equal(list.length, 1)
  assert.equal(list[0].slug, s)
  assert.equal(list[0].p1, 'Snow')
  assert.equal(list[0].game, 'BW')
  assert.equal(list[0].progress.stage, 'researching')
})

t('listPending excludes a request whose brief is ready', () => {
  const aDir = freshStore()
  const meta = { p1: 'Snow', p2: 'Effort', tournament: 'ASL22', game: 'BW' }
  const s = slug(meta.p1, meta.p2, meta.tournament)
  requestBrief(meta)
  fs.writeFileSync(path.join(aDir, `${s}.md`), '# brief\n')
  assert.equal(listPending().length, 0)
})

t('listPending sorts newest requested first', () => {
  const aDir = freshStore()
  requestBrief({ p1: 'A', p2: 'B', tournament: 'T1', game: 'SC2' })
  // simulate an earlier request by writing its file first then a later one
  requestBrief({ p1: 'C', p2: 'D', tournament: 'T2', game: 'SC2' })
  const list = listPending()
  assert.equal(list.length, 2)
  assert.equal(list[0].tournament, 'T2')
  assert.equal(list[1].tournament, 'T1')
})
