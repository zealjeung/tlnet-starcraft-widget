'use strict'
// GemYT — guardrails: budget, throttle, history cap, question validation, context caching

const { apiPost, apiDelete } = require('./transport')
const { resolveModel } = require('./models')
const { getKey } = require('./keys')

const GUARD = {
  MAX_HISTORY_TURNS: 12,
  MAX_QUESTION_CHARS: 2000,
  MAX_SESSION_TOKENS: 3000000,
  MIN_INTERVAL_MS: 1200,
  CACHE_TTL_SECONDS: 1800,
}

const _usage = { calls: 0, promptTokens: 0, cachedTokens: 0, outputTokens: 0, totalTokens: 0 }
let _lastCallAt = 0

function usageSnapshot() {
  return Object.assign({}, _usage, {
    estimatedBilledTokens: _usage.promptTokens - _usage.cachedTokens,
    budgetRemaining: Math.max(0, GUARD.MAX_SESSION_TOKENS - _usage.totalTokens),
    budgetPct: Math.round((_usage.totalTokens / GUARD.MAX_SESSION_TOKENS) * 100),
  })
}

function resetUsage() {
  _usage.calls = 0; _usage.promptTokens = 0; _usage.cachedTokens = 0
  _usage.outputTokens = 0; _usage.totalTokens = 0
}

function recordUsage(u) {
  if (!u) return
  _usage.calls += 1
  _usage.promptTokens += u.promptTokenCount || 0
  _usage.cachedTokens += u.cachedContentTokenCount || 0
  _usage.outputTokens += u.candidatesTokenCount || 0
  _usage.totalTokens += u.totalTokenCount || 0
}

function checkBudget() {
  if (_usage.totalTokens >= GUARD.MAX_SESSION_TOKENS) {
    return { ok: false, code: 'budget', error:
      'Session token budget reached (' + _usage.totalTokens.toLocaleString() +
      '). Restart the widget or raise GUARD.MAX_SESSION_TOKENS.' }
  }
  return { ok: true }
}

async function throttle() {
  const wait = _lastCallAt + GUARD.MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  _lastCallAt = Date.now()
}

function capHistory(history) {
  const h = Array.isArray(history) ? history.slice() : []
  const max = GUARD.MAX_HISTORY_TURNS * 2
  return h.length > max ? h.slice(h.length - max) : h
}

function checkQuestion(q) {
  const s = String(q || '').trim()
  if (!s) return { ok: false, code: 'no_question', error: 'Type a question first.' }
  if (s.length > GUARD.MAX_QUESTION_CHARS) {
    return { ok: false, code: 'too_long',
             error: 'Question too long (' + s.length + ' chars, max ' + GUARD.MAX_QUESTION_CHARS + ').' }
  }
  return { ok: true, text: s }
}

const _cacheRegistry = new Map()

async function ensureVideoCache(apiKey, videoUrl, videoId) {
  const hit = _cacheRegistry.get(videoId)
  if (hit && hit.expiresAt > Date.now() + 60000) return hit.name
  try {
    const body = {
      model: 'models/' + (await resolveModel(apiKey)),
      contents: [{ role: 'user', parts: [
        { file_data: { file_uri: videoUrl } },
        { text: 'Video reference for question answering.' },
      ] }],
      ttl: GUARD.CACHE_TTL_SECONDS + 's',
    }
    const res = await apiPost('/v1beta/cachedContents', apiKey, body, 120000)
    if (!res || !res.name) return null
    _cacheRegistry.set(videoId, { name: res.name, expiresAt: Date.now() + (GUARD.CACHE_TTL_SECONDS - 60) * 1000 })
    return res.name
  } catch (_e) { return null }
}

async function dropVideoCache(videoId) {
  const hit = _cacheRegistry.get(videoId)
  if (!hit) return false
  _cacheRegistry.delete(videoId)
  try { await apiDelete('/v1beta/' + hit.name, getKey()); return true } catch (_e) { return false }
}

module.exports = {
  GUARD, usageSnapshot, resetUsage, recordUsage, checkBudget, throttle,
  capHistory, checkQuestion, ensureVideoCache, dropVideoCache,
}
