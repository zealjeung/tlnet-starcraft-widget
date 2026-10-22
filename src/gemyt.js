'use strict'
/**
 * GemYT — Gemini video analysis for the TL.net widget.
 *
 * Facade module: re-exports from gemyt/ submodules.
 * See gemyt/keys.js, gemyt/transport.js, gemyt/cache.js, gemyt/models.js, gemyt/budget.js
 */

const { getKey, haveKey, resetKeyCache, readDotEnv, readVaultKey } = require('./gemyt/keys')
const { apiPost, apiGet, apiStream, apiDelete, API_HOST, API_BASE } = require('./gemyt/transport')
const { getCached, putCached, listCached, cacheKey } = require('./gemyt/cache')
const {
  MODEL_PREFERENCE, RETRY_BACKOFF, RETRY_MAX_WAIT_MS, RETRY_TOTAL_CAP_MS, RETRYABLE_STATUS,
  isRetryable, backoffDelay, requestTiming, listModels, resolveModel, firstText,
  modelCandidates, streamWithRetry,
} = require('./gemyt/models')
const {
  GUARD, usageSnapshot, resetUsage, recordUsage, checkBudget, throttle,
  capHistory, checkQuestion, ensureVideoCache, dropVideoCache,
} = require('./gemyt/budget')

const DEFAULT_TIMEOUT_MS = 300000

const MODES = {
  summary: 'Summarize this video. Cover: who/what/when, the overall arc, and end with a one-line watch-or-skip verdict. Be concise — no filler.',
  moments: 'List the key moments in this video. For each: a timestamp in MM:SS format, then one short line on why it matters. Order chronologically. 5-12 moments.',
  buildorders: 'Extract the build orders shown in this video, per player, grouped by matchup. Give timestamps (MM:SS) where each build is demonstrated or discussed. If no build orders are present, say so plainly.',
  strategy: 'Explain the strategic decisions in this video. What did the winning side do differently, and at which timestamps did the game turn? Cite MM:SS.',
  qa: '',
}

const MODE_LABELS = {
  summary: 'Summary',
  moments: 'Key moments',
  buildorders: 'Build orders',
  strategy: 'Strategy',
  qa: 'Q&A',
}

function parseYouTubeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let m = s.match(/(?:youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/)
  if (m) return { id: m[1], url: 'https://www.youtube.com/watch?v=' + m[1] }
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (m) return { id: m[1], url: 'https://www.youtube.com/watch?v=' + m[1] }
  m = s.match(/youtube\.com\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})/)
  if (m) return { id: m[1], url: 'https://www.youtube.com/watch?v=' + m[1] }
  return null
}

async function analyze(url, mode = 'summary', opts = {}) {
  const v = parseYouTubeUrl(url)
  if (!v) return { ok: false, code: 'bad_url', error: 'Not a recognisable YouTube URL.' }
  const m = MODES[mode] === undefined ? 'summary' : mode
  const question = (opts.question || '').trim()
  if (m === 'qa' && !question) return { ok: false, code: 'no_question', error: 'Q&A mode needs a question.' }
  const prompt = m === 'qa' ? question : MODES[m]
  if (!opts.force) {
    const hit = getCached(v.id, m, question)
    if (hit) return { ok: true, text: hit.text, model: hit.model, cached: true, usage: hit.usage || null, ms: hit.ms, label: hit.label || '' }
  }
  const key = getKey()
  if (!key) return { ok: false, code: 'no_key', error: 'No Gemini API key. Add GEMINI_API_KEY=vault://GEMINI_API_KEY to the widget .env.' }
  let model
  try { model = await resolveModel(key) } catch (e) { return { ok: false, code: 'no_model', error: e.message } }
  const t0 = Date.now()
  try {
    const resp = await apiPost(
      API_BASE + '/' + model + ':generateContent', key,
      { contents: [{ parts: [{ file_data: { file_uri: v.url } }, { text: prompt }] }] },
      opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    )
    const text = firstText(resp)
    const ms = Date.now() - t0
    if (!text) {
      const fin = ((resp.candidates || [])[0] || {}).finishReason || 'no text'
      return { ok: false, code: 'empty', error: 'Gemini returned no text (' + fin + ').' }
    }
    const usage = resp.usageMetadata || null
    const entry = putCached({ key: cacheKey(v.id, m, question), videoId: v.id, url: v.url, mode: m, question, text, model, usage, ms, at: Date.now(), label: opts.label || '' })
    return { ok: true, text, model, cached: false, usage, ms, label: entry.label }
  } catch (e) {
    return { ok: false, code: 'api', status: e.status, error: e.message, model }
  }
}

async function analyzeStream(url, mode = 'summary', opts = {}) {
  const v = parseYouTubeUrl(url)
  if (!v) return { ok: false, code: 'bad_url', error: 'Not a recognisable YouTube URL.' }
  const m = MODES[mode] === undefined ? 'summary' : mode
  const question = (opts.question || '').trim()
  if (m === 'qa' && !question) return { ok: false, code: 'no_question', error: 'Q&A mode needs a question.' }
  const prompt = m === 'qa' ? question : MODES[m]
  if (!opts.force) {
    const hit = getCached(v.id, m, question)
    if (hit) {
      if (opts.onChunk) { try { opts.onChunk(hit.text) } catch (_e) {} }
      return { ok: true, text: hit.text, model: hit.model, cached: true, usage: hit.usage || null, ms: hit.ms, label: hit.label || '' }
    }
  }
  const key = getKey()
  if (!key) return { ok: false, code: 'no_key', error: 'No Gemini API key. Add GEMINI_API_KEY=vault://GEMINI_API_KEY to the widget .env.' }
  let model
  try { model = await resolveModel(key) } catch (e) { return { ok: false, code: 'no_model', error: e.message } }
  try {
    const models = await modelCandidates(key)
    const r = await streamWithRetry(models, key, () => ({ contents: [{ parts: [{ file_data: { file_uri: v.url } }, { text: prompt }] }] }), opts.timeoutMs || DEFAULT_TIMEOUT_MS, opts.onChunk)
    if (!r.text) return { ok: false, code: 'empty', error: 'Gemini returned no text.' }
    const servedBy = r.model || model
    const entry = putCached({ key: cacheKey(v.id, m, question), videoId: v.id, url: v.url, mode: m, question, text: r.text, model: servedBy, usage: r.usage, ms: r.ms, at: Date.now(), label: opts.label || '' })
    return { ok: true, text: r.text, model: servedBy, cached: false, usage: r.usage, ms: r.ms, label: entry.label }
  } catch (e) {
    return { ok: false, code: 'api', status: e.status, error: e.message, model: e.model || model }
  }
}

async function chatStream(url, history, question, opts = {}) {
  const v = parseYouTubeUrl(url)
  if (!v) return { ok: false, code: 'bad_url', error: 'Not a recognisable YouTube URL.' }
  const q = String(question || '').trim()
  if (!q) return { ok: false, code: 'no_question', error: 'Type a question first.' }
  const key = getKey()
  if (!key) return { ok: false, code: 'no_key', error: 'No Gemini API key. Add GEMINI_API_KEY=vault://GEMINI_API_KEY to the widget .env.' }
  let model
  try { model = await resolveModel(key) } catch (e) { return { ok: false, code: 'no_model', error: e.message } }
  const contents = [
    { role: 'user', parts: [{ file_data: { file_uri: v.url } }, { text: 'Here is a video. I am going to ask you questions about it. Answer from what is actually in the video; if something is not shown, say so.' }] },
    { role: 'model', parts: [{ text: 'Understood. Ask me anything about this video.' }] },
  ]
  for (const turn of (history || [])) {
    const role = turn && turn.role === 'model' ? 'model' : 'user'
    const t = turn && typeof turn.text === 'string' ? turn.text : ''
    if (t) contents.push({ role, parts: [{ text: t }] })
  }
  contents.push({ role: 'user', parts: [{ text: q }] })
  try {
    const r = await apiStream(API_BASE + '/' + model + ':streamGenerateContent?alt=sse', key, { contents }, opts.timeoutMs || DEFAULT_TIMEOUT_MS, opts.onChunk)
    if (!r.text) return { ok: false, code: 'empty', error: 'Gemini returned no text.', model }
    return { ok: true, text: r.text, model, usage: r.usage, ms: r.ms, videoId: v.id }
  } catch (e) {
    return { ok: false, code: 'api', status: e.status, error: e.message, model }
  }
}

async function chatStreamGuarded(url, history, question, opts = {}) {
  const v = parseYouTubeUrl(url)
  if (!v) return { ok: false, code: 'bad_url', error: 'Not a recognisable YouTube URL.' }
  const b = checkBudget()
  if (!b.ok) return b
  const q = checkQuestion(question)
  if (!q.ok) return q
  const key = getKey()
  if (!key) return { ok: false, code: 'no_key', error: 'No Gemini API key. Add GEMINI_API_KEY=vault://GEMINI_API_KEY to the widget .env.' }
  await throttle()
  const capped = capHistory(history)
  const dropped = (Array.isArray(history) ? history.length : 0) - capped.length
  let model
  try { model = await resolveModel(key) } catch (e) { return { ok: false, code: 'no_model', error: e.message } }
  const cacheName = opts.useCache === false ? null : await ensureVideoCache(key, v.url, v.id)
  const contents = []
  if (!cacheName) {
    contents.push({ role: 'user', parts: [{ file_data: { file_uri: v.url } }, { text: 'Here is a video. Answer questions from what is actually in it.' }] })
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] })
  }
  for (const t of capped) {
    const role = t && t.role === 'model' ? 'model' : 'user'
    const txtv = t && typeof t.text === 'string' ? t.text : ''
    if (txtv) contents.push({ role, parts: [{ text: txtv }] })
  }
  contents.push({ role: 'user', parts: [{ text: q.text }] })
  const reqBody = { contents }
  if (cacheName) reqBody.cachedContent = cacheName
  try {
    const models = await modelCandidates(key)
    const r = await streamWithRetry(models, key, () => reqBody, opts.timeoutMs || DEFAULT_TIMEOUT_MS, opts.onChunk)
    recordUsage(r.usage)
    const servedBy = r.model || model
    if (!r.text) return { ok: false, code: 'empty', error: 'Gemini returned no text.', model: servedBy }
    return { ok: true, text: r.text, model: servedBy, usage: r.usage, ms: r.ms, videoId: v.id, cached: Boolean(cacheName), historyDropped: dropped, session: usageSnapshot() }
  } catch (e) {
    return { ok: false, code: 'api', status: e.status, error: e.message, model: e.model || model }
  }
}

module.exports = {
  analyze, analyzeStream, chatStream, chatStreamGuarded, apiStream, parseYouTubeUrl,
  GUARD, usageSnapshot, resetUsage, capHistory, checkQuestion, ensureVideoCache, dropVideoCache,
  requestTiming, streamWithRetry, modelCandidates, isRetryable, backoffDelay, RETRY_BACKOFF, haveKey, getKey, resetKeyCache,
  resolveModel, listModels, listCached, MODES, MODE_LABELS,
  MODEL_PREFERENCE, readDotEnv, readVaultKey,
}
