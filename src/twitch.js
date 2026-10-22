'use strict'

const { get } = require('./http')
const fs = require('fs')
const path = require('path')

/**
 * Live StarCraft streams via the Twitch Helix API.
 *
 * Twitch removed all unauthenticated stream listing in 2023-24: the v5 API,
 * the no-token GQL directory, and the legacy streams endpoint all now return
 * 401. The ONLY durable path is Helix with a Client-ID + OAuth token:
 *   GET https://api.twitch.tv/helix/streams?game_id=<id>&first=100
 *
 * Credentials come from .env (TWITCH_CLIENT_ID / TWITCH_TOKEN) — never code,
 * never committed. Without them the module returns an empty list with a clear
 * error so the tab shows "set up credentials" instead of crashing.
 *
 * Twitch game IDs (stable as of 2026-08; SC2's old id 490283 was retired —
 * 490422 is current). Brood War has no standalone category; BW casters stream
 * under the base "StarCraft" category (11989), which is what we pull for BW.
 */

const GAME_IDS = [
  { id: '490422', game: 'SC2', name: 'StarCraft II' },
  { id: '11989', game: 'BW', name: 'StarCraft' },
]

// Caster roster: followed logins are checked directly (any category), so a
// caster streaming variety/other games is still captured, tagged by game.
function loadCasters() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'casters.json'), 'utf8'))
    return Array.isArray(list) ? list.filter((c) => c && c.twitch) : []
  } catch (_e) {
    return []
  }
}

function gameForId(id) {
  const g = GAME_IDS.find((x) => x.id === id)
  return g ? g.game : 'OTHER'
}

const HELIX = 'https://api.twitch.tv/helix/streams'

// Cache the env once; .env lives next to the app.
let _env = null
function loadEnv() {
  const file = path.join(__dirname, '..', '.env')
  const out = { clientId: process.env.TWITCH_CLIENT_ID || '', token: process.env.TWITCH_TOKEN || '' }
  try {
    const txt = fs.readFileSync(file, 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const k = m[1]
      let v = m[2].replace(/^["']|["']$/g, '')
      if (k === 'TWITCH_CLIENT_ID') out.clientId = v
      if (k === 'TWITCH_TOKEN') out.token = v
    }
  } catch (_e) {
    // no .env — fall back to process.env only
  }
  // Only memoize once we actually have creds; otherwise re-read next time
  // (lets tests / late .env edits take effect without a restart).
  if (out.clientId && out.token) _env = out
  return out
}

function haveCreds() {
  const e = loadEnv()
  return Boolean(e.clientId && e.token)
}

async function fetchGame(gameId, clientId, token) {
  const url = `${HELIX}?game_id=${gameId}&first=100&type=live`
  const headers = {
    'Client-Id': clientId,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  // rawGet doesn't support custom headers, so use the lower-level https here.
  const https = require('https')
  const data = await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers, timeout: 20000 },
      (res) => {
        if (res.statusCode !== 200) {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () =>
            reject(new Error(`Twitch Helix ${res.statusCode}: ${body.slice(0, 200)}`)),
          )
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    req.on('timeout', () => req.destroy(new Error('Twitch Helix timeout')))
    req.on('error', reject)
  })
  const json = JSON.parse(data)
  return (json.data || []).map((s) => ({
    login: s.user_login,
    name: s.user_name,
    title: s.title || '',
    viewers: s.viewer_count || 0,
    thumbnail: (s.thumbnail_url || '').replace('{width}', '80').replace('{height}', '45'),
    url: `https://twitch.tv/${s.user_login}`,
    platform: 'Twitch',
    gameId: s.game_id || '',
  }))
}

/**
 * Fetch live streams for the caster roster, ANY category (one Helix call,
 * up to 100 logins). Caster rows are tagged caster:true + resolved game.
 */
async function fetchCasterStreams(clientId, token) {
  const roster = loadCasters()
  if (!roster.length) return []
  const byLogin = {}
  roster.forEach((c) => { byLogin[String(c.twitch).toLowerCase()] = c.name })
  const qs = roster.map((c) => `user_login=${encodeURIComponent(c.twitch)}`).join('&')
  const url = `${HELIX}?${qs}&first=100&type=live`
  const https = require('https')
  const data = await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeout: 20000 },
      (res) => {
        if (res.statusCode !== 200) {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => reject(new Error(`Twitch roster ${res.statusCode}: ${body.slice(0, 120)}`)))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    req.on('timeout', () => req.destroy(new Error('Twitch roster timeout')))
    req.on('error', reject)
  })
  const json = JSON.parse(data)
  return (json.data || []).map((s) => ({
    login: s.user_login,
    name: `${byLogin[String(s.user_login).toLowerCase()] || s.user_name} (${s.user_name})`,
    title: s.title || '',
    viewers: s.viewer_count || 0,
    thumbnail: (s.thumbnail_url || '').replace('{width}', '80').replace('{height}', '45'),
    url: `https://twitch.tv/${s.user_login}`,
    platform: 'Twitch',
    game: gameForId(s.game_id),
    caster: true,
  }))
}

/**
 * Fetch live SC2 + BW streams.
 * @returns {{streams: Array, errors: string[], configured: boolean}}
 */
async function fetchStreams() {
  const e = loadEnv()
  if (!haveCreds()) {
    return {
      streams: [],
      errors: ['TWITCH_CLIENT_ID and TWITCH_TOKEN not set in .env'],
      configured: false,
    }
  }
  const all = []
  const errors = []
  for (const g of GAME_IDS) {
    try {
      const list = await fetchGame(g.id, e.clientId, e.token)
      list.forEach((s) => (s.game = g.game))
      all.push(...list)
    } catch (err) {
      errors.push(`${g.game}: ${err.message}`)
    }
  }
  // Caster roster (any category). Prefer the caster-tagged row on duplicates.
  try {
    const seen = new Set(all.map((s) => String(s.login).toLowerCase()))
    for (const s of await fetchCasterStreams(e.clientId, e.token)) {
      const k = String(s.login).toLowerCase()
      if (seen.has(k)) {
        const ix = all.findIndex((x) => String(x.login).toLowerCase() === k)
        if (ix >= 0) { all[ix] = { ...all[ix], caster: true, name: s.name }; continue }
      }
      seen.add(k)
      all.push(s)
    }
  } catch (err) {
    errors.push(`casters: ${err.message}`)
  }
  all.sort((a, b) => b.viewers - a.viewers)
  return { streams: all, errors, configured: true }
}

module.exports = { fetchStreams, haveCreds, GAME_IDS, loadEnv, loadCasters, fetchCasterStreams }
