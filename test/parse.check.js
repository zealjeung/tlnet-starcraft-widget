'use strict'
const fs = require('fs')
const path = require('path')
const { parseMatches } = require('../src/matches')
const { parseNewsXml } = require('../src/news')
const { filterNews } = require('../src/filter')

const lp = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lp.json'), 'utf8'))
const m = parseMatches(lp.parse.text['*'], 'SC2')
console.log('MATCHES PARSED:', m.length)
console.log(JSON.stringify(m.slice(0, 4), null, 1))

const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'news.xml'), 'utf8')
const all = parseNewsXml(xml)
const kept = filterNews(all)
console.log('\nNEWS parsed:', all.length, 'kept:', kept.length)
for (const k of kept) console.log(' ', k.game, '|', k.title.slice(0, 60))
const dropped = all.filter((a) => !kept.find((k) => k.link === a.link))
console.log('DROPPED:', dropped.map((d) => d.title.slice(0, 50)))
