'use strict'
// Test: Liquipedia block/unblock chain behavior (F2 regression test)
// Verifies that setLiquipediaBlocked(true) does NOT poison the next call after unblock.
// Mocks https.get to fail fast — no real network calls.

const https = require('https')
const { EventEmitter } = require('events')
const http = require('../src/http')
const { setLiquipediaBlocked, isLiquipediaBlocked, getLiquipedia } = http

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg) }
  else { failed++; console.log('  FAIL: ' + msg) }
}

// Mock https.get to immediately fail with a network error
function mockHttpsGet() {
  const originalGet = https.get
  https.get = (url, opts, cb) => {
    const req = new EventEmitter()
    process.nextTick(() => {
      req.emit('error', new Error('ECONNREFUSED'))
    })
    req.destroy = () => {}
    return req
  }
  return () => { https.get = originalGet }
}

async function run() {
  console.log('=== liquipedia-block.test.js ===\n')
  const restore = mockHttpsGet()

  // 1. Initial state: not blocked
  assert(!isLiquipediaBlocked(), 'initial state: not blocked')

  // 2. Block: should reject immediately
  setLiquipediaBlocked(true)
  assert(isLiquipediaBlocked(), 'after block: isLiquipediaBlocked() true')

  let blockedErr = null
  try {
    await getLiquipedia('https://liquipedia.net/starcraft/api.php?action=parse&page=Main_Page', { attempts: 1 })
  } catch (e) {
    blockedErr = e
  }
  assert(blockedErr !== null, 'blocked call rejects')
  assert(blockedErr && blockedErr.message.includes('disabled'), 'blocked call error message correct')

  // 3. Unblock: next call should NOT be poisoned (F2 regression)
  setLiquipediaBlocked(false)
  assert(!isLiquipediaBlocked(), 'after unblock: isLiquipediaBlocked() false')

  let unblockErr = null
  try {
    await getLiquipedia('https://liquipedia.net/starcraft/api.php?action=parse&page=Main_Page', { attempts: 1 })
  } catch (e) {
    unblockErr = e
  }
  assert(unblockErr === null || !unblockErr.message.includes('disabled'), 'unblock: next call not poisoned by previous block')

  // 4. Generation counter: multiple block/unblock cycles
  setLiquipediaBlocked(true)
  setLiquipediaBlocked(false)
  setLiquipediaBlocked(true)
  setLiquipediaBlocked(false)
  assert(!isLiquipediaBlocked(), 'after multiple cycles: not blocked')

  let cycleErr = null
  try {
    await getLiquipedia('https://liquipedia.net/starcraft/api.php?action=parse&page=Main_Page', { attempts: 1 })
  } catch (e) {
    cycleErr = e
  }
  assert(cycleErr === null || !cycleErr.message.includes('disabled'), 'after multiple cycles: chain not poisoned')

  // 5. setLiquipediaBlocked(false) when already unblocked: no-op
  setLiquipediaBlocked(false)
  assert(!isLiquipediaBlocked(), 'redundant unblock: still not blocked')

  restore()
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===')
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })
