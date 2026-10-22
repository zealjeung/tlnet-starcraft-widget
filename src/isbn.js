'use strict'

const { get } = require('./http')

const OL_API = 'https://openlibrary.org/api/books'

// Extract a 10/13-digit ISBN from a filename or string, normalizing hyphens/spaces.
function extractIsbn(s) {
  if (!s) return null
  const m = s.replace(/[^0-9Xx-]/g, ' ').match(/\b(\d{9}[\dXx]|\d{13})\b/)
  return m ? m[1].toUpperCase() : null
}

// Look up book metadata by ISBN via Open Library's books API (free, no key).
// Returns { isbn, title, author, coverUrl } — any field may be null.
async function lookupIsbn(raw) {
  const isbn = extractIsbn(raw)
  if (!isbn) return { isbn: null, title: null, author: null, coverUrl: null }
  try {
    const url = `${OL_API}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
    const j = JSON.parse(await get(url, 'Mozilla/5.0', 15000, { attempts: 2, baseDelay: 800, maxDelay: 5000 }))
    const entry = j[`ISBN:${isbn}`]
    if (!entry) return { isbn, title: null, author: null, coverUrl: null }
    const title = entry.title || null
    const author = Array.isArray(entry.authors) && entry.authors.length ? entry.authors[0].name || null : null
    // cover comes in multiple sizes; prefer medium/large.
    const coverUrl = entry.cover ? entry.cover.medium || entry.cover.large || entry.cover.small || null : null
    return { isbn, title, author, coverUrl }
  } catch (e) {
    return { isbn, title: null, author: null, coverUrl: null }
  }
}

module.exports = { lookupIsbn, extractIsbn }
