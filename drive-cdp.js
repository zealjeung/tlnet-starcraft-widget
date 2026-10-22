// Drive a running Electron app over CDP: switch views, click things, dump
// rendered text. This is the STRONGEST runtime evidence — it proves the UI
// renders real data and that interactive features actually work, not just that
// the fetch layer returns rows.
//
// Prereqs (decide on these during architecture, not after the build):
//   npm install ws --save-dev
//   ./node_modules/electron/dist/electron.exe --remote-debugging-port=9222 .
//
// Usage:
//   node drive.js                          # dump default panel text
//   node drive.js '#panel-matches'         # dump one panel
//   node drive.js '#panel-events' '[data-bracket]' 40000
//     -> clicks the first matching element, waits, then dumps
//
// The wait matters: if the click triggers a rate-limited network fetch
// (e.g. 1 req/30s MediaWiki parse), dumping immediately shows the loading
// state and you will wrongly conclude the feature is broken.

const http = require('http')
const WebSocket = require('ws')

const PORT = Number(process.env.CDP_PORT || 9222)
const DUMP_SEL = process.argv[2] || 'body'
const CLICK_SEL = process.argv[3] || null
const WAIT_MS = Number(process.argv[4] || 1500)

function listTargets() {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => {
          try {
            resolve(JSON.parse(d))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

;(async () => {
  const page = (await listTargets()).find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target — did you launch with --remote-debugging-port?')
    return
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let id = 0

  const send = (method, params) =>
    new Promise((resolve) => {
      const i = ++id
      pending.set(i, resolve)
      ws.send(JSON.stringify({ id: i, method, params }))
    })

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  })

  // awaitPromise:true lets you evaluate async expressions directly.
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return r && r.result ? r.result.value : null
  }

  await new Promise((r) => ws.on('open', r))

  if (CLICK_SEL) {
    const label = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(CLICK_SEL)});
      if (!el) return 'NO MATCH for ${CLICK_SEL}';
      const t = (el.dataset && (el.dataset.name || el.dataset.id)) || el.textContent.trim().slice(0, 60);
      el.click();
      return t;
    })()`)
    console.log('clicked:', label)
    await new Promise((r) => setTimeout(r, WAIT_MS))
  }

  const text = await evalJs(
    `(document.querySelector(${JSON.stringify(DUMP_SEL)}) || document.body).innerText`,
  )
  console.log(text)
  ws.close()
})().catch((e) => console.log('CDP error:', e.message))
