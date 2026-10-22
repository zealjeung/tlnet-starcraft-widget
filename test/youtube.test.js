'use strict'
const assert = require('node:assert')
const { newestVideoIds, loadRoster } = require('../src/youtube')

let pass = 0
function t(name, fn) {
  try { fn(); pass++; console.log('ok -', name) }
  catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
}

function pli(vid, ageH) {
  const pub = new Date(Date.now() - ageH * 36e5).toISOString()
  return { contentDetails: { videoId: vid, videoPublishedAt: pub } }
}

t('newestVideoIds takes fresh videos, caps at 2, drops stale', () => {
  const items = [pli('AAA', 1), pli('BBB', 5), pli('CCC', 10), pli('OLD', 100)]
  assert.deepStrictEqual(newestVideoIds(items), ['AAA', 'BBB'])
})

t('newestVideoIds ignores entries without id/published, empty feed yields []', () => {
  assert.deepStrictEqual(newestVideoIds([]), [])
  assert.deepStrictEqual(newestVideoIds([{ contentDetails: { videoId: 'X' } }]), [])
})

t('loadRoster only accepts valid UC channel IDs (skips nulls)', () => {
  const roster = loadRoster()
  assert.ok(roster.every((c) => /^UC[\w-]{20,}$/.test(c.youtube)), 'all rostered IDs are UC…')
  console.log(`  (rostered with channel IDs: ${roster.length})`)
})

console.log(`youtube: ${pass} passed`)
