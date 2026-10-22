'use strict'
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseCardDate, parseTournaments } = require('../src/matches')

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

// Fixed "now": Sep 16 2026 UTC — keeps year-inference tests deterministic.
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0)

console.log('Card-date parser')

t('ISO datetime with UTC (SC2 card style)', () => {
  assert.strictEqual(
    parseCardDate('PiG Sty Festival 8.0 2026-08-13 12:00:00 UTC', NOW),
    Date.UTC(2026, 7, 13, 12, 0, 0),
  )
})

t('ISO date-only', () => {
  assert.strictEqual(parseCardDate('Some Cup 2026-11-02', NOW), Date.UTC(2026, 10, 2))
})

t('BW range judges staleness by end (Aug 05 – Dec 06 stays 2026)', () => {
  // Phanuel catch: start-only staleness rolled this to 2027 even though the
  // event runs through December. Ongoing multi-month events keep this year.
  assert.strictEqual(
    parseCardDate('Major Acropolis #5 Aug 05 – Dec 06', NOW),
    Date.UTC(2026, 7, 5),
  )
})

t('finished range returns null (May 30 – Aug 29 seen Sep 16)', () => {
  assert.strictEqual(parseCardDate('Minor WORTEX 2026 May 30 – Aug 29', NOW), null)
})

t('New-Year-spanning range resolves (Dec 30 – Jan 05 seen Jan 03)', () => {
  const jan = Date.UTC(2027, 0, 3)
  assert.strictEqual(
    parseCardDate('Foo Cup Dec 30 – Jan 05', jan),
    Date.UTC(2026, 11, 30),
  )
})

t('BW open-ended range (Nov 04 – TBA)', () => {
  assert.strictEqual(
    parseCardDate('Minor CPL Season 12 Nov 04 – TBA', NOW),
    Date.UTC(2026, 10, 4),
  )
})

t('stale lone date returns null, not next year (Aug 14 seen Sep 16)', () => {
  assert.strictEqual(parseCardDate('Major Escore Tournament S3: W7 Aug 14', NOW), null)
})

t('same-month range resolves (Sep 10 – 20 stays September)', () => {
  assert.strictEqual(
    parseCardDate('Foo Cup Sep 10 – 20', NOW),
    Date.UTC(2026, 8, 10),
  )
})

t('stale same-month range returns null (Aug 15–16 seen Sep 16)', () => {
  assert.strictEqual(parseCardDate('Major CSLAN 4 Aug 15–16', NOW), null)
})

t('recent-past start stays this year (Sep 10 seen Sep 16)', () => {
  assert.strictEqual(
    parseCardDate('Minor Foo Cup Sep 10 – Sep 20', NOW),
    Date.UTC(2026, 8, 10),
  )
})

t('glued tag-stripped words still parse (W7 Sep 20)', () => {
  // stripTags() removes tags with no separator — regression guard.
  assert.strictEqual(
    parseCardDate('MajorEscore Tournament S3: W7Sep 20', NOW),
    Date.UTC(2026, 8, 20),
  )
})

t('empty / dateless text returns null', () => {
  assert.strictEqual(parseCardDate('', NOW), null)
  assert.strictEqual(parseCardDate(null, NOW), null)
  assert.strictEqual(parseCardDate('RSL Revival: Season 6', NOW), null)
})

t('version numbers are not dates (8.0 guard)', () => {
  assert.strictEqual(parseCardDate('PiG Sty Festival 8.0', NOW), null)
})

const fixtureFile = (f) => {
  const local = path.join(__dirname, 'fixtures', f)
  if (fs.existsSync(local)) return local
  return path.join(process.env.HOME || process.env.USERPROFILE || '', 'tlwtmp', f)
}

t('BW fixture: stale upcoming cards get no phantom pins', () => {
  // Snapshot captured while mid-August cards still sat in Upcoming in
  // mid-September. They must NOT pin (old code rolled them to 2027) —
  // they fall back to the Date TBA list.
  const d = JSON.parse(fs.readFileSync(fixtureFile('bw-mp.json'), 'utf8'))
  const ts = parseTournaments(d.parse.text['*'], 'BW')
  const up = ts.filter((x) => x.status === 'upcoming')
  assert.ok(up.length >= 2, `expected >=2 upcoming, got ${up.length}`)
  for (const x of up) {
    assert.strictEqual(x.timestamp, null, `${x.name} got phantom pin ${x.timestamp}`)
  }
})

t('BW fixture: current ongoing range keeps its start', () => {
  const d = JSON.parse(fs.readFileSync(fixtureFile('bw-mp.json'), 'utf8'))
  const ts = parseTournaments(d.parse.text['*'], 'BW')
  const cpl = ts.find((x) => /CPL Season 12/i.test(x.name))
  assert.ok(cpl, 'CPL card missing')
  assert.strictEqual(cpl.timestamp, Date.UTC(2026, 10, 4))
})

t('SC2 fixture: printed card date becomes timestamp', () => {
  const d = JSON.parse(fs.readFileSync(fixtureFile('sc2mp.json'), 'utf8'))
  const ts = parseTournaments(d.parse.text['*'], 'SC2')
  const pig = ts.find((x) => /PiG Sty/i.test(x.name))
  assert.ok(pig, `PiG card missing: ${JSON.stringify(ts.map((x) => x.name))}`)
  assert.strictEqual(pig.timestamp, Date.UTC(2026, 7, 13, 12, 0, 0))
})

console.log(`\n${pass} passed`)
