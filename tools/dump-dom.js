// Dumps the live rendered DOM text from the running widget via CDP.
const http = require('http')
const PORT = process.env.CDP_PORT || 9222

function j(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    }).on('error', rej)
  })
}

;(async () => {
  const targets = await j('/json/list')
  const page = targets.find((t) => t.type === 'page')
  if (!page) return console.log('no page target')
  const WebSocket = require('ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: 'document.getElementById("shell").innerText', returnByValue: true },
    }))
  })
  ws.on('message', (m) => {
    const r = JSON.parse(m)
    if (r.id === 1) { console.log(r.result.result.value); ws.close() }
  })
})().catch((e) => console.log('CDP unavailable:', e.message))
