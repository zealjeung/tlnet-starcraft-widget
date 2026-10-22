'use strict'
const assert = require('node:assert')
const { selectFreshOrCached } = require('../src/matches')

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

console.log('Cache guard (stale-good beats failed-empty)')

t('failed fetch (empty + errors) falls back to cache', () => {
  const r = selectFreshOrCached([], ['BW: blocked'], [{ p1: 'Snow' }])
  assert.equal(r.fromCache, true)
  assert.deepEqual(r.payload, [{ p1: 'Snow' }])
})

t('successful fetch passes through, even when empty', () => {
  const r = selectFreshOrCached([], [], [{ p1: 'Snow' }])
  assert.equal(r.fromCache, false)
  assert.deepEqual(r.payload, [])
})

t('partial fresh data (one wiki ok) is kept, not replaced', () => {
  const fresh = [{ p1: 'Cure' }]
  const r = selectFreshOrCached(fresh, ['BW: blocked'], [{ p1: 'Snow' }])
  assert.equal(r.fromCache, false)
  assert.deepEqual(r.payload, fresh)
})

t('no cache and failed fetch yields honest empty', () => {
  const r = selectFreshOrCached([], ['BW: blocked'], [])
  assert.equal(r.fromCache, false)
  assert.deepEqual(r.payload, [])
})

t('non-array inputs never throw', () => {
  assert.doesNotThrow(() => selectFreshOrCached(null, null, null))
  assert.doesNotThrow(() => selectFreshOrCached(undefined, 'x', 'y'))
})

console.log(`cache-guard: ${pass} passed`)
