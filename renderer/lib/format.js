'use strict'
// Pure format helpers extracted from renderer.js

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function ago(ts) {
  if (!ts) return ''
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  const days = Math.floor(d / 86400)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function countdown(ts) {
  if (!ts) return ''
  const diff = ts - Date.now()
  if (diff <= 0) return 'LIVE'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString()
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString()
}

function formatDuration(ms) {
  if (!ms || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

// Expose to renderer.js via window.__format
if (typeof window !== 'undefined') {
  window.__format = { esc, ago, countdown, formatDate, formatTime, formatDuration }
}

module.exports = { esc, ago, countdown, formatDate, formatTime, formatDuration }
