'use strict'

/**
 * StarCraft-only content filter.
 *
 * TL.net news items carry their game section in the URL path:
 *   https://tl.net/forum/<section>/<id>-<slug>
 * Verified sections in the live feed: starcraft-2, sc2-tournaments,
 * brood-war, bw-tournaments, games.
 *
 * `games` is a generic catch-all that sometimes holds SC content (e.g. a
 * Clem interview) and sometimes does not, so it is NOT allowlisted outright
 * — it must earn inclusion via a keyword match on the title.
 */

const ALLOWED_SECTIONS = new Set([
  'starcraft-2',
  'sc2-tournaments',
  'sc2-strategy',
  'brood-war',
  'bw-tournaments',
  'bw-strategy',
])

/** Sections that may contain SC content but need a keyword to qualify. */
const AMBIGUOUS_SECTIONS = new Set(['games', 'general', 'community', 'tl-community'])

/** Lowercase keywords that mark an ambiguous item as StarCraft-related. */
const SC_KEYWORDS = [
  'starcraft', 'sc2', 'sc:bw', 'brood war', 'broodwar', 'bw ',
  'zerg', 'terran', 'protoss', 'zvp', 'zvt', 'tvp', 'tvz', 'pvz', 'pvt', 'tvt', 'zvz', 'pvp',
  'gsl', 'asl', 'ksl', 'bsl', 'iem katowice', 'homestory', 'wardi', 'esl pro tour', 'ept',
  'serral', 'clem', 'maru', 'reynor', 'dark', 'rogue', 'byun', 'herO', 'trap', 'flash',
  'blizzard', 'ladder', 'balance patch', 'balance hotfix', 'aligulac',
]

/** Explicit blocklist — other esports titles that must never appear. */
const BLOCKED_KEYWORDS = [
  'counter-strike', 'counterstrike', 'cs2', 'csgo', 'cs:go',
  'dota', 'league of legends', 'valorant', 'overwatch', 'rocket league',
  'apex legends', 'fortnite', 'hearthstone', 'heroes of the storm',
  'pubg', 'rainbow six', 'call of duty', 'smash', 'tekken', 'street fighter',
  'warcraft iii', 'warcraft 3', 'age of empires', 'teamfight tactics',
]

function sectionOf(link) {
  if (typeof link !== 'string') return ''
  const m = link.match(/tl\.net\/forum\/([^/?#]+)/i)
  return m ? m[1].toLowerCase() : ''
}

function containsAny(haystack, needles) {
  const s = String(haystack || '').toLowerCase()
  return needles.some((n) => s.includes(n))
}

/**
 * Decide whether a TL.net news item is StarCraft/Brood War related.
 * @param {{title?: string, link?: string, category?: string}} item
 * @returns {boolean}
 */
function isStarCraftItem(item) {
  if (!item) return false
  const title = item.title || ''
  const section = sectionOf(item.link)

  // Hard block: another esport named explicitly, unless an SC section owns it.
  const blocked = containsAny(title, BLOCKED_KEYWORDS)
  if (blocked && !ALLOWED_SECTIONS.has(section)) return false

  if (ALLOWED_SECTIONS.has(section)) return true
  if (AMBIGUOUS_SECTIONS.has(section)) return containsAny(title, SC_KEYWORDS)

  // Unknown section: only admit on an explicit StarCraft keyword.
  if (!section) return containsAny(title, SC_KEYWORDS)
  return false
}

/** Lowercase title markers that identify Brood War regardless of section. */
const BW_TITLE_MARKERS = ['brood war', 'broodwar', 'sc:bw', 'asl ', 'bsl ', 'ksl ', 'ipsl']

/** Label an item for the UI badge. Title markers win over section. */
function gameOf(item) {
  const title = String((item && item.title) || '').toLowerCase()
  if (BW_TITLE_MARKERS.some((k) => title.includes(k))) return 'BW'

  const section = sectionOf(item && item.link)
  if (section.startsWith('bw') || section === 'brood-war') return 'BW'
  if (section.startsWith('sc2') || section === 'starcraft-2') return 'SC2'
  return 'SC'
}

function filterNews(items) {
  return (items || []).filter(isStarCraftItem).map((it) => ({ ...it, game: gameOf(it) }))
}

module.exports = {
  ALLOWED_SECTIONS,
  AMBIGUOUS_SECTIONS,
  SC_KEYWORDS,
  BLOCKED_KEYWORDS,
  sectionOf,
  isStarCraftItem,
  gameOf,
  filterNews,
}
