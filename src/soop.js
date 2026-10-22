'use strict'

const http = require('./http')
const fs = require('fs')
const path = require('path')

/**
 * Live Brood War streams via SOOP's public station API (no credentials needed).
 *
 * SOOP exposes no directory/category listing API, so we poll a curated roster
 * of progamer station IDs and keep only broadcasts whose category is exactly
 * StarCraft (BW). The category gate is what keeps non-game content out:
 * a BJ streaming variety/dancing/other games reports a different
 * `broad_cate_no` and is dropped, no title heuristics involved.
 *
 * Endpoint: GET https://chapi.sooplive.co.kr/api/{bjid}/station
 *   -> { station: { user_nick }, broad: null | {
 *        broad_no, broad_cate_no, broad_title, current_sum_viewer, is_password } }
 *
 * Category codes come from SOOP's broad_category.js table:
 *   40001 = StarCraft (BW) — the ONLY accepted value.
 *   40016 = StarCraft II (rejected: this tab is BW-only).
 *
 * Roster lives in data/soop-bjs.json (Liquipedia SOOP table + manual adds).
 * Dead IDs (404 / unknown BJ) are skipped silently; chronic 404s should be
 * pruned from the roster, not special-cased here.
 */

const STATION_API = 'https://chapi.sooplive.co.kr/api'
const BW_CATE_NO = 40001
const CONCURRENCY = 6
const PER_REQUEST_MS = 12000

function loadRoster() {
  try {
    const file = path.join(__dirname, '..', 'data', 'soop-bjs.json')
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(list) ? list.filter((r) => r && r.bjid) : []
  } catch (_e) {
    return []
  }
}

async function fetchOne(bjid) {
  const raw = await http.get(`${STATION_API}/${encodeURIComponent(bjid)}/station`, http.BROWSER_UA, PER_REQUEST_MS, { attempts: 2 })
  let data
  try {
    data = JSON.parse(raw)
  } catch (_e) {
    throw new Error(`bad JSON for ${bjid}`)
  }
  const broad = data && data.broad
  if (!broad) return null // offline
  if (Number(broad.broad_cate_no) !== BW_CATE_NO) return null // not BW gameplay
  const nick = (data.station && data.station.user_nick) || bjid
  return {
    login: bjid,
    name: `${nick} (${userLabel(bjid)})`,
    title: broad.broad_title || '',
    viewers: Number(broad.current_sum_viewer) || 0,
    thumbnail: data.profile_image ? `https:${data.profile_image}` : '',
    url: `https://play.sooplive.com/${bjid}`,
    game: 'BW',
    platform: 'SOOP',
    locked: broad.is_password === true,
  }
}

// Roster display name lookup, set by fetchStreams before polling.
let _names = null
function userLabel(bjid) {
  if (_names && _names[bjid]) return _names[bjid]
  return bjid
}

/**
 * Fetch live BW streams from SOOP.
 * @returns {{streams: Array, errors: string[], configured: boolean}}
 */
async function fetchStreams() {
  const roster = loadRoster()
  if (!roster.length) {
    return { streams: [], errors: ['SOOP roster empty or missing (data/soop-bjs.json)'], configured: false }
  }
  _names = {}
  roster.forEach((r) => { _names[r.bjid] = r.player || r.bjid })
  const streams = []
  const errors = []
  let dead = 0
  for (let i = 0; i < roster.length; i += CONCURRENCY) {
    const batch = roster.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map((r) => fetchOne(r.bjid).then(
        (s) => ({ ok: true, stream: s }),
        (err) => ({ ok: false, bjid: r.bjid, error: err }),
      )),
    )
    for (const res of results) {
      if (res.ok) {
        if (res.stream) streams.push(res.stream)
      } else if (res.error && (res.error.status === 404 || res.error.status === 515)) {
        dead += 1 // 404 = unknown BJ, 515 = deleted/renamed station
      } else {
        errors.push(`${res.bjid}: ${res.error.message}`)
      }
    }
  }
  if (dead) errors.push(`${dead} roster ID(s) dead (404/515) — prune data/soop-bjs.json`)
  streams.sort((a, b) => b.viewers - a.viewers)
  return { streams, errors, configured: true }
}

module.exports = { fetchStreams, loadRoster, BW_CATE_NO, STATION_API }
