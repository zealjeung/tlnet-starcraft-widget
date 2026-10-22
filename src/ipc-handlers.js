'use strict'
// IPC handlers extracted from main.js.
// Factory pattern: createIpcHandlers(deps) returns the handler functions
// bound to the provided dependencies.

const { fetchStreams } = require('./twitch')
const { fetchStreams: fetchSoopStreams } = require('./soop')
const { fetchStreams: fetchYoutubeStreams } = require('./youtube')
const { fetchStreams: fetchFemscStreams, addCustom, removeCustom } = require('./femsc')
const { fetchBuildOrders } = require('./buildorders')
const { BW_BUILDS } = require('./bw-buildorders')
const { fetchReplays } = require('./replays')
const { splitTournamentUrl, fetchBrackets } = require('./brackets')
const { checkBracket } = require('./integrity')
const { getLiquipediaBytes, getBytes } = require('./http')
const { setLiquipediaBlocked, isLiquipediaBlocked } = require('./liquipedia-policy')
const { lookupIsbn } = require('./isbn')

const BRACKET_TTL_MS = 10 * 60 * 1000

function createIpcHandlers(deps) {
  const { app, win, store, analysis, gemyt, saveState, loadState, bracketCache, refreshAll, refreshFemsc, createWindow, primeFromCache } = deps

  const handlers = {}

  handlers['refresh'] = () => {
    if (win && !win.isDestroyed()) win.webContents.send('liquipedia-pull-start')
    refreshAll()
    return true
  }

  handlers['open-external'] = (_e, url) => {
    const log = (...a) => store.log('INFO', 'open-external', ...a)
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      log('rejected non-https url', { url })
      return false
    }
    try {
      log('opening', { url })
      require('electron').shell.openExternal(url)
      log('opened', { url })
      return true
    } catch (e) {
      log('open error', { url, error: e && e.message })
      return false
    }
  }

  handlers['open-external-test'] = async (_e, url) => {
    const log = (...a) => store.log('INFO', 'open-external-test', ...a)
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      log('rejected non-https test url', { url })
      return false
    }
    try {
      log('test opening', { url })
      require('electron').shell.openExternal(url)
      log('test opened', { url })
      return true
    } catch (e) {
      log('test open error', { url, error: e && e.message })
      return false
    }
  }

  handlers['open-in-app'] = async (_e, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false
    store.log('INFO', 'open-in-app open', { url })
    const { BrowserWindow } = require('electron')
    let webViewWin = null
    if (webViewWin && !webViewWin.isDestroyed()) {
      webViewWin.loadURL(url)
      webViewWin.show()
      return true
    }
    webViewWin = new BrowserWindow({
      width: 1200, height: 800, x: 200, y: 100,
      parent: win, modal: false, titleBarStyle: 'default',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    webViewWin.loadURL(url)
    webViewWin.on('close', () => { webViewWin = null })
    webViewWin.show()
    return true
  }

  handlers['hide'] = () => { if (win) win.hide(); return true }
  handlers['quit'] = () => { app.isQuitting = true; app.quit(); return true }

  handlers['toggle-pin'] = () => {
    if (!win) return false
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    saveState({ pinned: next })
    return next
  }

  handlers['get-pin'] = () => (win ? win.isAlwaysOnTop() : false)

  handlers['set-opacity'] = (_e, v) => {
    const o = Math.min(1, Math.max(0.35, Number(v) || 1))
    if (win) win.setOpacity(o)
    saveState({ opacity: o })
    return o
  }

  handlers['set-sfx-volume'] = (_e, v) => {
    const vol = Math.min(1, Math.max(0, Number(v) || 0))
    saveState({ sfxVolume: vol })
    return vol
  }

  handlers['get-state'] = () => loadState()

  handlers['get-streams'] = async () => {
    const [tw, soop, yt] = await Promise.all([
      fetchStreams().catch((e) => ({ streams: [], errors: [`twitch: ${e.message}`], configured: true })),
      fetchSoopStreams().catch((e) => ({ streams: [], errors: [`soop: ${e.message}`], configured: true })),
      fetchYoutubeStreams().catch((e) => ({ streams: [], errors: [`youtube: ${e.message}`], configured: false })),
    ])
    const streams = [...tw.streams, ...soop.streams, ...yt.streams].sort((a, b) => b.viewers - a.viewers)
    return { streams, errors: [...tw.errors, ...soop.errors, ...yt.errors], configured: tw.configured || soop.configured || yt.configured, fetchedAt: Date.now() }
  }

  handlers['get-femsc'] = async () => {
    const { streams, offline, errors, configured } = await fetchFemscStreams().catch((e) => ({ streams: [], offline: [], errors: [`femsc: ${e.message}`], configured: true }))
    return { streams, offline, errors, configured, fetchedAt: Date.now() }
  }

  handlers['add-femsc'] = async (_e, bjid) => {
    const id = String(bjid || '').trim()
    if (!/^[a-z0-9_\-]+$/i.test(id)) return { ok: false, error: 'invalid bjid' }
    const list = addCustom(id)
    if (typeof refreshFemsc === 'function') refreshFemsc()
    return { ok: true, bjid: id, count: list.length }
  }

  handlers['remove-femsc'] = async (_e, bjid) => {
    const id = String(bjid || '').trim()
    const list = removeCustom(id)
    if (typeof refreshFemsc === 'function') refreshFemsc()
    return { ok: true, bjid: id, count: list.length }
  }

  handlers['get-buildorders'] = async () => {
    const bw = BW_BUILDS.map((b) => ({ ...b, game: 'BW' }))
    let sc2 = []
    try {
      sc2 = (await fetchBuildOrders('pvx')).map((b) => ({ ...b, game: 'SC2' }))
    } catch (e) { /* spawningtool may be unreachable */ }
    return { orders: [...bw, ...sc2], errors: [], fetchedAt: Date.now() }
  }

  handlers['get-replays'] = async (_e, filters) => fetchReplays(filters || {})

  handlers['get-books'] = async () => {
    const st = loadState()
    return st.books || []
  }

  handlers['add-book'] = async (_e, book) => {
    if (!book || !book.path) return { error: 'no-path' }
    const st = loadState()
    const books = st.books || []
    if (books.find((b) => b.path === book.path)) return books
    books.push({
      title: book.title || book.path.split(/[\\/]/).pop(),
      path: book.path,
      format: (book.format || book.path.split('.').pop() || 'file').toLowerCase(),
      cover: book.cover || null,
    })
    saveState({ books })
    return books
  }

  handlers['remove-book'] = async (_e, path) => {
    const st = loadState()
    const books = (st.books || []).filter((b) => b.path !== path)
    saveState({ books })
    return books
  }

  handlers['update-book'] = async (_e, book) => {
    if (!book || !book.path) return { error: 'no-path' }
    const st = loadState()
    const books = st.books || []
    const idx = books.findIndex((b) => b.path === book.path)
    if (idx === -1) return books
    books[idx] = {
      ...books[idx],
      ...(book.title != null ? { title: book.title } : {}),
      ...(book.author != null ? { author: book.author } : {}),
      ...(book.cover != null ? { cover: book.cover } : {}),
    }
    saveState({ books })
    return books
  }

  handlers['open-book-dialog'] = async () => {
    const { dialog } = require('electron')
    const res = await dialog.showOpenDialog(win, {
      title: 'Add a book',
      properties: ['openFile'],
      filters: [
        { name: 'Books', extensions: ['pdf', 'epub', 'mobi', 'txt', 'cbr'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (res.canceled || !res.filePaths || !res.filePaths.length) return null
    return res.filePaths[0]
  }

  handlers['open-book'] = async (_e, filePath) => {
    if (!filePath) return { error: 'no-path' }
    try {
      await require('electron').shell.openPath(filePath)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  }

  handlers['set-liquipedia'] = async (_e, blocked) => {
    const on = !!blocked
    setLiquipediaBlocked(on)
    saveState({ liquipediaBlocked: on })
    if (!on) refreshAll()
    return { blocked: on }
  }

  handlers['get-image'] = async (_e, url) => {
    if (!url || !/^https:\/\/(liquipedia\.net|covers\.openlibrary\.org|openlibrary\.org)\//.test(url)) return { error: 'bad-url' }
    const isLiquipedia = /^https:\/\/liquipedia\.net\//.test(url)
    try {
      const buf = isLiquipedia
        ? await getLiquipediaBytes(url, { attempts: 4, baseDelay: 1500, maxDelay: 30000 })
        : await getBytes(url, 'Mozilla/5.0', 30000, { attempts: 3, baseDelay: 1000, maxDelay: 8000 })
      const b64 = buf.toString('base64')
      const ct = 'image/png'
      return { dataUrl: `data:${ct};base64,${b64}` }
    } catch (err) {
      return { error: err.message }
    }
  }

  handlers['lookup-isbn'] = async (_e, raw) => {
    try { return await lookupIsbn(raw) } catch (err) { return { isbn: null, title: null, author: null, coverUrl: null, error: err.message } }
  }

  handlers['get-bracket'] = async (_e, url) => {
    const parts = splitTournamentUrl(url)
    if (!parts) return { error: 'Not a Liquipedia tournament URL' }
    if (!['starcraft2', 'starcraft'].includes(parts.wiki)) return { error: `Blocked non-StarCraft wiki: ${parts.wiki}` }
    const key = `${parts.wiki}/${parts.page}`
    const hit = bracketCache.get(key)
    if (hit && Date.now() - hit.at < BRACKET_TTL_MS) return hit.data
    try {
      const data = await fetchBrackets(parts.wiki, parts.page)
      const check = checkBracket(data)
      if (!check.ok) store.log('WARN', 'bracket integrity', { page: key, problems: check.problems })
      const payload = { ...data, integrity: check.ok ? null : check.problems }
      bracketCache.set(key, { at: Date.now(), data: payload })
      store.write(`bracket-${key.replace(/[^\w.-]/g, '_')}`, payload)
      return payload
    } catch (err) {
      store.log('ERROR', 'bracket fetch failed', { page: key, error: err.message })
      const cached = store.read(`bracket-${key.replace(/[^\w.-]/g, '_')}`)
      if (cached) return { ...cached.payload, fromCache: true, cachedAt: cached.savedAt }
      return { error: err.message }
    }
  }

  handlers['get-analysis'] = async (_e, q) => {
    try { return analysis.getBrief(q || {}) } catch (err) { return { status: 'error', error: err.message } }
  }

  handlers['request-analysis'] = async (_e, q) => {
    try {
      const r = analysis.requestBrief(q || {})
      if (!r.ok) store.log('ERROR', 'analysis request failed', { error: r.error })
      return r
    } catch (err) { return { ok: false, error: err.message } }
  }

  handlers['list-analysis'] = async () => {
    try { return { briefs: analysis.listBriefs(), pending: analysis.listPending() } } catch (err) { return { briefs: [], pending: [], error: err.message } }
  }

  handlers['run-analysis-sweep'] = async () => {
    try {
      const pending = analysis.listPending()
      return { ok: true, pending: pending.length, slugs: pending.map(p => p.slug) }
    } catch (err) { return { ok: false, error: err.message } }
  }

  handlers['gemyt-analyze'] = async (_e, url, mode, opts) => {
    try {
      const r = await gemyt.analyze(url, mode, opts || {})
      if (!r.ok) store.log('WARN', 'gemyt analyze failed', { code: r.code, error: r.error })
      return r
    } catch (err) { return { ok: false, code: 'ipc', error: err.message } }
  }

  handlers['gemyt-analyze-stream'] = async (e, url, mode, opts) => {
    const send = (chunk) => { try { e.sender.send('gemyt-chunk', chunk) } catch (_err) {} }
    try {
      const r = await gemyt.analyzeStream(url, mode, Object.assign({}, opts || {}, { onChunk: send }))
      if (!r.ok) store.log('WARN', 'gemyt stream failed', { code: r.code, error: r.error })
      return r
    } catch (err) { return { ok: false, code: 'ipc', error: err.message } }
  }

  handlers['gemyt-chat'] = async (e, url, history, question, opts) => {
    const send = (chunk) => { try { e.sender.send('gemyt-chat-chunk', chunk) } catch (_err) {} }
    try {
      const r = await gemyt.chatStreamGuarded(url, history, question, Object.assign({}, opts || {}, { onChunk: send }))
      if (!r.ok) store.log('WARN', 'gemyt chat failed', { code: r.code, error: r.error })
      return r
    } catch (err) { return { ok: false, code: 'ipc', error: err.message } }
  }

  handlers['gemyt-timing'] = async () => { try { return gemyt.requestTiming() } catch (_err) { return {} } }

  handlers['gemyt-status'] = async () => {
    try {
      return { configured: gemyt.haveKey(), modes: gemyt.MODE_LABELS, recent: gemyt.listCached(20) }
    } catch (err) { return { configured: false, modes: {}, recent: [], error: err.message } }
  }

  handlers['set-banner'] = async (_e, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return { error: 'Invalid banner payload' }
    if (dataUrl.length > 8 * 1024 * 1024) return { error: 'Image too large (max ~6MB)' }
    saveState({ banner: dataUrl })
    return { ok: true }
  }

  handlers['get-journal'] = async () => {
    try { return require('fs').readFileSync(require('path').join(app.getPath('userData'), 'journal.md'), 'utf8') } catch { return '' }
  }

  handlers['save-journal'] = async (_e, text) => {
    try { require('fs').writeFileSync(require('path').join(app.getPath('userData'), 'journal.md'), String(text ?? ''), 'utf8'); return true } catch (err) { return { error: err.message } }
  }

  handlers['get-sfx'] = async () => {
    const path = require('path')
    const fs = require('fs')
    const dir = path.join(__dirname, '..', 'renderer', 'sfx')
    const out = {}
    const SFX_TABS = ['news', 'matches', 'live', 'tournaments', 'streams']
    for (const tab of SFX_TABS) {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${tab}-`) && f.endsWith('.wav'))
      out[tab] = files.map((f) => {
        const buf = fs.readFileSync(path.join(dir, f))
        return `data:audio/wav;base64,${buf.toString('base64')}`
      })
    }
    return out
  }

  return handlers
}

module.exports = { createIpcHandlers }
