'use strict'

const https = require('https')
const zlib = require('zlib')

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// Liquipedia's API terms require a descriptive, contactable User-Agent.
const LIQUIPEDIA_UA = 'HermesTLWidget/1.0 (personal desktop widget; StarCraft only)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Status codes worth retrying: rate limits, transient server/proxy faults. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
/** Network-level errors that are transient (DNS not up yet at login, etc.). */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
])

class HttpError extends Error {
  constructor(status, url, retryAfterMs) {
    super(`HTTP ${status} for ${url}`)
    this.status = status
    this.retryAfterMs = retryAfterMs || null
    this.retryable = RETRYABLE_STATUS.has(status)
  }
}

function parseRetryAfter(value) {
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const when = Date.parse(value)
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null
}

function rawGet(url, userAgent, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects: ${url}`))
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': userAgent,
          'Accept-Encoding': 'gzip, deflate',
          Accept: '*/*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(rawGet(new URL(res.headers.location, url).href, userAgent, timeoutMs, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new HttpError(res.statusCode, url, parseRetryAfter(res.headers['retry-after'])))
        }
        const enc = (res.headers['content-encoding'] || '').toLowerCase()
        const stream =
          enc === 'gzip' ? res.pipe(zlib.createGunzip())
          : enc === 'deflate' ? res.pipe(zlib.createInflate())
          : res
        const chunks = []
        stream.on('data', (c) => chunks.push(c))
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        stream.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`)))
    req.on('error', reject)
  })
}

function isRetryable(err) {
  if (err instanceof HttpError) return err.retryable
  if (err && RETRYABLE_CODES.has(err.code)) return true
  return /timeout/i.test(err && err.message ? err.message : '')
}

/**
 * GET with exponential backoff.
 *
 * Boot-time matters here: at Windows login the network stack is often not up
 * yet, so DNS/connect errors are expected and MUST be retried rather than
 * leaving the widget permanently blank until the next scheduled refresh.
 * A server-sent `Retry-After` always wins over our own backoff.
 */
async function get(url, userAgent, timeoutMs = 20000, opts = {}) {
  const attempts = opts.attempts ?? 3
  const baseDelay = opts.baseDelay ?? 2000
  const maxDelay = opts.maxDelay ?? 30000
  let lastErr

  for (let i = 0; i < attempts; i++) {
    try {
      return await rawGet(url, userAgent, timeoutMs)
    } catch (err) {
      lastErr = err
      const last = i === attempts - 1
      if (last || !isRetryable(err)) break
      const backoff = Math.min(baseDelay * 2 ** i, maxDelay)
      const jitter = Math.floor(Math.random() * 400)
      const wait = err instanceof HttpError && err.retryAfterMs != null ? err.retryAfterMs : backoff + jitter
      log('WARN', 'http retry', { attempt: i + 1, wait, error: err.message, url })
      if (typeof opts.onRetry === 'function') opts.onRetry({ attempt: i + 1, wait, error: err })
      await sleep(wait)
    }
  }
  throw lastErr
}

// Raw-bytes variant (for images) — no UTF-8 decode of the payload.
async function getBytes(url, userAgent, timeoutMs = 30000, opts = {}) {
  const attempts = opts.attempts ?? 3
  const baseDelay = opts.baseDelay ?? 2000
  const maxDelay = opts.maxDelay ?? 30000
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await rawGetBytes(url, userAgent, timeoutMs)
    } catch (err) {
      lastErr = err
      const last = i === attempts - 1
      if (last || !isRetryable(err)) break
      const backoff = Math.min(baseDelay * 2 ** i, maxDelay)
      const jitter = Math.floor(Math.random() * 400)
      const wait = err instanceof HttpError && err.retryAfterMs != null ? err.retryAfterMs : backoff + jitter
      await sleep(wait)
    }
  }
  throw lastErr
}

function rawGetBytes(url, userAgent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'gzip, deflate', Accept: 'image/*' }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(rawGetBytes(new URL(res.headers.location, url).href, userAgent, timeoutMs))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new HttpError(res.statusCode, url, parseRetryAfter(res.headers['retry-after'])))
        }
        const enc = (res.headers['content-encoding'] || '').toLowerCase()
        const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res
        const chunks = []
        stream.on('data', (c) => chunks.push(c))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`)))
    req.on('error', reject)
  })
}

const getBrowser = (url, opts) => get(url, BROWSER_UA, 20000, opts)

// Injectable logger — main.js wires this to store.log after init.
let _logger = null
function setLogger(fn) { _logger = typeof fn === 'function' ? fn : null }
function log(level, msg, data) { if (_logger) _logger(level, msg, data) }
// Hard kill-switch: when active, NO Liquipedia requests are made at all.
// Single source of truth: lqForceBlock, set via setLiquipediaBlocked().
// Checked at the single chokepoint so every call site is covered.
let lqForceBlock = false
let lqGen = 0
function setLiquipediaBlocked(on) {
  lqForceBlock = !!on
  if (lqForceBlock) {
    // Bump generation so in-flight calls can detect they're stale.
    // Do NOT poison lqChain — that would reject the NEXT call after unblock.
    lqGen++
    log('INFO', 'liquipedia blocked')
  } else {
    log('INFO', 'liquipedia unblocked')
  }
}
function blockedLiquipedia() {
  const e = new Error('Liquipedia fetching is disabled')
  e.status = 403
  return e
}
// Liquipedia Terms of Use: MediaWiki API ≤ 1 req / 2s, and `action=parse`
// (used for players/lore/tournaments) ≤ 1 req / 30s (flagged resource-heavy).
// We serialize through two queues: a base 2s queue for everything, and a slower
// 30s queue for parse calls. A 429 extends a cooldown so a warm IP recovers
// instead of every tab hanging on "Loading…".
let lqChain = Promise.resolve()
let lqLast = 0
let lqCooldownUntil = 0
const LQ_GAP_MS = 2000
const LQ_PARSE_GAP_MS = 30000
const LQ_COOLDOWN_MS = 60000
let lqParseChain = Promise.resolve()
let lqParseLast = 0
function isParseCall(url) {
  return /[?&]action=parse\b/.test(url)
}
function getLiquipedia(url, opts) {
  if (lqForceBlock) return Promise.reject(blockedLiquipedia())
  if (isParseCall(url)) {
    const gen = lqGen
    const run = async () => {
      if (lqForceBlock || gen !== lqGen) throw blockedLiquipedia()
      const now = Date.now()
      // Parse is heavy (1/30s) BUT still counts against the global MediaWiki
      // 1 req / 2s rule, so gate on both queues.
      const wait = Math.max(LQ_PARSE_GAP_MS - (now - lqParseLast), LQ_GAP_MS - (now - lqLast), lqCooldownUntil - now)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lqParseLast = Date.now()
      lqLast = lqParseLast
      try {
        return await get(url, LIQUIPEDIA_UA, 30000, opts)
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) {
          lqCooldownUntil = Date.now() + LQ_COOLDOWN_MS
          log('WARN', 'liquipedia 429 cooldown', { until: new Date(lqCooldownUntil).toISOString() })
        }
        throw e
      }
    }
    const p = lqParseChain.then(run)
    lqParseChain = p.catch(() => {})
    return p
  }
  const gen = lqGen
  const run = async () => {
    if (lqForceBlock || gen !== lqGen) throw blockedLiquipedia()
    const now = Date.now()
    const wait = Math.max(LQ_GAP_MS - (now - lqLast), lqCooldownUntil - now)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lqLast = Date.now()
    try {
      return await get(url, LIQUIPEDIA_UA, 30000, opts)
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        lqCooldownUntil = Date.now() + LQ_COOLDOWN_MS
        log('WARN', 'liquipedia 429 cooldown', { until: new Date(lqCooldownUntil).toISOString() })
      }
      throw e
    }
  }
  const p = lqChain.then(run)
  lqChain = p.catch(() => {})
  return p
}

// Same queue, but returns raw bytes (for thumbnail images).
function getLiquipediaBytes(url, opts) {
  if (lqForceBlock) return Promise.reject(blockedLiquipedia())
  const gen = lqGen
  const run = async () => {
    if (lqForceBlock || gen !== lqGen) throw blockedLiquipedia()
    const now = Date.now()
    const wait = Math.max(LQ_GAP_MS - (now - lqLast), lqCooldownUntil - now)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lqLast = Date.now()
    try {
      return await getBytes(url, LIQUIPEDIA_UA, 30000, opts)
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        lqCooldownUntil = Date.now() + LQ_COOLDOWN_MS
        log('WARN', 'liquipedia 429 cooldown', { until: new Date(lqCooldownUntil).toISOString() })
      }
      throw e
    }
  }
  const p = lqChain.then(run)
  lqChain = p.catch(() => {})
  return p
}

function isLiquipediaBlocked() { return lqForceBlock }
module.exports = { get, getBytes, getBrowser, getLiquipedia, getLiquipediaBytes, setLiquipediaBlocked, isLiquipediaBlocked, setLogger, BROWSER_UA, LIQUIPEDIA_UA, HttpError, isRetryable }
