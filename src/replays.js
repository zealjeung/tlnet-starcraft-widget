'use strict'

const http = require('./http')

/**
 * Recent Brood War replays from RepMastered (https://repmastered.icza.net/).
 *
 * Access reality (probed 2026-09-13):
 * - Front page (latest ~20 games, full detail table) is PUBLIC.
 * - ANY query string (?players=, ?matchup=, pagination) → login wall
 *   ("to fight bot traffic… requires Login"). Same for /game/{id} pages
 *   and replay downloads. /api/games → Unauthorized without a user token.
 * - The RSS feed (/games-rss.xml) is public but carries fewer fields, so the
 *   front-page table is the single source: fetch once, filter client-side.
 *
 * The tab therefore shows the latest games with a client-side player-name
 * filter, and each row links out to the site (filtered to those players)
 * where the user — logged in via their own browser — can Analyze/Get.
 * The widget never handles RepMastered creds.
 */

const BASE = 'https://repmastered.icza.net'

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse #gamesTable rows into compact replay objects.
 * Column layout (server-rendered, stable): 0:# 1:Title 2:Host 3:Date
 * 4:DateTime 5:Ago 6:Engine 7:Ladder 8:Map 9:MapName 12:Type 13:Length
 * 14:Matchup 15:Players 16:PlayerDesc 20:AvgAPM 21:Views 22:DLs
 */
function parseTable(html) {
  const out = []
  const table = html.match(/<table id="gamesTable">([\s\S]*?)<\/table>/i)
  if (!table) return out
  const rows = table[1].match(/<tr align="center"[\s\S]*?<\/tr>/gi) || []
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]))
    if (cells.length < 20) continue
    const players = cells[15] || ''
    // Split "A vs B" on the site's separator (emoji or text) into clean names,
    // then build the site's own quoted filter format: "A", "B".
    const names = players.split(/🆚|\bvs\.?\b/i).map((s) => s.trim()).filter(Boolean)
    const quoted = names.map((n) => `"${n}"`).join(', ')
    out.push({
      date: cells[4] || cells[3] || '',
      ago: cells[5] || '',
      map: cells[9] || cells[8] || '',
      matchup: cells[14] || '',
      players,
      desc: cells[16] || '',
      avgApm: cells[20] || '',
      length: cells[13] || '',
      ladder: cells[7] || '',
      views: cells[21] || '',
      // Deep link back to the site, filtered to these players (login there for download).
      url: `${BASE}/?players=${encodeURIComponent(quoted)}`,
    })
  }
  return out
}

/**
 * Fetch latest replays (front page only — the one public view), optionally
 * filtered client-side by player-name substring (case-insensitive).
 * @param {{players?: string}} filters
 * @returns {{replays: Array, errors: string[], url: string, total: number}}
 */
async function fetchReplays(filters = {}) {
  try {
    const html = await http.get(BASE + '/', http.BROWSER_UA, 20000, { attempts: 2 })
    const all = parseTable(html)
    const q = (filters.players || '').trim().toLowerCase()
    const replays = q ? all.filter((g) => g.players.toLowerCase().includes(q)) : all
    return { replays: replays.slice(0, 30), errors: [], url: BASE + '/', total: all.length }
  } catch (err) {
    return { replays: [], errors: [`repmastered: ${err.message}`], url: BASE + '/', total: 0 }
  }
}

module.exports = { fetchReplays, parseTable, BASE }
