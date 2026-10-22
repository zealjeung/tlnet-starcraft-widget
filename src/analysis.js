'use strict'

/**
 * Match-analysis briefs (Phase A: on-click, per finished match).
 *
 * Flow: the Matches tab offers an "Analyze" button on finished rows. The
 * widget itself can't research anything — it only reads/writes files here:
 *
 *   <userData>/analyses/<slug>.md        finished brief (markdown, rendered in-widget)
 *   <userData>/analyses/_requests/<slug>.json   request for the Hermes agent
 *
 * Clicking Analyze with no brief present drops a request file and shows a
 * "requested" state. The agent (a later Hermes session) picks the request up,
 * researches the match (Liquipedia results + TL.net thread play-by-play) and
 * writes the .md. Next open renders it. Phase B adds an Analysis tab over
 * listBriefs().
 */

const fs = require('fs')
const path = require('path')

let baseDir = null

function init(dir) {
  baseDir = path.join(dir, 'analyses')
  try {
    fs.mkdirSync(baseDir, { recursive: true })
    fs.mkdirSync(path.join(baseDir, '_requests'), { recursive: true })
  } catch {
    /* best effort — handlers report errors per call */
  }
}

function dir() {
  if (!baseDir) throw new Error('analysis store not initialised')
  return baseDir
}

/** Stable file key: "bw-asl22-ro16-snow-vs-shine". TBD/empty parts are dropped. */
function slug(p1, p2, tournament) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-')
  const parts = [norm(tournament), norm(p1), 'vs', norm(p2)].filter(
    (p) => p && p !== 'tbd' && p !== 'null' && p !== 'undefined',
  )
  // "tournament-a-vs-b" — drop a dangling "vs" when a side is missing
  const clean = parts.filter((p, i) => !(p === 'vs' && (i === 0 || i === parts.length - 1)))
  return clean.join('-').slice(0, 120) || 'match'
}

function briefPath(s) {
  return path.join(dir(), `${s}.md`)
}

function requestPath(s) {
  return path.join(dir(), '_requests', `${s}.json`)
}

function statusPath(s) {
  return path.join(dir(), '_status', `${s}.json`)
}

function ensureSubdir(name) {
  try {
    fs.mkdirSync(path.join(dir(), name), { recursive: true })
  } catch {
    /* best effort */
  }
}

/**
 * Progress protocol (honest, no fake ETAs). The fulfiller — a Hermes session
 * or cron occurrence — advances the stage as it works:
 *   requested → researching → writing → ready | failed
 * The widget shows the stage + elapsed time. Research length is not
 * quantifiable, so there is deliberately no percentage or ETA.
 */
function writeStatus(slugStr, stage, detail) {
  ensureSubdir('_status')
  try {
    const tmp = statusPath(slugStr) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ slug: slugStr, stage, detail: detail || '', updatedAt: Date.now() }, null, 2))
    fs.renameSync(tmp, statusPath(slugStr))
    return true
  } catch {
    return false
  }
}

/** Latest stage, or null when nothing was ever recorded. Never throws. */
function readStatus(slugStr) {
  try {
    const fp = statusPath(slugStr)
    if (!fs.existsSync(fp)) return null
    const st = JSON.parse(fs.readFileSync(fp, 'utf8'))
    if (!st || typeof st.stage !== 'string') return null
    return st
  } catch {
    return null
  }
}

/** Read a finished brief. Never throws — returns a status object. */
function getBrief({ p1, p2, tournament }) {
  const s = slug(p1, p2, tournament)
  try {
    const fp = briefPath(s)
    if (!fs.existsSync(fp)) return { status: 'missing', slug: s, progress: readStatus(s) }
    const st = fs.statSync(fp)
    return { status: 'ready', slug: s, markdown: fs.readFileSync(fp, 'utf8'), savedAt: st.mtimeMs, progress: readStatus(s) }
  } catch (e) {
    return { status: 'error', slug: s, error: e.message, progress: readStatus(s) }
  }
}

/**
 * Drop a request file for the agent. Idempotent: an existing request is left
 * alone (no timestamp churn), a finished brief short-circuits to ready.
 */
function requestBrief(meta) {
  const { p1, p2, tournament, game, bo } = meta || {}
  const s = slug(p1, p2, tournament)
  try {
    if (fs.existsSync(briefPath(s))) {
      const st = fs.statSync(briefPath(s))
      return { ok: true, slug: s, already: 'ready', savedAt: st.mtimeMs }
    }
    const rp = requestPath(s)
    if (!fs.existsSync(rp)) {
      const tmp = rp + '.tmp'
      fs.writeFileSync(
        tmp,
        JSON.stringify({ slug: s, p1, p2, tournament, game, bo, requestedAt: Date.now() }, null, 2),
      )
      fs.renameSync(tmp, rp) // atomic-ish: never leaves a half file
    }
    if (!readStatus(s)) writeStatus(s, 'requested', 'queued for research')
    return { ok: true, slug: s, already: 'requested', progress: readStatus(s) }
  } catch (e) {
    return { ok: false, slug: s, error: e.message }
  }
}

/** Every finished brief, newest first — feeds the Analysis tab.
 * Merges identity meta from the request file when present so the renderer
 * can re-open the brief through the standard openAnalysis() flow. */
function listBriefs() {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const slugStr = f.slice(0, -3)
        const fp = path.join(dir(), f)
        let savedAt = 0
        try {
          savedAt = fs.statSync(fp).mtimeMs
        } catch {
          /* ignore */
        }
        let meta = null
        try {
          const rp = requestPath(slugStr)
          if (fs.existsSync(rp)) meta = JSON.parse(fs.readFileSync(rp, 'utf8'))
        } catch {
          /* request file missing or corrupt — render with slug only */
        }
        return {
          slug: slugStr,
          savedAt,
          p1: (meta && meta.p1) || null,
          p2: (meta && meta.p2) || null,
          tournament: (meta && meta.tournament) || null,
          game: (meta && meta.game) || null,
        }
      })
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

/** Pending requests without a finished brief — feeds the Analysis tab's
 * "Pending analysis" group so in-progress research is visible. */
function listPending() {
  try {
    const reqDir = path.join(dir(), '_requests')
    let requests = []
    try {
      requests = fs.readdirSync(reqDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(reqDir, f), 'utf8')))
    } catch { /* no requests dir or unreadable */ }
    return requests
      .map((req) => {
        const st = readStatus(req.slug)
        const hasBrief = fs.existsSync(briefPath(req.slug))
        return {
          slug: req.slug,
          p1: req.p1,
          p2: req.p2,
          tournament: req.tournament,
          game: req.game,
          bo: req.bo,
          requestedAt: req.requestedAt,
          progress: st,
          pending: !hasBrief,
        }
      })
      .filter((b) => b.pending)
      .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
  } catch {
    return []
  }
}

module.exports = { init, slug, getBrief, requestBrief, listBriefs, listPending, writeStatus, readStatus }
