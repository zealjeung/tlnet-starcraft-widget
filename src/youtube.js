'use strict'

const { get, BROWSER_UA } = require('./http')
const fs = require('fs')
const path = require('path')

/**
 * Live YouTube streams for the caster roster, quota-safe.
 *
 * Needs YOUTUBE_API_KEY in the widget .env (same pattern as Twitch creds).
 * Without it: { configured:false } and the tab just skips YouTube.
 *
 * Design (quota math matters — search.list costs 100 units/call, so polling
 * 20 channels with it would burn the 10,000/day free quota in ~5 refreshes):
 *   1. Per channel: latest 2 items of the uploads playlist
 *      (playlist ID = channel ID with UC→UU; 1 unit per channel).
 *   2. Videos published in the last 36h go into ONE batched videos.list call
 *      (1 quota unit for up to 50 ids): keep those whose
 *      snippet.liveBroadcastContent === 'live', viewers from
 *      liveStreamingDetails.concurrentViewers.
 *
 * (Channel RSS feeds would be free, but YouTube 500s them from this network —
 *  verified 2026-09-13 — so the uploads playlist is the discovery path.)
 * Cost per refresh: ~18 quota units. Safe at any sane cadence.
 *
 * roster field: data/casters.json entries carry `youtube` = UC channel ID.
 */

const YT = 'https://www.googleapis.com/youtube/v3'

function loadKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY.trim()
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*YOUTUBE_API_KEY\s*=\s*(.*?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '').trim()
    }
  } catch (_e) { /* no .env */ }
  return ''
}

function loadRoster() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'casters.json'), 'utf8'))
    return (Array.isArray(list) ? list : []).filter((c) => c && c.youtube && /^UC[\w-]{20,}$/.test(c.youtube))
  } catch (_e) {
    return []
  }
}

function newestVideoIds(items, maxAgeH = 36, max = 2) {
  // playlistItems shape: [{ contentDetails: { videoId }, }]
  const now = Date.now()
  const vids = []
  for (const it of items || []) {
    const vid = it.contentDetails && it.contentDetails.videoId
    const pub = it.contentDetails && it.contentDetails.videoPublishedAt
    if (!vid || !pub) continue
    const ageH = (now - Date.parse(pub)) / 36e5
    if (ageH >= 0 && ageH <= maxAgeH) vids.push(vid)
    if (vids.length >= max) break
  }
  return vids
}

/**
 * Fetch live YouTube streams for rostered casters.
 * @returns {{streams: Array, errors: string[], configured: boolean}}
 */
async function fetchStreams() {
  const key = loadKey()
  const roster = loadRoster()
  if (!key) {
    return { streams: [], errors: ['YOUTUBE_API_KEY not set in .env — YouTube skipped'], configured: false }
  }
  if (!roster.length) {
    return { streams: [], errors: ['no youtube channel IDs in data/casters.json'], configured: false }
  }
  const errors = []
  const byId = {}
  for (const c of roster) {
    try {
      // Uploads playlist ID = channel ID with the UC prefix swapped to UU.
      const pl = 'UU' + c.youtube.slice(2)
      const raw = await get(
        `${YT}/playlistItems?part=contentDetails&playlistId=${pl}&maxResults=5&key=${key}`,
        BROWSER_UA, 15000, { attempts: 2 },
      )
      for (const vid of newestVideoIds(JSON.parse(raw).items)) byId[vid] = c
    } catch (err) {
      errors.push(`${c.name} uploads: ${err.message}`)
    }
  }
  const ids = Object.keys(byId)
  if (!ids.length) return { streams: [], errors, configured: true }
  let items = []
  try {
    const raw = await get(
      `${YT}/videos?part=snippet,liveStreamingDetails&id=${ids.join(',')}&key=${key}`,
      BROWSER_UA, 15000, { attempts: 2 },
    )
    items = JSON.parse(raw).items || []
  } catch (err) {
    // Surface Google's own message (quota, IP restriction, bad key) verbatim
    // so the user can act on it instead of seeing a generic failure.
    return { streams: [], errors: [...errors, `videos.list: ${err.message}`], configured: true }
  }
  const streams = []
  for (const it of items) {
    if (!it.snippet || it.snippet.liveBroadcastContent !== 'live') continue
    const c = byId[it.id]
    const cv = it.liveStreamingDetails && it.liveStreamingDetails.concurrentViewers
    streams.push({
      login: c.name,
      name: `${c.name} (${it.snippet.channelTitle || c.name})`,
      title: it.snippet.title || '',
      viewers: cv ? parseInt(cv, 10) : 0,
      thumbnail: (it.snippet.thumbnails && it.snippet.thumbnails.default && it.snippet.thumbnails.default.url) || '',
      url: `https://www.youtube.com/watch?v=${it.id}`,
      platform: 'YouTube',
      game: 'OTHER',
      caster: true,
    })
  }
  return { streams, errors, configured: true }
}

module.exports = { fetchStreams, loadKey, loadRoster, newestVideoIds }
