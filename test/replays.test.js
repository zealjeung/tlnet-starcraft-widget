'use strict'
const assert = require('node:assert')
const { fetchReplays, parseTable, BASE } = require('../src/replays')

let pass = 0
const pending = []
function t(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    pending.push(async () => {
      try { await fn(); pass++; console.log('ok -', name) }
      catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
    })
  } else {
    try { fn(); pass++; console.log('ok -', name) }
    catch (e) { console.error('FAIL -', name, '\n  ', e.message); process.exitCode = 1 }
  }
}

function row(cells) {
  const tds = cells.map((c) => `<td>${c}</td>`).join('')
  return `<tr align="center" class=" ">${tds}</tr>`
}
// columns: 0:# 1:Title 2:Host 3:Date 4:DateTime 5:Ago 6:Engine 7:Ladder
// 8:Map 9:MapName 10:Origin 11:Hash 12:Type 13:Length 14:Matchup 15:Players
// 16:Desc 17:APMs 18:EAPMs 19:Dirs 20:AvgAPM 21:Views 22:DLs
function gameRow(playerStr, matchup = 'PvT', apm = '100-200') {
  return row(['1', 't', 'h', '2026-09-13', '2026-09-13 00:00:01', '1h', 'BW', 'Blizzard',
    'm', 'Fighting Spirit 1.3', 'Blizz', 'hash', 'TvB', '12:34', matchup, playerStr,
    'desc', 'a', 'e', 'd', apm, '5', '2'])
}

t('parses rows to compact replay objects with deep links', () => {
  const html = `<table id="gamesTable"><tr><th>#</th></tr>${gameRow('Mini vs Bisu')}</table>`
  const out = parseTable(html)
  assert.strictEqual(out.length, 1)
  const g = out[0]
  assert.strictEqual(g.map, 'Fighting Spirit 1.3')
  assert.strictEqual(g.matchup, 'PvT')
  assert.strictEqual(g.length, '12:34')
  assert.strictEqual(g.avgApm, '100-200')
  assert.ok(g.url.startsWith(BASE + '/?players='), 'row links back to site search')
})

t('row links use the site quoted-players filter format', () => {
  const html = `<table id="gamesTable"><tr><th>#</th></tr>${gameRow('Mini vs Bisu')}</table>`
  const g = parseTable(html)[0]
  assert.strictEqual(
    g.url,
    'https://repmastered.icza.net/?players=' + encodeURIComponent('"Mini", "Bisu"'),
  )
  })

  t('skips short/malformed rows, empty table yields []', () => {
  assert.deepStrictEqual(parseTable('<table id="gamesTable"></table>'), [])
  assert.deepStrictEqual(parseTable('<p>no table</p>'), [])
  const html = `<table id="gamesTable"><tr><th>#</th></tr>${row(['1', 'x'])}${gameRow('A vs B')}</table>`
  assert.strictEqual(parseTable(html).length, 1)
})

t('client-side player filter is case-insensitive; empty query returns all', async () => {
  const http = require('../src/http')
  const realGet = http.get
  const html = `<table id="gamesTable"><tr><th>#</th></tr>${gameRow('Mini vs Bisu')}${gameRow('Jaedong vs Flash', 'ZvT')}</table>`
  http.get = async () => html
  try {
    const all = await fetchReplays({})
    assert.strictEqual(all.replays.length, 2)
    assert.strictEqual(all.total, 2)
    const mini = await fetchReplays({ players: 'MINI' })
    assert.strictEqual(mini.replays.length, 1)
    assert.ok(mini.replays[0].players.includes('Mini'))
    const none = await fetchReplays({ players: 'Nobody' })
    assert.strictEqual(none.replays.length, 0)
  } finally {
    http.get = realGet
  }
})

t('network failure returns errors, not a throw', async () => {
  const http = require('../src/http')
  const realGet = http.get
  http.get = async () => { throw new Error('HTTP 401 for ' + BASE) }
  try {
    const r = await fetchReplays({})
    assert.deepStrictEqual(r.replays, [])
    assert.ok(r.errors.length === 1 && r.errors[0].includes('401'))
  } finally {
    http.get = realGet
  }
})

// Async tests stub the shared http module, so they must run SEQUENTIALLY
// (Promise.all lets the stubs race and clobber each other).
;(async () => {
  for (const run of pending) await run()
  console.log(`replays: ${pass} passed`)
})()
