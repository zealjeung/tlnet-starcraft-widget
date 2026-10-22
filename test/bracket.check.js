'use strict'
const fs = require('fs')
const path = require('path')
const { parseBrackets, parseMatchlists } = require('../src/brackets')

const fixturePath = path.join(__dirname, 'fixtures', 'rsl.json')
const d = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const html = d.parse.text['*']

const b = parseBrackets(html)
console.log('BRACKETS:', b.length)
b.forEach((br, i) => {
  console.log(`\n--- bracket ${i + 1} | rounds: ${br.rounds.join(' > ') || '(none)'}`)
  console.log(`    matches: ${br.matches.length}`)
  br.matches.slice(0, 6).forEach((m) => {
    const [a, c] = m.opponents
    const w = m.winner ? ` W:${m.winner}` : ''
    const when = m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 16) : 'TBD'
    console.log(`      ${a.name} ${m.score} ${c.name}  [${m.finished ? 'done' : 'pending'}] ${when}${w}`)
  })
})

const ml = parseMatchlists(html)
console.log('\nMATCHLISTS:', ml.length)
ml.slice(0, 3).forEach((l) => {
  console.log(` ${l.title} (${l.matches.length})`)
  l.matches.slice(0, 3).forEach((m) => console.log(`   ${m.opponents[0].name} ${m.score} ${m.opponents[1].name}`))
})
