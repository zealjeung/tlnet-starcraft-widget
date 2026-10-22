'use strict'

const { get } = require('./http')

/**
 * Build-order feed from spawningtool (lotv.spawningtool.com) — the community
 * SC2 build-order database. Liquipedia 403s our UA on its Build_Orders page,
 * and Reddit/other "trending" sources are bot-walled, so spawningtool is the
 * one free, reachable source with real, structured build orders.
 *
 * "Trending" proxy: spawningtool has no popularity endpoint, so we sort by the
 * entry's "Updated" date (newest first) — the closest honest signal to what's
 * current. Each entry also carries a win-rate % and vote count, surfaced as a
 * quality hint.
 */

const BASE = 'https://lotv.spawningtool.com'

function parseDate(s) {
  if (!s) return null
  const m = String(s).match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/)
  if (!m) return null
  const t = Date.parse(m[1])
  return isNaN(t) ? null : t
}

function parseEntries(html, matchup) {
  const out = []
  // Each entry is anchored by an <a href="/build/<id>/">. The name + metadata
  // follow (possibly after <img> tags), so grab a fixed window and parse text.
  const re = /href="(\/build\/(\d+)\/)"[^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const id = m[2]
    const afterTag = html.indexOf('>', m.index) + 1
    const seg = html.slice(afterTag, afterTag + 700).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!seg || seg.length < 4) continue

    const name = (seg.split(' Created by')[0] || '').trim()
    if (!name) continue
    const creatorM = seg.match(/Created by ([^,]+)/i)
    const creator = creatorM ? creatorM[1].trim() : null
    const updM = seg.match(/Updated ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/i)
    const updated = parseDate(updM ? updM[1] : null)
    const diffM = seg.match(/(Easy|Medium|Hard)/i)
    const difficulty = diffM ? diffM[1] : null
    const wrM = seg.match(/(\d+)%/)
    const winrate = wrM ? Number(wrM[1]) : null
    const vM = seg.match(/(\d+)\s*votes?/i)
    const votes = vM ? Number(vM[1]) : null
    // derive matchup from the name text (e.g. "Harstem 5.0.16 PvT ...") — the
    // page lists all matchups under /pvx/, so the name carries the real MU.
    const muM = name.match(/\b(Pv[PTZ]|Tv[TPZ]|Zv[ZTP])\b/i)
    const mu = muM ? muM[1].toUpperCase() : String(matchup || '').toUpperCase()

    out.push({
      id,
      name,
      creator,
      matchup: mu,
      difficulty,
      updated,
      winrate,
      votes,
      url: BASE + `/build/${id}/`,
    })
  }

  const seen = new Set()
  const dedup = out.filter((b) => (seen.has(b.id) ? false : seen.add(b.id)))
  dedup.sort((a, b) => (b.updated || 0) - (a.updated || 0))
  return dedup
}

async function fetchBuildOrders(matchup = 'pvx') {
  const mu = String(matchup || 'pvx').toLowerCase()
  const url = `${BASE}/build/${mu}/`
  const html = await get(url, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  })
  return parseEntries(html, mu)
}

module.exports = { fetchBuildOrders, parseEntries }
