'use strict'
const assert = require('node:assert')
const { parseNewsXml, fetchNewsAggregate, fetchTlNews } = require('../src/news')

const fs = require('fs')
const path = require('path')
const tlXml = fs.readFileSync(path.join(__dirname, 'fixtures', 'tl-news.xml'), 'utf8')

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

t('parseNewsXml extracts items with timestamps', () => {
  const all = parseNewsXml(tlXml)
  assert.ok(all.length >= 10, `expected >=10 items, got ${all.length}`)
  assert.ok(all.every((i) => i.title && i.link), 'every item needs title+link')
})

t('TL.net items carry source=TL.net', async () => {
  const items = await fetchTlNews()
  assert.ok(items.length > 0)
  assert.ok(items.every((i) => i.source === 'TL.net'), 'source must be set')
})

t('aggregate merges TL.net + Liquipedia and sorts newest-first', async () => {
  const r = await fetchNewsAggregate()
  assert.ok(r.items.length > 0, 'aggregate returned nothing')
  assert.ok(r.sources && typeof r.sources.tl === 'number' && typeof r.sources.liquipedia === 'number',
    'sources breakdown missing')
  for (let i = 1; i < r.items.length; i++) {
    assert.ok((r.items[i - 1].timestamp || 0) >= (r.items[i].timestamp || 0), 'not sorted')
  }
  assert.ok(r.items.every((i) => i.source && i.game), 'item missing source/game')
})

Promise.all(pending).then(() => console.log(`\n${pass} passed`))

