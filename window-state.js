// window-state.js - persist + restore an Electron window's exact desktop position/size.
//
// Why: widgets are launched fresh on every boot. Without this they come back at
// whatever x/y is hardcoded in main.js, not where the user actually left them.
//
// Usage:
//   const windowState = require('./window-state.js')
//   ...
//   const b = windowState.resolveBounds('tlnet', { width: 400, height: 660, x: 40, y: 60 })
//   win = new BrowserWindow({ width: b.width, height: b.height, x: b.x, y: b.y, ... })
//   windowState.track(win, 'tlnet')   // saves on moved/resized/close/before-quit
//
// Storage: <userData>/<name>-bounds.json  (userData = %APPDATA%/tlnet-widget etc.)
// Safety: a saved rect that no longer overlaps any display workArea (monitor
// unplugged, resolution shrunk) is DISCARDED in favour of the defaults - a widget
// restored off-screen is worse than one restored at its default spot.

const fs = require('fs')
const path = require('path')
const { app, screen } = require('electron')

function statePath(name) {
  return path.join(app.getPath('userData'), `${name}-bounds.json`)
}

function readBounds(name) {
  try {
    const raw = fs.readFileSync(statePath(name), 'utf8')
    const b = JSON.parse(raw)
    return (b && typeof b.x === 'number' && typeof b.y === 'number') ? b : null
  } catch {
    return null
  }
}

// A restored window is usable only if a meaningful part of it lands inside some
// display's work area, so the title bar stays grabbable.
function isReachable(b) {
  if (!b) return false
  const w = typeof b.width === 'number' ? b.width : 0
  const h = typeof b.height === 'number' ? b.height : 0
  if (w <= 0 || h <= 0) return false
  return screen.getAllDisplays().some(d => {
    const wa = d.workArea
    const overlapX = Math.min(b.x + w, wa.x + wa.width) - Math.max(b.x, wa.x)
    const overlapY = Math.min(b.y + h, wa.y + wa.height) - Math.max(b.y, wa.y)
    return overlapX >= 80 && overlapY >= 40
  })
}

// Returns the geometry to create the window with. `restored` says which path was taken.
function resolveBounds(name, defaults) {
  const saved = readBounds(name)
  if (!isReachable(saved)) {
    return Object.assign({}, defaults, { restored: false })
  }
  const out = Object.assign({}, defaults, {
    x: saved.x,
    y: saved.y,
  })
  // Only take a saved size when it is sane; keep the default otherwise.
  if (typeof saved.width === 'number' && saved.width >= 200) out.width = saved.width
  if (typeof saved.height === 'number' && saved.height >= 150) out.height = saved.height
  out.restored = true
  return out
}

function track(win, name) {
  let timer = null
  const save = () => {
    try {
      if (!win || win.isDestroyed()) return
      const b = win.getBounds()
      const dir = path.dirname(statePath(name))
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(statePath(name), JSON.stringify(
        { x: b.x, y: b.y, width: b.width, height: b.height }, null, 2))
    } catch (e) {
      console.error('window-state save failed:', e.message)
    }
  }
  const debounced = () => { clearTimeout(timer); timer = setTimeout(save, 500) }

  // 'move'/'resize' fire on every WM_MOVE/WM_SIZE (including programmatic moves).
  // 'moved'/'resized' fire only after an interactive drag on Windows
  // (WM_EXITSIZEMOVE), so they are the bonus, not the primary signal - a user who
  // drags a widget and then hard-shuts the machine can miss 'moved' entirely.
  win.on('move', debounced)
  win.on('resize', debounced)
  win.on('moved', debounced)
  win.on('resized', debounced)
  win.on('close', save)
  app.on('before-quit', save)

  // Safety net: flush the live rect periodically so an abrupt shutdown still
  // lands on the position the user last left the widget at.
  const interval = setInterval(save, 10000)
  if (interval.unref) interval.unref()
  win.on('closed', () => clearInterval(interval))

  return { save, read: () => readBounds(name) }
}

module.exports = { resolveBounds, track, readBounds, isReachable, statePath }
