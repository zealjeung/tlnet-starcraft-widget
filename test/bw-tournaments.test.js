'use strict'
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseTournaments, parseMainPageMatches } = require('../src/matches')

// Captured BW Main_Page (liquipedia.net/starcraft/Main_Page) — proves the BW
// wiki is actually parsed. Regression guard: an SC2-only parser silently
// returned 0 BW tournaments because BW uses a different list markup.
const fixturePath = path.join(__dirname, 'fixtures', 'bw-mp.json')
const d = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const html = d.parse.text['*']

let pass = 0
function t(name, fn) {
  try { fn(); pass++; console.log('ok -', name) }
  catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
}

const cutoff = Date.now() - 3 * 24 * 3600 * 1000

t('BW tournaments are parsed (not silently zero)', () => {
  const ts = parseTournaments(html, 'BW')
  assert.ok(ts.length >= 3, `expected >=3 BW tournaments, got ${ts.length}`)
})

t('BW tournaments have a name and a status', () => {
  const ts = parseTournaments(html, 'BW')
  for (const x of ts) {
    assert.ok(x.name && x.name.length > 1, 'missing name')
    assert.ok(x.status === 'ongoing' || x.status === 'upcoming', `bad status: ${x.status}`)
  }
})

t('BW matches drop stale past-dated cards', () => {
  // The BW page carries an old June card; it must not survive the cutoff.
  const ms = parseMainPageMatches(html, 'BW').filter(
    (m) => (!m.finished && m.timestamp >= cutoff) || (m.finished && m.timestamp >= cutoff),
  )
  const stale = ms.filter((m) => m.timestamp < cutoff)
  assert.strictEqual(stale.length, 0, `${stale.length} stale matches slipped through`)
})

console.log(`\n${pass} passed`)
