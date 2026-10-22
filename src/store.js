'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Last-good disk cache + rolling log.
 *
 * Why the cache exists: at Windows login the widget starts before the network
 * is reliably up. Without a cache the first paint is empty and stays empty
 * until a refresh succeeds. With it, the widget paints last-known-good data
 * instantly and quietly upgrades when the network arrives.
 */

let baseDir = null
let logPath = null

function init(dir) {
  baseDir = dir
  logPath = path.join(dir, 'widget.log')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* best effort */
  }
}

const MAX_LOG_BYTES = 512 * 1024

function log(level, msg, extra) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`
  if (!logPath) return
  try {
    // Rotate rather than grow without bound.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.renameSync(logPath, logPath + '.1')
    }
    fs.appendFileSync(logPath, line)
  } catch {
    /* logging must never throw */
  }
}

function cacheFile(key) {
  return path.join(baseDir, `cache-${key}.json`)
}

/** Persist a successful payload as last-known-good. */
function write(key, payload) {
  if (!baseDir) return
  try {
    const tmp = cacheFile(key) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), payload }))
    fs.renameSync(tmp, cacheFile(key)) // atomic-ish: never leaves a half file
  } catch (e) {
    log('WARN', `cache write failed for ${key}`, { error: e.message })
  }
}

/**
 * Read last-known-good.
 * @returns {{savedAt:number, payload:any, ageMs:number}|null}
 */
function read(key, maxAgeMs = Infinity) {
  if (!baseDir) return null
  try {
    const f = cacheFile(key)
    if (!fs.existsSync(f)) return null
    const data = JSON.parse(fs.readFileSync(f, 'utf8'))
    const ageMs = Date.now() - data.savedAt
    if (ageMs > maxAgeMs) return null
    return { ...data, ageMs }
  } catch (e) {
    log('WARN', `cache read failed for ${key}`, { error: e.message })
    return null
  }
}

module.exports = { init, log, write, read, cacheFile }
