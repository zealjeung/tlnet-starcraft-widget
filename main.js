'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, dialog } = require('electron')
const path = require('path')
const windowState = require('./window-state.js')
const fs = require('fs')

ipcMain.handle('journal-chat', async (_e, message) => {
  try {
    const { spawn } = require('child_process')
    const path = require('path')
    const script = path.join(__dirname, 'hermes-chat-bridge.py')
    const child = spawn('python', [script], {
      windowsHide: true,
      creationFlags: 0x08000000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.stdin.write(JSON.stringify({ message }) + '\n')
    child.stdin.end()
    const exitCode = await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        try { child.kill('SIGKILL') } catch (_e2) {}
        reject(new Error('journal_chat_timeout: process did not exit within 60s'))
      }, 60000)
      child.on('close', () => { clearTimeout(t); resolve() })
      child.on('error', (e2) => { clearTimeout(t); reject(e2) })
    })
    const trimmed = stdout.trim()
    if (!trimmed) {
      return { error: 'journal_chat_empty', detail: stderr.trim().slice(0, 200) }
    }
    const last = trimmed.split('\n').pop() || trimmed
    try {
      return JSON.parse(last)
    } catch {
      return { response: last }
    }
  } catch (e) {
    return { error: 'journal_chat_failed', detail: e.message }
  }
})

// Unique taskbar identity: all widgets share one electron.exe, so without this
// Windows groups them under a single white default-icon button. Must run
// before app ready.
if (process.platform === 'win32') app.setAppUserModelId('hermes.tlnet-widget')

const { fetchNewsAggregate } = require('./src/news')
const { fetchMatches, fetchTournaments, fetchAll, selectFreshOrCached } = require('./src/matches')
const { fetchBrackets, splitTournamentUrl } = require('./src/brackets')
const { fetchChanges } = require('./src/changes')
const { fetchStreams } = require('./src/twitch')
const { fetchStreams: fetchSoopStreams } = require('./src/soop')
const { fetchStreams: fetchYoutubeStreams } = require('./src/youtube')
const { fetchBuildOrders } = require('./src/buildorders')
const { BW_BUILDS } = require('./src/bw-buildorders')
const { fetchReplays } = require('./src/replays')
const { checkNews, checkAll, checkBracket } = require('./src/integrity')
const store = require('./src/store')
const analysis = require('./src/analysis')
const { getLiquipedia, getLiquipediaBytes, getBytes, setLogger } = require('./src/http')
const { setLiquipediaBlocked, isLiquipediaBlocked, seedFromState } = require('./src/liquipedia-policy')
const { createRefresh } = require('./src/refresh')
const { createIpcHandlers } = require('./src/ipc-handlers')
const { lookupIsbn } = require('./src/isbn')
const gemyt = require('./src/gemyt')

// Declared here (not at the IPC handler) because prefetchOngoingBracket writes
// to it during the very first refresh, which runs before that handler's block.
const bracketCache = new Map()
const BRACKET_TTL_MS = 10 * 60 * 1000

const NEWS_INTERVAL_MS = 30 * 60 * 1000 // TL.net RSS: 30min (etiquette)
const MATCH_INTERVAL_MS = 5 * 60 * 1000
const TOURN_INTERVAL_MS = 30 * 60 * 1000
const CHANGES_INTERVAL_MS = 15 * 60 * 1000 // Liquipedia edits pulse, 15min
const STREAM_INTERVAL_MS = 5 * 60 * 1000 // keep the live-stream list fresh
const BUILD_ORDERS_INTERVAL_MS = 30 * 60 * 1000 // spawnstyletool BO list, refresh half-hourly
// Stagger the Liquipedia fetches on boot so we never burst (ToS: 1 req / 2s,
// parse 1 / 30s). Each call is already queued in src/http.js; this just spreads
// the initial triggers so boot can't stack them.
const BOOT_STAGGER_MS = 2500

const stateFile = path.join(app.getPath('userData'), 'widget-state.json')

let win = null
let tray = null
let timers = []
let seenNewsLinks = new Set()
let firstNewsLoad = true
let refresh = null
let ipcHandlers = null

function refreshAll() { if (refresh) refresh.refreshAll() }

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (Array.isArray(s.seen)) seenNewsLinks = new Set(s.seen)
    return s
  } catch {
    return {}
  }
}

function saveState(patch) {
  const cur = loadState()
  const next = { ...cur, ...patch, seen: Array.from(seenNewsLinks).slice(-200) }
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2))
  } catch (e) {
    console.error('saveState failed:', e.message)
  }
}

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'icon.png')
  if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  return nativeImage.createEmpty()
}

function createWindow() {
  const st = loadState()
  // Restore the exact desktop position/size from the last session (window-state.js).
  const wb = windowState.resolveBounds('tlnet', { width: 400, height: 660, x: st.x, y: st.y })
  win = new BrowserWindow({
    width: wb.width,
    height: wb.height,
    x: wb.x,
    y: wb.y,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 300,
    alwaysOnTop: st.pinned !== false,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  console.log('[DEBUG] Window created at', { x: wb.x, y: wb.y, w: wb.width, h: wb.height })
  console.log('[DEBUG] win.isVisible():', win.isVisible(), 'win.isMinimized():', win.isMinimized())
  win.once('ready-to-show', () => {
    console.log('[DEBUG] ready-to-show fired, calling win.show()')
    win.show()
    console.log('[DEBUG] after win.show() — isVisible:', win.isVisible())
  })
  windowState.track(win, 'tlnet')
  win.on('moved', () => {
    const [x, y] = win.getPosition()
    saveState({ x, y })
  })
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
  return win
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}






/** Paint last-known-good instantly at startup, before any network call. */

/** P3: warm the ongoing event's bracket so the first click isn't a 30s wait. */
let prefetched = false
async function prefetchOngoingBracket(tournaments) {
  if (prefetched) return
  const t = (tournaments || []).find((x) => x.status === 'ongoing' && x.url)
  if (!t) return
  prefetched = true
  try {
    const parts = splitTournamentUrl(t.url)
    if (!parts || !['starcraft2', 'starcraft'].includes(parts.wiki)) return
    const data = await fetchBrackets(parts.wiki, parts.page)
    bracketCache.set(`${parts.wiki}/${parts.page}`, { at: Date.now(), data })
    store.log('INFO', 'prefetched bracket', { event: t.name })
  } catch (e) {
    store.log('WARN', 'bracket prefetch failed', { error: e.message })
  }
}


// Staggered Liquipedia fetch (matches/tournaments/changes) honoring the rate
// limit. Used by manual Refresh when unblocked. NOTE: refreshTournaments is
// just an alias of refreshMatches (one fetchAll serves both) — never schedule
// both, that's a duplicate double-fetch.

// Startup sequence: pull Liquipedia ONCE (bypassing the default block), then
// re-block ONLY after the fetch completes. The old code re-blocked on a fixed
// 15.5s timer, but fetchAll needs 31s+ between the two wiki parses (parse-API
// throttle) — so the BW half always ran into the re-block ("fetching is
// disabled"), and the partial SC2-only payload overwrote the full cache.
function initialLiquipediaPull() {
  if (!refresh) return
  if (win && !win.isDestroyed()) win.webContents.send('liquipedia-pull-start')
  // Always block on boot — only the manual pull button can unblock.
  setLiquipediaBlocked(true)
  saveState({ liquipediaBlocked: true })
  // temporarily lift the block, pull once, then re-block + persist
  setLiquipediaBlocked(false)
  let pullOk = false
  const reblock = () => {
    setLiquipediaBlocked(true)
    saveState({ liquipediaBlocked: true })
    if (pullOk) store.log('INFO', 'startup liquipedia pull done — re-blocked')
    else store.log('WARN', 'startup liquipedia pull FAILED — re-blocked anyway')
  }
  // Safety net in case the fetch hangs: re-block after 3 min regardless.
  const failsafe = setTimeout(reblock, 3 * 60 * 1000)
  ;(async () => {
    try {
      await refresh.refreshMatches() // one fetchAll → matches + tournaments
      await refresh.refreshChanges()
      pullOk = true
    } finally {
      clearTimeout(failsafe)
      reblock()
    }
  })()
}


function buildTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('TL.net — StarCraft Widget')
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: 'Refresh now', click: refreshAll },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (mi) => {
        win.setAlwaysOnTop(mi.checked)
        saveState({ pinned: mi.checked })
      },
    },
    { type: 'separator' },
    { label: 'Open TL.net', click: () => shell.openExternal('https://tl.net/') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    store.init(app.getPath('userData'))
    setLogger(store.log.bind(store))
    analysis.init(app.getPath('userData'))
    store.log('INFO', 'app ready', { version: app.getVersion(), electron: process.versions.electron })
    const st = loadState()
    seedFromState(st)
    createWindow()
    buildTray()
    // Create refresh and IPC handler instances
    refresh = createRefresh({ win, store, send, getState: loadState, saveState, bracketCache, shell, Notification })
    ipcHandlers = createIpcHandlers({ app, win, store, analysis, gemyt, saveState, loadState, bracketCache, refreshAll: () => refresh.refreshAll(), refreshFemsc: () => refresh.refreshFemsc(), createWindow, primeFromCache: () => refresh.primeFromCache() })
    // Register IPC handlers
    for (const [channel, handler] of Object.entries(ipcHandlers)) {
      ipcMain.handle(channel, handler)
    }
    refresh.primeFromCache() // paint last-known-good before the network is touched
    refresh.refreshAll() // news/streams/buildorders immediately (non-Liquipedia)
    initialLiquipediaPull() // one-time Liquipedia pull, then auto re-block
    refresh.startTimers()
  })
}

/* ---- crash recovery -------------------------------------------------- *
 * Without these the widget can die silently and leave no trace of why.
 * Anything unexpected gets logged, and a dead renderer is rebuilt rather
 * than leaving an empty always-on-top frame on screen.
 * --------------------------------------------------------------------- */

process.on('uncaughtException', (err) => {
  store.log('FATAL', 'uncaughtException', { error: err.message, stack: err.stack })
})

process.on('unhandledRejection', (reason) => {
  store.log('ERROR', 'unhandledRejection', { reason: String(reason && reason.message ? reason.message : reason) })
})

let rendererRestarts = 0
app.on('render-process-gone', (_e, _wc, details) => {
  store.log('ERROR', 'render-process-gone', details)
  // Cap restarts so a reproducible crash can't become a spin loop.
  if (rendererRestarts < 3 && details.reason !== 'clean-exit') {
    rendererRestarts++
    store.log('INFO', 'recreating window', { attempt: rendererRestarts })
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } catch {
      /* already gone */
    }
    createWindow()
    refresh = createRefresh({ win, store, send, getState: loadState, saveState, bracketCache, shell, Notification })
    ipcHandlers = createIpcHandlers({ app, win, store, analysis, gemyt, saveState, loadState, bracketCache, refreshAll: () => refresh.refreshAll(), refreshFemsc: () => refresh.refreshFemsc(), createWindow, primeFromCache: () => refresh.primeFromCache() })
    for (const [channel, handler] of Object.entries(ipcHandlers)) {
      ipcMain.handle(channel, handler)
    }
    refresh.primeFromCache()
    refresh.refreshAll()
    refresh.startTimers()
  }
})

app.on('child-process-gone', (_e, details) => {
  store.log('WARN', 'child-process-gone', details)
})

app.on('window-all-closed', (e) => e.preventDefault())
