'use strict'

const { getLiquipedia, LIQUIPEDIA_UA } = require('./http')

/**
 * Hourly-fresh StarCraft activity via Liquipedia's Recent Changes feed.
 *
 * Why this, not TL.net: TL.net's RSS caps out several days behind and its
 * HTML site is 403 to bots, so it can't be a live source. Liquipedia's
 * `feedrecentchanges` API returns per-wiki wiki edits (tournament pages,
 * results, brackets being filled in) timestamped to the minute — this is the
 * closest thing to a real-time SC news pulse.
 *
 * The Atom entry shape (verified live):
 *   <entry>
 *     <title>PcEc Cup/12</title>
 *     <link rel="alternate" href="https://liquipedia.net/starcraft2/..."/>
 *     <updated>2026-08-09T04:39:23Z</updated>
 *     <author><name>SomeUser</name></author>
 *   </entry>
 *
 * We only keep SC-relevant edits: skip user pages, talk pages, and anything
 * whose title doesn't look like a match/tournament (contains a slash or a
 * known tournament keyword). Raw page titles like "Zhang Yu Miao Cup/Group
 * Stage" are shown as-is — they ARE the news ("group stage being played now").
 */

const WIKIS = [
  { wiki: 'starcraft2', game: 'SC2', api: 'https://liquipedia.net/starcraft2/api.php' },
  { wiki: 'starcraft', game: 'BW', api: 'https://liquipedia.net/starcraft/api.php' },
]

const DAYS = 2
const PER_WIKI = 40

function feedUrl(api) {
  const p = new URLSearchParams({
    action: 'feedrecentchanges',
    feedformat: 'atom',
    days: String(DAYS),
    limit: String(PER_WIKI),
  })
  return `${api}?${p.toString()}`
}

function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]+>/g, '').trim()
}

/** A change is "news" if it's about a tournament/match, not a user/talk page. */
function isRelevant(title) {
  if (!title) return false
  if (/^(User|Talk|User talk|Template|Category|File|Help|Portal):/i.test(title)) return false
  // Tournament/match pages almost always carry a slash (Event/Stage) or a
  // known competition word. Pure article titles (e.g. "Protoss") are noise.
  return /\//.test(title) || /\b(cup|league|open|series|major|minor|invitational|championship|showdown|bout|weekly|satellite|qualifier|stage|group|playoff|final|masters|trophy|festival|classic|proleague)\b/i.test(title)
}

function parseAtom(xml) {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || []
  const out = []
  for (const e of entries) {
    const title = stripTags((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
    const updated = (e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || ''
    const author = stripTags((e.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/) || [])[1] || '')
    if (!title || !updated) continue
    out.push({ title, url: link, ts: Date.parse(updated), author })
  }
  return out
}

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

async function fetchChanges() {
  const items = []
  const errors = []
  const seen = new Set()

  for (const { wiki, game, api } of WIKIS) {
    try {
      const xml = await getLiquipedia(feedUrl(api))
      for (const c of parseAtom(xml)) {
        if (!isRelevant(c.title)) continue
        const key = `${wiki}|${c.title}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ game, title: c.title, url: c.url, ts: c.ts, author: c.author, age: relativeTime(c.ts) })
      }
    } catch (e) {
      errors.push(`${game}: ${e.message}`)
    }
  }

  items.sort((a, b) => b.ts - a.ts)
  return { items, errors }
}

module.exports = { fetchChanges, parseAtom, isRelevant, relativeTime, feedUrl, WIKIS }
