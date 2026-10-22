'use strict'

const http = require('./http')
const fs = require('fs')
const path = require('path')

/**
 * Live female StarCraft (BJ) streams on SOOP, organised by tier.
 *
 * SOOP exposes no directory/category listing API, so we poll a curated roster
 * of bjids (data/femsc.json) and keep every station that is currently
 * broadcasting (broad !== null). Category is tagged, not filtered — the tab
 * shows "who is live right now" and whether they are on StarCraft or not.
 *
 * Endpoint: GET https://chapi.sooplive.co.kr/api/{bjid}/station
 *   -> { station: { user_nick }, broad: null | {
 *        broad_no, broad_cate_no, broad_title, current_sum_viewer, is_password } }
 *
 * Broad category codes: 40001 = StarCraft (BW), 40016 = StarCraft II.
 * Dead IDs (404 / unknown BJ) are skipped silently.
 */

const STATION_API = 'https://chapi.sooplive.co.kr/api'
const CONCURRENCY = 6
const PER_REQUEST_MS = 12000
const SC_CATE_NOS = new Set([40001, 40016]) // BW + SC2

// Tier key -> label shown in the tab
const TIER_LABELS = {
  1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3',
  4: 'Tier 4', 5: 'Tier 5', 6: 'Tier 6-8 & Baby',
  custom: 'Custom',
}

const CUSTOM_FILE = path.join(__dirname, '..', 'data', 'femsc-custom.json')

function loadCustom() {
  try {
    const list = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'))
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : []
  } catch (_e) {
    return []
  }
}

function addCustom(bjid) {
  const list = loadCustom()
  if (!list.includes(bjid)) {
    list.push(bjid)
    fs.writeFileSync(CUSTOM_FILE, JSON.stringify(list, null, 2))
  }
  return list
}

function removeCustom(bjid) {
  const list = loadCustom().filter((x) => x !== bjid)
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify(list, null, 2))
  return list
}

function loadRoster() {
  const out = []
  try {
    const file = path.join(__dirname, '..', 'data', 'femsc.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const tier of Object.keys(data)) {
      for (const s of data[tier] || []) {
        if (s && s.bjid) out.push({ bjid: s.bjid, name: s.name || s.bjid, tier })
      }
    }
  } catch (_e) {
    /* base roster optional */
  }
  // user-added streamers (URL slot) — deduped against the base roster
  const seen = new Set(out.map((r) => r.bjid))
  for (const bjid of loadCustom()) {
    if (!seen.has(bjid)) {
      out.push({ bjid, name: bjid, tier: 'custom' })
      seen.add(bjid)
    }
  }
  return out
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
  const cate = Number(broad.broad_cate_no) || 0
  return {
    bjid,
    name: (data.station && data.station.user_nick) || bjid,
    title: broad.broad_title || '',
    viewers: Number(broad.current_sum_viewer) || 0,
    cate,
    isSC: SC_CATE_NOS.has(cate),
    url: `https://play.sooplive.com/${bjid}`,
    platform: 'SOOP',
  }
}

/**
 * Fetch live female SC streams from SOOP.
 * @returns {{streams: Array, errors: string[], configured: boolean}}
 */
async function fetchStreams() {
  const roster = loadRoster()
  if (!roster.length) {
    return { streams: [], errors: ['FemSC roster empty or missing (data/femsc.json)'], configured: false }
  }
  const streams = []
  const offline = []
  const errors = []
  let dead = 0
  for (let i = 0; i < roster.length; i += CONCURRENCY) {
    const batch = roster.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map((r) => fetchOne(r.bjid).then(
        (s) => ({ ok: true, stream: s, tier: r.tier, rosterName: r.name, bjid: r.bjid }),
        (err) => ({ ok: false, bjid: r.bjid, error: err }),
      )),
    )
    for (const res of results) {
      if (res.ok) {
        if (res.stream) {
          streams.push({
            ...res.stream,
            tier: res.tier,
            tierLabel: TIER_LABELS[res.tier] || `Tier ${res.tier}`,
            rosterName: res.rosterName,
            online: true,
          })
        } else {
          offline.push({
            bjid: res.bjid,
            name: res.rosterName,
            tier: res.tier,
            tierLabel: TIER_LABELS[res.tier] || `Tier ${res.tier}`,
            rosterName: res.rosterName,
            url: `https://play.sooplive.com/${res.bjid}`,
            online: false,
            platform: 'SOOP',
          })
        }
      } else if (res.error && (res.error.status === 404 || res.error.status === 515)) {
        dead += 1 // 404 = unknown BJ, 515 = deleted/renamed station
      } else {
        errors.push(`${res.bjid}: ${res.error.message}`)
      }
    }
  }
  if (dead) errors.push(`${dead} roster ID(s) dead (404/515) — check data/femsc.json`)
  streams.sort((a, b) => b.viewers - a.viewers)
  return { streams, offline, errors, configured: true }
}

module.exports = { fetchStreams, loadRoster, addCustom, removeCustom, loadCustom, TIER_LABELS }