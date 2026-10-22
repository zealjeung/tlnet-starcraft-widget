'use strict'
// GemYT — response cache (JSON file, max 100 entries)

const fs = require('fs')
const path = require('path')

const CACHE_FILE = () => path.join(__dirname, '..', '..', 'cache-gemyt.json')

function readCache() {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8'))
    return (d && typeof d === 'object' && Array.isArray(d.entries)) ? d : { entries: [] }
  } catch (_e) { return { entries: [] } }
}

function writeCache(c) {
  try { fs.writeFileSync(CACHE_FILE(), JSON.stringify(c, null, 2), 'utf8') } catch (_e) {}
}

function cacheKey(videoId, mode, question) {
  return `${videoId}|${mode}|${(question || '').trim().toLowerCase()}`
}

function getCached(videoId, mode, question) {
  const k = cacheKey(videoId, mode, question)
  const hit = readCache().entries.find((e) => e.key === k)
  return hit || null
}

function putCached(entry) {
  const c = readCache()
  c.entries = c.entries.filter((e) => e.key !== entry.key)
  c.entries.unshift(entry)
  c.entries = c.entries.slice(0, 100)
  writeCache(c)
  return entry
}

function listCached(limit = 20) {
  return readCache().entries.slice(0, limit).map((e) => ({
    key: e.key, videoId: e.videoId, url: e.url, mode: e.mode,
    label: e.label || '', model: e.model, at: e.at, ms: e.ms,
  }))
}

module.exports = { readCache, writeCache, cacheKey, getCached, putCached, listCached }
