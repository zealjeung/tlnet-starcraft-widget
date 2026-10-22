'use strict'

const { getLiquipedia } = require('./http')

/**
 * ONLY these two wikis are ever queried. Adding a wiki here is the only way
 * a non-StarCraft game could enter the widget, so it stays hardcoded.
 * NOTE: the Brood War wiki slug is `starcraft` (not `brood_war`, which 404s).
 */
const WIKIS = [
  { wiki: 'starcraft2', game: 'SC2' },
  { wiki: 'starcraft', game: 'BW' },
]

const MATCH_PAGE = 'Liquipedia:Upcoming_and_ongoing_matches'
const MAIN_PAGE = 'Main_Page'

/** Liquipedia parse-API allows 1 request per 30s. */
const MIN_INTERVAL_MS = 31000
let lastRequestAt = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#95;/g, '_')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstMatch(s, re, group = 1) {
  const m = String(s || '').match(re)
  return m ? m[group] : ''
}

const CARD_MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Best-effort start-date extraction from a tournament card's visible text.
 *
 * Liquipedia no longer guarantees timer-objects on featured cards, but the
 * cards still print human dates — and without a timestamp the event can
 * never pin to the calendar grid (the whole point of the events tab).
 * Handles, in order:
 *  1. ISO-ish "2026-08-13 12:00:00 UTC" / "2026-08-13" (SC2 cards).
 *  2. Range starts "Nov 04 – TBA", "Aug 05 – Dec 06", "Aug 14" (BW cards).
 *     BW dates carry no year: assume the current year. Staleness is judged
 *     by the range END, not the start — a multi-month event that started
 *     weeks ago (Aug 05 – Dec 06) is still current. Same-month ends with no
 *     month repeat ("Aug 15–16") resolve to that month. A range whose end is
 *     more than 14 days past is over, and a lone date more than 14 days
 *     past is a dead card on a slow page: both return null so no phantom
 *     pin lands on the grid (they fall back to the Date TBA list).
 * Returns epoch ms, or null when no date is readable.
 */
function parseCardDate(text, nowMs) {
  const now = new Date(nowMs == null ? Date.now() : nowMs)
  // NOTE: stripTags() removes tags with no separator, gluing words together
  // ("W7Aug 14"). Restore a space before a month-like token only when it
  // opens a real date (month + day number), so words like "Mayhem" survive.
  const t = String(text || '').replace(/([A-Za-z\d])(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b)/gi, '$1 ')
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  }
  m = t.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i)
  if (m) {
    const mon = CARD_MONTHS[m[1].slice(0, 3).toLowerCase()]
    const startThisYear = new Date(Date.UTC(now.getUTCFullYear(), mon, +m[2]))
    // Range end after the start ("– Dec 06", "– Sep 19", "– TBA" = none).
    const rest = t.slice(t.indexOf(m[0]) + m[0].length)
    const em = rest.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i)
    // Same-month range end with no month repeat ("Aug 15–16"): bare day
    // after a dash. Guarded to 1–31 so counts like "50 players" can't match.
    const bare = !em && rest.match(/[–—-]\s*(\d{1,2})\b/)
    const emon = em ? CARD_MONTHS[em[1].slice(0, 3).toLowerCase()] : mon
    const eday = em ? +em[2] : bare ? +bare[1] : null
    if (eday != null && eday >= 1 && eday <= 31) {
      // Range may have started last year (Dec 30 – Jan 05 viewed in January:
      // the start in "this year" lies implausibly far in the future).
      let startYear = now.getUTCFullYear()
      if (startThisYear.getTime() > now.getTime() + 14 * 864e5) startYear -= 1
      const start = new Date(Date.UTC(startYear, mon, +m[2]))
      const end = new Date(Date.UTC(emon < mon ? startYear + 1 : startYear, emon, eday))
      if (end.getTime() < now.getTime() - 14 * 864e5) return null // over
      return start.getTime()
    }
    // Lone date, no range end. A stale one (>14 days past) is a dead card on
    // a slow page — not next year's event. Return null so it falls back to
    // the Date TBA list instead of a phantom pin a year out.
    if (startThisYear.getTime() < now.getTime() - 14 * 864e5) return null
    return startThisYear.getTime()
  }
  return null
}

async function parsePage(wiki, page) {
  const url =
    `https://liquipedia.net/${wiki}/api.php?action=parse` +
    `&page=${encodeURIComponent(page)}&format=json&prop=text`
  await throttle()
  const data = JSON.parse(await getLiquipedia(url))
  if (data.error) throw new Error(`${wiki}/${page}: ${data.error.info || data.error.code}`)
  const html = data && data.parse && data.parse.text && data.parse.text['*']
  if (!html) throw new Error(`${wiki}/${page}: empty parse payload`)
  return html
}

/* ------------------------------------------------------------------ *
 * Matches
 * ------------------------------------------------------------------ */

function parseMatches(html, game) {
  const out = []
  const tableRe = /<table[^>]*infobox&#95;matches&#95;content[^>]*>([\s\S]*?)<\/table>/gi
  let t
  while ((t = tableRe.exec(html)) !== null) {
    const block = t[1]
    const left = firstMatch(block, /<td class="team-left"[^>]*>([\s\S]*?)<\/td>/i)
    const right = firstMatch(block, /<td class="team-right"[^>]*>([\s\S]*?)<\/td>/i)
    if (!left && !right) continue

    const p1 = stripTags(left)
    const p2 = stripTags(right)
    if (!p1 && !p2) continue

    const tsRaw = firstMatch(block, /class="timer-object[^"]*"[^>]*data-timestamp="(\d+)"/i)
    const timestamp = tsRaw ? Number(tsRaw) * 1000 : null
    const tournBlock = firstMatch(block, /<div class="tournament-text-flex">([\s\S]*?)<\/div>/i)
    const tournHref = firstMatch(tournBlock, /href="([^"]+)"/i)
    const twitch = firstMatch(block, /Special:Stream\/twitch\/([A-Za-z0-9_]+)/i)

    out.push({
      game,
      p1: p1 || 'TBD',
      p2: p2 || 'TBD',
      race1: firstMatch(left, /alt="(Terran|Zerg|Protoss|Random)"/i) || null,
      race2: firstMatch(right, /alt="(Terran|Zerg|Protoss|Random)"/i) || null,
      bo: stripTags(firstMatch(block, /<div class="versus-lower">([\s\S]*?)<\/div>/i)).replace(/[()]/g, '') || null,
      timestamp,
      live: timestamp !== null && Date.now() >= timestamp && Date.now() - timestamp < 4 * 3600 * 1000,
      streamUrl: twitch ? `https://twitch.tv/${twitch}` : null,
      tournament: stripTags(tournBlock) || null,
      tournamentUrl: tournHref ? `https://liquipedia.net${tournHref}` : null,
    })
  }
  return out
}

/**
 * Parse matches from the MODERN `match-info` markup used on Main_Page.
 * The legacy `Liquipedia:Upcoming_and_ongoing_matches` page is served from a
 * multi-year-stale parser cache, so Main_Page is the live source.
 */
function parseMainPageMatches(html, game) {
  const out = []
  const blocks = html.split('<div class="match-info"').slice(1)
  for (const b of blocks) {
    const tsRaw = firstMatch(b, /data-timestamp="(\d+)"/i)
    if (!tsRaw) continue
    const finished = /data-finished="finished"/i.test(b)

    // Player names come from span.name (may be a link or bare TBD text).
    const names = [...b.matchAll(/<span class="name"[^>]*>([\s\S]{0,200}?)<\/span>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
    if (names.length < 2) continue

    const races = [...b.matchAll(/alt="(Terran|Zerg|Protoss|Random)"/gi)].map((m) => m[1])
    const tournName = stripTags(
      firstMatch(b, /<span class="match-info-tournament-name">([\s\S]{0,400}?)<\/span>\s*<\/span>/i),
    )
    const tournHref = firstMatch(b, /<span class="match-info-tournament-name">[\s\S]{0,200}?href="([^"]+)"/i)
    const twitch = firstMatch(b, /twitch\.tv\/([A-Za-z0-9_]+)/i)
    const timestamp = Number(tsRaw) * 1000

    out.push({
      game,
      p1: names[0] || 'TBD',
      p2: names[1] || 'TBD',
      race1: races[0] || null,
      race2: races[1] || null,
      bo: stripTags(firstMatch(b, /<abbr title="Best of \d+">([^<]+)<\/abbr>/i)) || null,
      timestamp,
      finished,
      live: !finished && Date.now() >= timestamp && Date.now() - timestamp < 4 * 3600 * 1000,
      streamUrl: twitch ? `https://twitch.tv/${twitch}` : null,
      tournament: tournName || null,
      tournamentUrl: tournHref ? `https://liquipedia.net${tournHref.replace(/&amp;/g, '&')}` : null,
    })
  }
  // de-dupe identical rows
  const seen = new Set()
  return out.filter((m) => {
    const k = `${m.game}|${m.p1}|${m.p2}|${m.timestamp}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Tournaments (from Main_Page — this payload is NOT stale)
 * ------------------------------------------------------------------ */

/**
 * Tournaments from Main_Page.
 *
 * Two different markup styles exist across the SC2 and BW wikis:
 *  - SC2: "Ongoing/Upcoming Featured Tournaments" panels; each card is a
 *    centered div with a timer-object (data-timestamp) + a wiki link.
 *  - BW:  "Ongoing"/"Upcoming" lists; each card is a
 *    `ul.tournaments-list-type-list > li` with `.tournament-name` (no timer,
 *    just a date-range string). No "Featured Tournaments" heading, no
 *    timer-object — so the SC2-only parser silently returned zero for BW.
 *
 * Both are parsed here. BW cards lack a precise timestamp, so we fall back to
 * the section status (ongoing/upcoming) with no countdown.
 */
function parseTournaments(html, game) {
  const out = []
  const seen = new Set()

  // --- SC2 style: centered cards with timer-objects ---
  const sc2 = parseSc2TournamentCards(html, game)
  sc2.forEach((t) => out.push(t))

  // --- BW style: list items with .tournament-name ---
  // Only relevant on the BW (starcraft) wiki. SC2 Featured Tournament cards also
  // contain `.tournament-name` spans, so running this on SC2 HTML would emit
  // duplicate entries whose href can't be resolved (bare wiki root), which then
  // fail bracket loading with "Not a liquipedia tournament URL".
  if (game === 'BW') {
    const bwRe = /<li>([\s\S]*?)<\/li>/gi
  let li
  const inSection = (idx) => {
    // Determine if this <li> sits under Ongoing or Upcoming by scanning
    // backwards for the nearest section heading text.
    const before = html.slice(Math.max(0, idx - 4000), idx)
    const ong = before.lastIndexOf('Ongoing')
    const up = before.lastIndexOf('Upcoming')
    if (ong > up) return 'ongoing'
    if (up > ong) return 'upcoming'
    return null
  }
  while ((li = bwRe.exec(html)) !== null) {
    const card = li[1]
    if (!/tournament-name/.test(card)) continue
    const nameM = card.match(/<span class="tournament-name">\s*<a[^>]*>([^<]*)<\/a>/i)
    const hrefM = card.match(/<a href="(\/[^"]+)"[^>]*title="[^"]*">\s*<img/i) || card.match(/<a href="(\/[^"]+)"[^>]*class="tournament-name"/i)
    if (!nameM) continue
    const name = stripTags(nameM[1])
    const status = inSection(li.index)
    if (!status) continue
    const key = `${game}|${name}`
    if (seen.has(key)) continue
    seen.add(key)
    // BW cards print a date range ("Aug 05 – Dec 06", "Nov 04 – TBA") but no
    // timer-object. Parse the range start so the event pins to the calendar.
    const cardText = stripTags(card)
    out.push({
      game,
      name,
      status,
      timestamp: parseCardDate(cardText),
      url: hrefM ? `https://liquipedia.net${hrefM[1]}` : null,
    })
  }
  }

  return out
}

/** SC2 "Featured Tournaments" centered-card parser (unchanged behavior). */
function parseSc2TournamentCards(html, game) {
  const out = []
  const seen = new Set()
  const marks = []
  const headRe = /(Upcoming|Ongoing) Featured Tournaments/gi
  let h
  while ((h = headRe.exec(html)) !== null) {
    marks.push({ status: h[1].toLowerCase(), at: h.index })
  }
  if (!marks.length) return out
  marks.sort((a, b) => a.at - b.at)

  const statusAt = (idx) => {
    let s = null
    for (const m of marks) {
      if (m.at <= idx) s = m.status
      else break
    }
    return s
  }

  const cardRe = /<div style="text-align:center">([\s\S]{0,2500}?)<\/span>\s*<\/div>/gi
  let c
  while ((c = cardRe.exec(html)) !== null) {
    const card = c[1]
    // NOTE (2026-09-16): Liquipedia dropped the timer-object from featured
    // cards — they now show trophy + winner instead of a countdown. The old
    // code required data-timestamp and silently returned zero SC2 events.
    // Timestamp is now optional, falling back to the printed card date
    // ("2026-08-13 12:00:00 UTC") so events still pin to the calendar.
    const tsRaw = firstMatch(card, /data-timestamp="(\d+)"/i)
    const cardText = stripTags(card)
    const tsFallback = tsRaw ? null : parseCardDate(cardText)
    const links = [...card.matchAll(/<a href="(\/[^"]+)"[^>]*>([^<]*)<\/a>/gi)]
    const named = links.find((m) => stripTags(m[2]).length > 1)
    if (!named) continue
    const status = statusAt(c.index)
    if (!status) continue
    const name = stripTags(named[2])
    const key = `${game}|${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      game,
      name,
      status,
      timestamp: tsRaw ? Number(tsRaw) * 1000 : tsFallback,
      url: `https://liquipedia.net${named[1]}`,
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Fetch matches AND tournaments (SC2 + BW wikis only) from Main_Page.
 *
 * One request per wiki serves both, which matters because the parse API is
 * rate-limited to 1 req/30s. Finished and past-dated matches are dropped —
 * a countdown to a date in the past is worse than showing nothing.
 */
async function fetchAll() {
  const matches = []
  const tournaments = []
  const errors = []
  // Keep upcoming + live matches, plus finished results from the last 3 days
  // so the tab shows recent scores, not just what's next.
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000

  for (const { wiki, game } of WIKIS) {
    try {
      const html = await parsePage(wiki, MAIN_PAGE)
      matches.push(
        ...parseMainPageMatches(html, game).filter(
          (m) =>
            (!m.finished && m.timestamp >= cutoff) || // upcoming within window
            (m.finished && m.timestamp >= cutoff), // recent results
        ),
      )
      tournaments.push(...parseTournaments(html, game))
    } catch (e) {
      errors.push(`${game}: ${e.message}`)
    }
  }

  matches.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return (a.timestamp || Infinity) - (b.timestamp || Infinity)
  })
  tournaments.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1
    return (a.timestamp || Infinity) - (b.timestamp || Infinity)
  })

  return { matches, tournaments, errors }
}

async function fetchMatches() {
  const { matches, errors } = await fetchAll()
  return { matches, errors }
}

async function fetchTournaments() {
  const { tournaments, errors } = await fetchAll()
  return { tournaments, errors }
}

/* ------------------------------------------------------------------ *
 * Cache guard: fetchAll/fetchChanges swallow per-wiki errors and return
 * empty-with-errors instead of throwing, so a failed refresh looks like a
 * successful empty one — and the old code overwrote last-known-good cache
 * with [] and blanked the tab. selectFreshOrCached keeps stale-good data
 * (flagged fromCache) when the fresh fetch failed; genuinely-empty
 * successful fetches (no errors) still pass through honestly.
 * ------------------------------------------------------------------ */
function selectFreshOrCached(fresh, errors, cached) {
  const hasFresh = Array.isArray(fresh) && fresh.length > 0
  const failed = Array.isArray(errors) && errors.length > 0
  const hasCached = Array.isArray(cached) && cached.length > 0
  if (!hasFresh && failed && hasCached) return { payload: cached, fromCache: true }
  return { payload: Array.isArray(fresh) ? fresh : [], fromCache: false }
}

module.exports = {
  fetchAll,
  fetchMatches,
  fetchTournaments,
  parseMatches,
  parseMainPageMatches,
  parseTournaments,
  parseCardDate,
  selectFreshOrCached,
  WIKIS,
  MIN_INTERVAL_MS,
}
