'use strict'
const assert = require('node:assert')
const { isStarCraftItem, gameOf, filterNews } = require('../src/filter')

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

const news = (title, link) => ({ title, link: `https://tl.net/forum/${link}/1-slug` })

console.log('StarCraft filter')

t('admits starcraft-2 section', () => {
  assert.equal(isStarCraftItem(news('Serral wins HSC 29', 'starcraft-2')), true)
})

t('admits sc2-tournaments and bw-tournaments', () => {
  assert.equal(isStarCraftItem(news('SC4ALL II announced', 'sc2-tournaments')), true)
  assert.equal(isStarCraftItem(news('BSL Season 22', 'bw-tournaments')), true)
})

t('admits brood-war section', () => {
  assert.equal(isStarCraftItem(news('ASL finals', 'brood-war')), true)
})

t('rejects other esports outright', () => {
  for (const [title, sec] of [
    ['ESL Pro League CS2 Grand Final', 'counterstrike'],
    ['The International Dota 2 recap', 'dota-2'],
    ['Worlds 2026: League of Legends', 'league-of-legends'],
    ['Valorant Champions', 'valorant'],
    ['Heroes of the Storm returns', 'games'],
  ]) {
    assert.equal(isStarCraftItem(news(title, sec)), false, `should reject: ${title}`)
  }
})

t('rejects unknown section without SC keyword', () => {
  assert.equal(isStarCraftItem(news('Site maintenance notice', 'general')), false)
  assert.equal(isStarCraftItem(news('Random blog post', 'tl-community')), false)
})

t('rescues SC content from the ambiguous games section', () => {
  assert.equal(isStarCraftItem(news('Clem: I don\'t have hope in Blizzard', 'games')), true)
  assert.equal(isStarCraftItem(news('Serral takes the title', 'games')), true)
})

t('a CS title inside an SC section still counts as SC', () => {
  // e.g. "SC2 pro tries Counter-Strike" posted in starcraft-2
  assert.equal(isStarCraftItem(news('SC2 pro tries Counter-Strike', 'starcraft-2')), true)
})

t('badges BW by title marker even in an sc2 section', () => {
  assert.equal(gameOf(news('SC4ALL II: Brood War - $2500', 'sc2-tournaments')), 'BW')
  assert.equal(gameOf(news('[IPSL] Spring Grand Finals', 'starcraft-2')), 'BW')
  assert.equal(gameOf(news('Weekly Cups: Protoss rise', 'starcraft-2')), 'SC2')
})

t('filterNews strips non-SC and attaches a game badge', () => {
  const input = [
    news('Serral wins HSC 29', 'starcraft-2'),
    news('CS2 Major recap', 'counterstrike'),
    news('BSL Season 22 Conclusion', 'bw-tournaments'),
    news('Dota 2 patch notes', 'dota-2'),
  ]
  const out = filterNews(input)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((o) => o.game).sort(), ['BW', 'SC2'])
  assert.ok(out.every((o) => !/cs2|dota/i.test(o.title)))
})

t('handles malformed items without throwing', () => {
  assert.equal(isStarCraftItem(null), false)
  assert.equal(isStarCraftItem({}), false)
  assert.equal(isStarCraftItem({ title: 'x', link: 'not a url' }), false)
})

console.log(`\n${pass} passed${process.exitCode ? ' (with failures)' : ''}`)
