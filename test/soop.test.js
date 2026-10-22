'use strict'
const assert = require('node:assert')
const { fetchStreams, loadRoster, BW_CATE_NO } = require('../src/soop')

let pass = 0
const pending = []
function t(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    pending.push((async () => {
      try { await fn(); pass++; console.log('ok -', name) }
      catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
    })())
  } else {
    try { fn(); pass++; console.log('ok -', name) }
    catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
  }
}

t('BW category constant is StarCraft (40001)', () => {
  assert.strictEqual(BW_CATE_NO, 40001)
})

t('roster loads with progamer mappings incl. Mini', () => {
  const roster = loadRoster()
  assert.ok(roster.length >= 50, `expected 50+ BJs, got ${roster.length}`)
  const mini = roster.find((r) => r.player === 'Mini')
  assert.ok(mini, 'Mini missing from roster')
  assert.strictEqual(mini.bjid, 'bye1013')
})

t('category gate: only 40001 passes, SC2/variety/offline dropped', async () => {
  const http = require('../src/http')
  const realGet = http.get
  const fixtures = {
    livebw: { station: { user_nick: 'Tester' }, broad: { broad_no: 1, broad_cate_no: 40001, broad_title: '스타 test', current_sum_viewer: 100, is_password: false }, profile_image: '//x/y.jpg' },
    livesc2: { station: { user_nick: 'SC2er' }, broad: { broad_no: 2, broad_cate_no: 40016, broad_title: 'SC2 ladder', current_sum_viewer: 9999, is_password: false } },
    livevariety: { station: { user_nick: 'Dancer' }, broad: { broad_no: 3, broad_cate_no: 100, broad_title: '춤추는 방송', current_sum_viewer: 50000, is_password: false } },
    offline: { station: { user_nick: 'Sleeper' }, broad: null },
  }
  http.get = async (url) => {
    const m = url.match(/\/api\/([^/]+)\/station/)
    return JSON.stringify(fixtures[m[1]] || { station: {}, broad: null })
  }
  // Temporarily shrink the roster to the four fixtures.
  const fs = require('fs')
  const path = require('path')
  const rosterFile = path.join(__dirname, '..', 'data', 'soop-bjs.json')
  const backup = fs.readFileSync(rosterFile, 'utf8')
  fs.writeFileSync(rosterFile, JSON.stringify([
    { bjid: 'livebw', player: 'Tester', race: 'Protoss' },
    { bjid: 'livesc2', player: 'SC2er', race: 'Terran' },
    { bjid: 'livevariety', player: 'Dancer', race: '' },
    { bjid: 'offline', player: 'Sleeper', race: 'Zerg' },
  ]))
  try {
    const { streams, configured } = await fetchStreams()
    assert.strictEqual(configured, true)
    assert.strictEqual(streams.length, 1, `expected only the BW stream, got ${streams.length}`)
    assert.strictEqual(streams[0].login, 'livebw')
    assert.strictEqual(streams[0].game, 'BW')
    assert.strictEqual(streams[0].platform, 'SOOP')
    assert.ok(streams[0].url.includes('livebw'))
  } finally {
    fs.writeFileSync(rosterFile, backup)
    http.get = realGet
  }
})

Promise.all(pending).then(() => console.log(`soop: ${pass} passed`))
