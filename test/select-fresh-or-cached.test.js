'use strict'
// Test: selectFreshOrCached pure function (F5 regression + cache-guard behavior)

const { selectFreshOrCached } = require('../src/matches')

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg) }
  else { failed++; console.log('  FAIL: ' + msg) }
}

console.log('=== select-fresh-or-cached.test.js ===\n')

// 1. Fresh data available, no errors → use fresh
{
  const fresh = [{ id: 1 }, { id: 2 }]
  const result = selectFreshOrCached(fresh, [], null)
  assert(!result.fromCache, 'fresh data, no errors → not from cache')
  assert(result.payload === fresh, 'fresh data, no errors → returns fresh payload')
}

// 2. Fresh data available, with errors → still use fresh (errors are non-fatal)
{
  const fresh = [{ id: 1 }]
  const result = selectFreshOrCached(fresh, ['some error'], null)
  assert(!result.fromCache, 'fresh data with errors → not from cache')
  assert(result.payload === fresh, 'fresh data with errors → returns fresh payload')
}

// 3. Fresh data empty, no cache → return empty (no cache to fall back to)
{
  const result = selectFreshOrCached([], [], null)
  assert(!result.fromCache, 'empty fresh, no cache → not from cache')
  assert(result.payload.length === 0, 'empty fresh, no cache → empty payload')
}

// 4. Fresh data empty, no errors, cache available → return empty (no error = legitimate empty)
{
  const cached = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const result = selectFreshOrCached([], [], cached)
  assert(!result.fromCache, 'empty fresh, no errors → not from cache (legitimate empty)')
  assert(result.payload.length === 0, 'empty fresh, no errors → empty payload')
}

// 5. Fresh data empty, errors present, cache available → serve stale
{
  const cached = [{ id: 1 }]
  const result = selectFreshOrCached([], ['network error'], cached)
  assert(result.fromCache, 'empty fresh with errors, cache available → from cache')
  assert(result.payload === cached, 'empty fresh with errors, cache available → returns cached payload')
}

// 6. Fresh data non-empty, cache available → use fresh (cache is stale)
{
  const fresh = [{ id: 1 }]
  const cached = [{ id: 1 }, { id: 2 }]
  const result = selectFreshOrCached(fresh, [], cached)
  assert(!result.fromCache, 'non-empty fresh, cache available → not from cache')
  assert(result.payload === fresh, 'non-empty fresh, cache available → returns fresh payload')
}

// 7. Fresh data is null/undefined, no errors, cache available → return empty
{
  const cached = [{ id: 1 }]
  const result = selectFreshOrCached(null, [], cached)
  assert(!result.fromCache, 'null fresh, no errors → not from cache')
  assert(result.payload.length === 0, 'null fresh, no errors → empty payload')
}

// 8. Fresh data is null/undefined, no cache → return empty
{
  const result = selectFreshOrCached(null, [], null)
  assert(!result.fromCache, 'null fresh, no cache → not from cache')
  assert(result.payload.length === 0, 'null fresh, no cache → empty payload')
}

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===')
process.exit(failed > 0 ? 1 : 0)
