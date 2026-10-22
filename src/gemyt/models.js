'use strict'
// GemYT — model resolution and retry logic

const { apiPost, apiGet, API_BASE } = require('./transport')

const MODEL_PREFERENCE = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
]

const RETRY_BACKOFF = [1000, 2000, 4000, 8000, 16000]
const RETRY_MAX_WAIT_MS = 60000
const RETRY_TOTAL_CAP_MS = 120000
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

function isRetryable(status) {
  if (status === undefined || status === null || status === '') return true
  if (typeof status === 'string' && !/^\d+$/.test(status)) return true
  return RETRYABLE_STATUS.has(Number(status))
}

function backoffDelay(attempt) {
  const base = RETRY_BACKOFF[Math.min(attempt, RETRY_BACKOFF.length - 1)]
  const jitter = Math.floor(Math.random() * 400) - 200
  return Math.max(250, Math.min(RETRY_MAX_WAIT_MS, base + jitter))
}

let _lastRequestAt = 0
let _lastRequestMs = 0
let _inflight = false

function requestTiming() {
  return {
    lastRequestAt: _lastRequestAt,
    lastRequestMs: _lastRequestMs,
    inflight: _inflight,
    sinceLastMs: _lastRequestAt ? Date.now() - _lastRequestAt : null,
  }
}

let _modelCache = null

async function listModels(apiKey) {
  const d = await apiGet(`${API_BASE}?pageSize=200`, apiKey)
  return (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
}

async function resolveModel(apiKey, { force = false } = {}) {
  if (_modelCache && !force) return _modelCache
  const available = new Set(await listModels(apiKey))
  const candidates = MODEL_PREFERENCE.filter((m) => available.has(m))
  for (const m of available) {
    if (!candidates.includes(m) && /flash/.test(m)) candidates.push(m)
  }
  if (!candidates.length) throw new Error('no Gemini flash model available on this key')
  for (const m of candidates) {
    try {
      const r = await apiPost(
        `${API_BASE}/${m}:generateContent`,
        apiKey,
        { contents: [{ parts: [{ text: 'reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 8 } },
        30000,
      )
      const txt = firstText(r)
      if (txt) { _modelCache = m; return m }
    } catch (_e) {}
  }
  _modelCache = candidates[0]
  return _modelCache
}

function firstText(resp) {
  const cands = (resp && resp.candidates) || []
  for (const c of cands) {
    for (const p of ((c.content && c.content.parts) || [])) {
      if (typeof p.text === 'string' && p.text.trim()) return p.text.trim()
    }
  }
  return ''
}

let _candCache = null

async function modelCandidates(apiKey, { force = false } = {}) {
  if (_candCache && !force) return _candCache
  const available = new Set(await listModels(apiKey))
  const out = MODEL_PREFERENCE.filter((m) => available.has(m))
  for (const m of available) {
    if (!out.includes(m) && /flash/.test(m) && !/image|tts/.test(m)) out.push(m)
  }
  _candCache = out.length ? out : ['gemini-flash-latest']
  return _candCache
}

async function streamWithRetry(models, apiKey, makeBody, timeoutMs, onChunk) {
  let lastErr = null
  const deadline = Date.now() + RETRY_TOTAL_CAP_MS
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi]
    for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt++) {
      if (attempt > 0) {
        if (Date.now() >= deadline) throw lastErr || new Error('retry deadline exceeded')
        const wait = Math.min(backoffDelay(attempt - 1), Math.max(0, deadline - Date.now()))
        if (onChunk && onChunk.keepAlive) { try { onChunk.keepAlive() } catch (_e) {} }
        await new Promise((r) => setTimeout(r, wait))
      }
      try {
        _inflight = true
        _lastRequestAt = Date.now()
        let attemptText = ''
        const sink = (chunk) => {
          if (chunk) { attemptText += chunk; if (onChunk) onChunk(chunk) }
        }
        const r = await apiStream(
          `${API_BASE}/${model}:streamGenerateContent?alt=sse`,
          apiKey, makeBody(), timeoutMs, sink,
        )
        _lastRequestMs = Date.now() - _lastRequestAt
        _inflight = false
        return { text: r.text, usage: r.usage, ms: r.ms, model, attempt: attempt + 1 }
      } catch (e) {
        _inflight = false
        _lastRequestMs = Date.now() - _lastRequestAt
        lastErr = e
        if (!isRetryable(e.status)) throw e
      }
    }
  }
  throw lastErr || new Error('all models failed')
}

module.exports = {
  MODEL_PREFERENCE, RETRY_BACKOFF, RETRY_MAX_WAIT_MS, RETRY_TOTAL_CAP_MS, RETRYABLE_STATUS,
  isRetryable, backoffDelay, requestTiming, listModels, resolveModel, firstText,
  modelCandidates, streamWithRetry,
}
