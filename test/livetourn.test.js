'use strict'
const assert = require('node:assert')
const { normTournName, buildLiveTournSet, isLiveNow } = require('../renderer/livetourn')

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

console.log('Live-tournament matcher')

t('normalizes case, punctuation, stage suffixes', () => {
  assert.strictEqual(normTournName('ASL Season 22 (Ro24)'), 'asl season 22 ro24')
})

t('exact name matches', () => {
  const set = buildLiveTournSet([{ live: true, tournament: 'ASL Season 22' }])
  assert.strictEqual(isLiveNow('ASL Season 22', set), true)
})

t('fuzzy stage-suffix match earns red', () => {
  const set = buildLiveTournSet([{ live: true, tournament: 'ASL Season 22' }])
  assert.strictEqual(isLiveNow('ASL Season 22 Group Stage', set), true)
})

t('finished matches do not count as live', () => {
  const set = buildLiveTournSet([{ live: false, finished: true, tournament: 'ASL Season 22' }])
  assert.strictEqual(isLiveNow('ASL Season 22', set), false)
})

t('unrelated event stays amber', () => {
  const set = buildLiveTournSet([{ live: true, tournament: 'ASL Season 22' }])
  assert.strictEqual(isLiveNow('KSL Season 7', set), false)
})

t('empty/missing names never match', () => {
  const set = buildLiveTournSet([{ live: true, tournament: 'ASL Season 22' }])
  assert.strictEqual(isLiveNow('', set), false)
  assert.strictEqual(isLiveNow(null, set), false)
  assert.strictEqual(isLiveNow('ASL Season 22', new Set()), false)
})

t('ignores live matches with no tournament name', () => {
  const set = buildLiveTournSet([{ live: true, tournament: '' }])
  assert.strictEqual(set.size, 0)
})

console.log(`\n${pass} passed`)
