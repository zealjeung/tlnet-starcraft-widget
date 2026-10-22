'use strict'

const { getBrowser, getLiquipedia, isLiquipediaBlocked } = require('./http')
const { filterNews } = require('./filter')
const { fetchChanges, isRelevant, parseAtom, feedUrl, WIKIS } = require('./changes')

const NEWS_URL = 'https://tl.net/rss/news.xml'

// How far back Liquipedia edits count as "news" in the News tab.
const CHANGES_DAYS_MS = 3 * 24 * 3600 * 1000

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decodeEntities(m[1]) : ''
}

/** Parse the TL.net news RSS into plain item objects. */
function parseNewsXml(xml) {
  const items = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    const b = m[1]
    const pub = tag(b, 'pubDate')
    const ts = pub ? Date.parse(pub) : NaN
    items.push({
      title: tag(b, 'title'),
      link: tag(b, 'link'),
      author: tag(b, 'dc:creator') || tag(b, 'author'),
      category: tag(b, 'category'),
      pubDate: pub,
      timestamp: Number.isNaN(ts) ? null : ts,
    })
  }
  return items
}

/** Fetch TL.net news, StarCraft/Brood War only, tagged source='TL.net'. */
async function fetchTlNews() {
  const xml = await getBrowser(NEWS_URL)
  const all = parseNewsXml(xml)
  const kept = filterNews(all)
  kept.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  return kept.map((i) => ({ ...i, source: 'TL.net', game: i.game || 'SC' }))
}

/**
 * Liquipedia recent-changes, repackaged as news items so the News tab isn't a
 * single slow editorial trickle. TL.net posts ~1 item per several days; the
 * Liquipedia pulse updates hourly. Tagged source='Liquipedia' so the UI can
 * show where each item came from. Only edits from the last CHANGES_DAYS_MS
 * survive (older wiki churn isn't "news").
 */
async function fetchLiquipediaNews() {
  const out = []
  const seen = new Set()
  for (const { wiki, game, api } of WIKIS) {
    try {
      const xml = await getLiquipedia(feedUrl(api))
      for (const c of parseAtom(xml)) {
        if (!isRelevant(c.title)) continue
        if (Date.now() - c.ts > CHANGES_DAYS_MS) continue
        const key = `${wiki}|${c.title}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          title: c.title,
          link: c.url,
          author: c.author || 'Liquipedia',
          category: 'community',
          timestamp: c.ts,
          source: 'Liquipedia',
          game,
        })
      }
    } catch (e) {
      // non-fatal — TL.net still carries the tab
    }
  }
  return out
}

/**
 * Aggregate news: TL.net editorial + Liquipedia community pulse, merged and
 * sorted newest-first. This is what the News tab renders, so it has real
 * hourly cadence instead of a multi-day gap between TL.net posts.
 */
async function fetchNewsAggregate() {
  const tl = await fetchTlNews().catch(() => [])
  // Liquipedia is PULL-ONLY — skip entirely when blocked (no timer-driven requests).
  const lp = isLiquipediaBlocked() ? [] : await fetchLiquipediaNews().catch(() => [])
  const items = [...tl, ...lp].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  return {
    items,
    totalFetched: tl.length + lp.length,
    filteredOut: 0,
    sources: { tl: tl.length, liquipedia: lp.length },
  }
}

module.exports = {
  fetchNews: fetchTlNews,
  fetchTlNews,
  fetchLiquipediaNews,
  fetchNewsAggregate,
  parseNewsXml,
  NEWS_URL,
}
