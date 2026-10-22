'use strict'
// GemYT — HTTP transport layer (apiPost, apiGet, apiStream, apiDelete)

const https = require('https')

const API_HOST = 'generativelanguage.googleapis.com'
const API_BASE = '/v1beta/models'

function extractError(parsed, status) {
  if (parsed && parsed.error && parsed.error.message) {
    const m = parsed.error.message
    if (status === 429) return 'Gemini rate limit reached — retry shortly'
    if (status === 503) return 'Gemini model at capacity — retry shortly'
    if (status === 400 && /API key/i.test(m)) return 'Gemini rejected the API key'
    return m
  }
  return `Gemini HTTP ${status}`
}

function apiPost(pathname, apiKey, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request({
      host: API_HOST, path: pathname, method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch (_e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed)
        const err = new Error(extractError(parsed, res.statusCode))
        err.status = res.statusCode
        err.apiStatus = parsed && parsed.error && parsed.error.status
        reject(err)
      })
    })
    req.on('timeout', () => { req.destroy(new Error('Gemini request timed out')) })
    req.on('error', reject)
    req.end(payload)
  })
}

function apiGet(pathname, apiKey, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API_HOST, path: pathname, method: 'GET',
      headers: { 'x-goog-api-key': apiKey }, timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch (_e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed)
        const err = new Error(extractError(parsed, res.statusCode))
        err.status = res.statusCode
        reject(err)
      })
    })
    req.on('timeout', () => { req.destroy(new Error('Gemini request timed out')) })
    req.on('error', reject)
    req.end()
  })
}

function apiStream(pathname, apiKey, body, timeoutMs, onChunk) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const t0 = Date.now()
    let text = ''
    let usage = null
    let settled = false

    const req = https.request({
      host: API_HOST, path: pathname, method: 'POST',
      headers: {
        'x-goog-api-key': apiKey, 'Content-Type': 'application/json',
        'Content-Length': payload.length, Accept: 'text/event-stream',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errBody = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { errBody += c })
        res.on('end', () => {
          let parsed = null
          try { parsed = JSON.parse(errBody) } catch (_e) {}
          const err = new Error(extractError(parsed, res.statusCode))
          err.status = res.statusCode
          reject(err)
        })
        return
      }
      res.setEncoding('utf8')
      let buf = ''
      res.on('data', (chunk) => {
        buf += chunk
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line.startsWith('data:')) continue
          const js = line.slice(5).trim()
          if (!js || js === '[DONE]') continue
          let j
          try { j = JSON.parse(js) } catch (_e) { continue }
          if (j.usageMetadata) usage = j.usageMetadata
          const cands = j.candidates || []
          for (const c of cands) {
            const parts = (c.content && c.content.parts) || []
            for (const p of parts) {
              if (typeof p.text === 'string' && p.text) {
                text += p.text
                if (onChunk) { try { onChunk(p.text) } catch (_e) {} }
              }
            }
          }
        }
      })
      res.on('end', () => { if (!settled) { settled = true; resolve({ text, usage, ms: Date.now() - t0 }) } })
      res.on('error', (e) => { if (!settled) { settled = true; reject(e) } })
    })
    req.on('timeout', () => { req.destroy(new Error('Gemini stream timed out')) })
    req.on('error', (e) => { if (!settled) { settled = true; reject(e) } })
    req.end(payload)
  })
}

function apiDelete(pathname, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API_HOST, path: pathname, method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey }, timeout: 30000,
    }, (res) => {
      let d = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { d += c })
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    req.on('timeout', () => req.destroy(new Error('delete timed out')))
    req.on('error', reject)
    req.end()
  })
}

module.exports = { apiPost, apiGet, apiStream, apiDelete, extractError, API_HOST, API_BASE }
