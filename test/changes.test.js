'use strict'
const assert = require('node:assert')
const { parseAtom, isRelevant, relativeTime, feedUrl } = require('../src/changes')

let pass = 0
function t(name, fn) {
  try { fn(); pass++; console.log('ok -', name) }
  catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
}

const xml = `<?xml version="1.0"?>
<feed>
  <entry><title>PcEc Cup/12</title><link rel="alternate" href="https://liquipedia.net/starcraft2/PcEc_Cup/12"/><updated>2026-08-09T04:39:23Z</updated><author><name>Bot</name></author></entry>
  <entry><title>User:Mizenhauer</title><link href="x"/><updated>2026-08-09T03:00:00Z</updated></entry>
  <entry><title>Serral vs Rogue</title><link href="y"/><updated>2026-08-09T02:00:00Z</updated></entry>
  <entry><title>Protoss</title><link href="z"/><updated>2026-08-09T01:00:00Z</updated></entry>
</feed>`

t('parseAtom extracts title/link/ts/author', () => {
  const a = parseAtom(xml)
  assert.strictEqual(a.length, 4)
  assert.strictEqual(a[0].title, 'PcEc Cup/12')
  assert.strictEqual(a[0].author, 'Bot')
  assert.strictEqual(a[0].ts, Date.parse('2026-08-09T04:39:23Z'))
})

t('isRelevant keeps tournament pages with a slash', () => {
  assert.strictEqual(isRelevant('PcEc Cup/12'), true)
  assert.strictEqual(isRelevant('Zhang Yu Miao Cup/Group Stage'), true)
})

t('isRelevant drops user/talk pages', () => {
  assert.strictEqual(isRelevant('User:Mizenhauer'), false)
  assert.strictEqual(isRelevant('User talk:Nishihi'), false)
})

t('isRelevant drops generic article titles (noise)', () => {
  assert.strictEqual(isRelevant('Protoss'), false)
  assert.strictEqual(isRelevant('Zerg'), false)
})

t('isRelevant keeps plain tournament keyword titles', () => {
  assert.strictEqual(isRelevant('PiG Sty Festival 8.0'), true)
  assert.strictEqual(isRelevant('Ladder Legends Saturday Open'), true)
})

t('relativeTime formats correctly', () => {
  const now = Date.now()
  assert.match(relativeTime(now - 30 * 1000), /^30s ago$/)
  assert.match(relativeTime(now - 5 * 60 * 1000), /^5m ago$/)
  assert.match(relativeTime(now - 3 * 3600 * 1000), /^3h ago$/)
  assert.match(relativeTime(now - 2 * 864e5), /^2d ago$/)
})

t('feedUrl is well-formed per wiki', () => {
  const u = feedUrl('https://liquipedia.net/starcraft2/api.php')
  assert.match(u, /action=feedrecentchanges/)
  assert.match(u, /days=2/)
  assert.match(u, /limit=40/)
})

console.log(`\n${pass} passed`)
