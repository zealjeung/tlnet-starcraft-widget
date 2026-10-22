'use strict'
const assert = require('node:assert')
const { checkNews, checkMatches, checkTournaments, checkBracket, checkAll } = require('../src/integrity')
const { isRetryable, HttpError } = require('../src/http')

let pass = 0
function t(name, fn) {
  try {
    fn()
    pass++
    console.log('ok -', name)
  } catch (e) {
    console.error('FAIL -', name, '\n  ', e.message)
    process.exitCode = 1
  }
}

const now = Date.now()
const hour = 3600 * 1000

/* ---- integrity: the silent-failure guard ---- */

t('healthy news passes', () => {
  const r = checkNews([{ title: 'A', url: 'https://tl.net/x', timestamp: now - hour }])
  assert.strictEqual(r.ok, true)
})

t('empty news feed is flagged (TL.net always has ~20)', () => {
  assert.strictEqual(checkNews([]).ok, false)
})

t('news using RSS `link` field passes (regression: false-positive wolf-cry)', () => {
  // Real TL.net items expose `link`, not `url`. The first live run flagged all
  // 19 valid items as "invalid url" because the checker only looked at `url`.
  const r = checkNews([{ title: 'A', link: 'https://tl.net/x', timestamp: now - hour }])
  assert.strictEqual(r.ok, true)
})

t('news with broken url is flagged', () => {
  const r = checkNews([{ title: 'A', url: 'javascript:evil' }])
  assert.strictEqual(r.ok, false)
  assert.match(r.problems.join(), /invalid url/)
})

t('stale 2024-style match is flagged', () => {
  const r = checkMatches([{ p1: 'Serral', p2: 'Maru', timestamp: new Date('2024-07-01').getTime() }])
  assert.strictEqual(r.ok, false)
  assert.match(r.problems.join(), /stale/)
})

t('future match within a year passes', () => {
  const r = checkMatches([{ p1: 'Clem', p2: 'ByuN', timestamp: now + 4 * hour }])
  assert.strictEqual(r.ok, true)
})

t('self-matchup (parser collapse bug) is flagged', () => {
  const r = checkMatches([{ p1: 'Clem', p2: 'Clem', timestamp: now + hour }])
  assert.strictEqual(r.ok, false)
  assert.match(r.problems.join(), /identical/)
})

t('TBD vs TBD is legitimate, not flagged (regression: unseeded rounds)', () => {
  // Live run flagged 5 real "TBD vs TBD" rows as parser bugs. Unseeded future
  // rounds genuinely have no players yet.
  const r = checkMatches([{ p1: 'TBD', p2: 'TBD', timestamp: now + hour }])
  assert.strictEqual(r.ok, true)
})

t('empty matches alone is NOT an error (quiet hours are real)', () => {
  assert.strictEqual(checkMatches([]).ok, true)
})

t('matches AND tournaments both empty IS flagged', () => {
  const r = checkAll({ news: [{ title: 'x', url: 'https://tl.net/a' }], matches: [], tournaments: [] })
  assert.strictEqual(r.ok, false)
  assert.match(r.summary.join(), /markup likely changed/)
})

t('non-StarCraft tournament url is flagged', () => {
  const r = checkTournaments([{ name: 'X', url: 'https://liquipedia.net/counterstrike/Foo' }])
  assert.strictEqual(r.ok, false)
  assert.match(r.problems.join(), /non-StarCraft/)
})

t('bracket with no rows is flagged', () => {
  assert.strictEqual(checkBracket({ brackets: [], matchlists: [] }).ok, false)
})

t('healthy bracket passes', () => {
  const r = checkBracket({
    brackets: [{ matches: [{ opponents: [{ name: 'Clem' }, { name: 'ByuN' }], score: '3–0', finished: true }] }],
    matchlists: [],
  })
  assert.strictEqual(r.ok, true)
})

/* ---- http retry classification ---- */

t('429 is retryable', () => assert.strictEqual(new HttpError(429, 'u').retryable, true))
t('503 is retryable', () => assert.strictEqual(new HttpError(503, 'u').retryable, true))
t('404 is NOT retryable', () => assert.strictEqual(new HttpError(404, 'u').retryable, false))
t('DNS failure at login is retryable', () =>
  assert.strictEqual(isRetryable(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' })), true))
t('timeout is retryable', () => assert.strictEqual(isRetryable(new Error('Timeout after 20000ms')), true))

console.log(`\n${pass} passed`)
