'use strict'

const { getLiquipedia } = require('./http')

/**
 * Bracket scraping for a single StarCraft tournament page.
 *
 * Markup contract (verified live against RSL_Revival/Season_6):
 *   div.brkts-bracket            — one per bracket (e.g. Playoffs, Group Stage)
 *   div.brkts-round-header       — sibling holding div.brkts-header per round
 *   div.brkts-match              — one match
 *   div.brkts-opponent-entry     — two per match; aria-label carries the name
 *     .brkts-opponent-win        — present on the winner's entry
 *     .brkts-opponent-score-inner— the score cell
 *   span.timer-object[data-timestamp] inside the match popup
 */

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

function firstMatch(s, re, g = 1) {
  const m = String(s || '').match(re)
  return m ? m[g] : ''
}

/**
 * Split `html` into one segment per occurrence of `marker`, where each
 * segment runs from its marker up to the NEXT marker (or end of input).
 * Returning the tail-to-next-marker slice is what keeps sibling elements
 * (e.g. the two opponents of a match) from collapsing into each other.
 */
function segments(html, marker) {
  const parts = String(html).split(marker)
  const out = []
  for (let i = 1; i < parts.length; i++) out.push(parts[i])
  return out
}

/** Segment, then trim each piece at the next occurrence of `stopAt`. */
function segmentsBounded(html, marker, stopAt) {
  return segments(html, marker).map((s) => s.split(stopAt)[0])
}

/**
 * Split a match block into its opponent entries.
 *
 * The opponent wrapper is `<div class="brkts-opponent-entry ...">` but it
 * CONTAINS `<div class="brkts-opponent-entry-left ...">`. Splitting on the
 * bare prefix therefore yields 4 fragments per match and silently duplicates
 * the first player. Match the wrapper's full opening tag instead.
 */
function splitOpponentEntries(block) {
  const re = /<div class="brkts-opponent-entry(?:-last)?[ "]/g
  const starts = []
  let m
  while ((m = re.exec(block)) !== null) starts.push(m.index)
  return starts.map((s, i) => block.slice(s, i + 1 < starts.length ? starts[i + 1] : block.length))
}

/** Wiki page titles carry underscores and disambiguators — clean for display. */
function displayName(raw) {
  return String(raw || '')
    .replace(/_/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}

function parseOpponent(entry) {
  const name =
    stripTags(firstMatch(entry, /aria-label="([^"]*)"/i)) ||
    stripTags(firstMatch(entry, /<span class="name"[^>]*>([\s\S]{0,200}?)<\/span>/i))
  // The win flag lives on the entry's own opening tag / left child, which is
  // within the first few hundred chars of the segment.
  const head = entry.slice(0, 400)
  return {
    name: displayName(name) || 'TBD',
    race: firstMatch(entry, /alt="(Terran|Zerg|Protoss|Random)"/i) || null,
    country: firstMatch(entry, /<span class="flag"><img alt="([^"]*)"/i) || null,
    score: stripTags(firstMatch(entry, /brkts-opponent-score-inner">([\s\S]{0,60}?)<\/div>/i)) || null,
    winner: /brkts-opponent-win/.test(head),
  }
}

/** Parse every bracket on a tournament page. */
function parseBrackets(html) {
  const brackets = []

  for (const bracketHtml of segments(html, '<div class="brkts-bracket"')) {
    // Stop at the next bracket wrapper so brackets don't bleed into each other.
    const body = bracketHtml.split('brkts-bracket-wrapper')[0]

    const rounds = [...body.matchAll(/<div class="brkts-header brkts-header-div"[^>]*>([^<]+)</gi)].map(
      (m) => stripTags(m[1]),
    )

    const matches = []
    for (const block of segmentsBounded(body, '<div class="brkts-match ', '<div class="brkts-match ')) {
      // NOTE: must anchor on `brkts-opponent-entry ` WITH the trailing space /
      // `-last`, otherwise the inner `brkts-opponent-entry-left` div also
      // matches and both opponents collapse into the same player.
      const entries = splitOpponentEntries(block)
      if (entries.length < 2) continue

      const o1 = parseOpponent(entries[0])
      const o2 = parseOpponent(entries[1])
      if (o1.name === 'TBD' && o2.name === 'TBD') continue

      const tsRaw = firstMatch(block, /data-timestamp="(\d+)"/i)
      matches.push({
        opponents: [o1, o2],
        finished: /data-finished="finished"/i.test(block),
        timestamp: tsRaw ? Number(tsRaw) * 1000 : null,
        score: `${o1.score ?? '-'}–${o2.score ?? '-'}`,
        winner: o1.winner ? o1.name : o2.winner ? o2.name : null,
      })
    }

    if (matches.length) brackets.push({ rounds, matches })
  }

  return brackets
}

/** Parse the simpler matchlist tables (group stages / weekly lists). */
function parseMatchlists(html) {
  const lists = []
  for (const body of segmentsBounded(html, 'brkts-matchlist ', 'brkts-matchlist ')) {
    const title = stripTags(firstMatch(body, /brkts-matchlist-title[^>]*>([\s\S]{0,200}?)<\/div>/i))
    const matches = []
    for (const row of segmentsBounded(body, 'brkts-matchlist-match', 'brkts-matchlist-match')) {
      const names = [...row.matchAll(/aria-label="([^"]*)"/gi)].map((m) => stripTags(m[1])).filter(Boolean)
      const scores = [...row.matchAll(/brkts-matchlist-score[^>]*>([\s\S]{0,80}?)<\/div>/gi)].map((m) =>
        stripTags(m[1]),
      )
      // aria-labels repeat (name + score cells share them); keep distinct order.
      const uniq = names.filter((n, i) => names.indexOf(n) === i).map(displayName)
      if (uniq.length < 2) continue
      matches.push({
        opponents: [
          { name: uniq[0], score: scores[0] ?? null },
          { name: uniq[1], score: scores[1] ?? null },
        ],
        score: `${scores[0] ?? '-'}–${scores[1] ?? '-'}`,
        winner:
          scores[0] != null && scores[1] != null && scores[0] !== scores[1]
            ? Number(scores[0]) > Number(scores[1])
              ? uniq[0]
              : uniq[1]
            : null,
      })
    }
    if (matches.length) lists.push({ title: title || 'Matches', matches })
  }
  return lists
}

/**
 * Fetch the brackets for one tournament.
 * @param {string} wiki   'starcraft2' | 'starcraft'  (BW slug is 'starcraft')
 * @param {string} page   wiki page title, e.g. 'RSL_Revival/Season_6'
 */
async function fetchBrackets(wiki, page) {
  const url =
    `https://liquipedia.net/${wiki}/api.php?action=parse` +
    `&page=${encodeURIComponent(page)}&format=json&prop=text`
  await throttle()
  const data = JSON.parse(await getLiquipedia(url))
  if (data.error) throw new Error(`${wiki}/${page}: ${data.error.info || data.error.code}`)
  const html = data && data.parse && data.parse.text && data.parse.text['*']
  if (!html) throw new Error(`${wiki}/${page}: empty parse payload`)
  return {
    page,
    wiki,
    brackets: parseBrackets(html),
    matchlists: parseMatchlists(html),
  }
}

/** Turn a Liquipedia tournament URL into {wiki, page}. */
function splitTournamentUrl(url) {
  const m = String(url || '').match(/liquipedia\.net\/([^/]+)\/([^?#]+)/i)
  if (!m) return null
  return { wiki: m[1], page: decodeURIComponent(m[2]) }
}

module.exports = {
  fetchBrackets,
  parseBrackets,
  parseMatchlists,
  splitTournamentUrl,
}
