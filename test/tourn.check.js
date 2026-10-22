'use strict'
const fs = require('fs')
const path = require('path')
const { parseMainPageMatches, parseTournaments } = require('../src/matches')

const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mp.json'), 'utf8'))
const html = d.parse.text['*']

const m = parseMainPageMatches(html, 'SC2')
console.log('MATCHES:', m.length)
for (const x of m.slice(0, 10)) {
  console.log(
    `  ${x.finished ? 'DONE' : x.live ? 'LIVE' : '    '} ${x.p1} (${x.race1 || '?'}) vs ${x.p2} (${x.race2 || '?'}) — ${x.tournament} — ${new Date(x.timestamp).toISOString().slice(0, 16)}`,
  )
}
const t = parseTournaments(html, 'SC2')
console.log('\nTOURNAMENTS:', t.length)
for (const x of t) console.log(`  [${x.status}] ${x.name}`)
