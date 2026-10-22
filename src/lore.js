'use strict'

const { getLiquipedia } = require('./http')

/**
 * SC / SC2 lore shelf. A curated catalog of Liquipedia lore/faction/character/
 * campaign pages (verified to resolve via api.php). Each entry carries a
 * Liquipedia page title; clicking fetches the lead paragraph + infobox image
 * for a short writeup, plus a link to the full page.
 *
 * Why curated (not free-search): Liquipedia's lore is spread across faction,
 * character, war and campaign pages with no single "stories" index. A fixed,
 * verified list gives a clean shelf; live search can be added later.
 */

const LORE = [
  { title: 'Terran', group: 'Faction' },
  { title: 'Protoss', group: 'Faction' },
  { title: 'Zerg', group: 'Faction' },
  { title: 'Terran Dominion', group: 'Faction' },
  { title: 'United Earth Directorate', group: 'Faction' },
  { title: 'The Great War', group: 'Conflict' },
  { title: 'The Brood War', group: 'Conflict' },
  { title: 'Amon', group: 'Character' },
  { title: 'Sarah Kerrigan', group: 'Character' },
  { title: 'Jim Raynor', group: 'Character' },
  { title: 'Artanis', group: 'Character' },
  { title: 'Zeratul', group: 'Character' },
  { title: 'Campaign/Sky Shield', group: 'Campaign' },
  { title: 'Campaign/The Host', group: 'Campaign' },
]

function apiUrl(title) {
  return `https://liquipedia.net/starcraft2/api.php?action=parse&page=${encodeURIComponent(
    title,
  )}&prop=text&format=json&formatversion=2`
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#91;|&#93;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPhoto(html, title) {
  const imgs = [
    ...html.matchAll(/<img[^>]+src="(\/commons\/images\/thumb\/[^"]+)"[^>]*>/g),
  ].map((m) => m[1])
  if (!imgs.length) return null
  const t = (title || '').toLowerCase().split(' ')[0]
  const named = imgs.find((s) => t && s.toLowerCase().includes(t))
  const big = imgs.find((s) => /1200px-|900px-|600px-/.test(s)) || imgs[0]
  const pick = named || big
  return pick ? `https://liquipedia.net${pick}` : null
}

function extractDesc(html) {
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((s) => s.length > 40)
  return ps.length ? ps[0] : null
}

async function fetchLore(title) {
  if (!title) return { error: 'empty' }
  let json
  try {
    json = JSON.parse(await getLiquipedia(apiUrl(title)))
  } catch (e) {
    return { error: 'fetch-failed', message: e.message }
  }
  if (json.error) {
    if (json.error.code === 'missingtitle') return { error: 'not-found', title }
    return { error: 'api-error', code: json.error.code }
  }
  const html = json.parse && json.parse.text ? json.parse.text : ''
  if (!html) return { error: 'empty' }
  const name = json.parse.title || title
  return {
    name,
    title,
    photo: extractPhoto(html, name),
    desc: extractDesc(html),
    url: `https://liquipedia.net/starcraft2/${encodeURIComponent(title)}`,
  }
}

function listLore() {
  return LORE.map((l) => ({
    name: l.title.split('/').pop().replace(/_/g, ' '),
    title: l.title,
    group: l.group,
    url: `https://liquipedia.net/starcraft2/${encodeURIComponent(l.title)}`,
  }))
}

module.exports = { fetchLore, listLore, LORE }
