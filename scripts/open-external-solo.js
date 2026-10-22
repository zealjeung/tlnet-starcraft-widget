'use strict'

const path = require('path')
const fs = require('fs')

const here = __dirname
const widgetRoot = path.resolve(here, '..')

// Rerun the exact loader that package.json says to use for the widget.
const pkg = JSON.parse(fs.readFileSync(path.resolve(widgetRoot, 'package.json'), 'utf8'))
const main = path.resolve(widgetRoot, pkg.main || 'main.js')

console.log('main file:', main)
console.log('exists:', fs.existsSync(main))

// Minimal shell: pretend to be the renderer asking the main side to open.
const { app, shell, ipcMain, BrowserWindow } = require('electron')

// Keep app from auto-quitting before we get to the test.
app.allowRendererProcessReuse = true
let win = null
try {
  win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
} catch (e) {
  win = null
}

const logPath = path.resolve(widgetRoot, 'scripts', 'open-external-solo.log')
fs.mkdirSync(path.dirname(logPath), { recursive: true })
function log(line) {
  const out = `${new Date().toISOString()} ${line}\n`
  process.stdout.write(out)
  try { fs.appendFileSync(logPath, out) } catch (_) {}
}

// Reuse the exact guard used by real open-external.
const httpsRe = /^https:\/\//i

async function openExternal(url) {
  if (typeof url !== 'string' || !httpsRe.test(url)) {
    return { ok: false, reason: 'rejected non-https url', url }
  }
  try {
    shell.openExternal(url)
    return { ok: true, url }
  } catch (e) {
    return { ok: false, error: e && e.message, url }
  }
}

const urls = [
  'https://example.com',
  process.env.STREAM_TEST_URL || 'https://twitch.tv/example_stream'
]

ipcMain.handle('open-external', async (_e, url) => {
  log('open-external invoked server-side: ' + JSON.stringify(url))
  return await openExternal(url)
})

ipcMain.handle('open-external-test', async (_e, url) => {
  log('open-external-test invoked server-side: ' + JSON.stringify(url))
  return await openExternal(url)
})

async function mainFn() {
  log('starting solo open-external test')
  log('electron loaded, main:', main)
  const results = []
  for (const url of urls) {
    const r = await openExternal(url)
    log('open result: ' + JSON.stringify(r))
    results.push(r)
  }
  log('solo test complete, results:')
  for (const r of results) log(JSON.stringify(r))
  if (win && !win.isDestroyed()) { win.destroy() }
  app.quit()
  return results
}

mainFn().then(
  () => { process.exit(0) },
  (err) => {
    log('solo test crashed: ' + (err && err.stack || err))
    try { app.quit() } catch (_) {}
    process.exit(2)
  }
)

// Safety net so this never hangs forever.
setTimeout(() => {
  log('solo test hard-killing after 90s')
  try { app.quit() } catch (_) {}
  process.exit(99)
}, 90 * 1000)
