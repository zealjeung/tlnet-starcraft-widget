// Drive the widget to the Analysis tab over CDP and read the rendered list.
// Usage: node tools/drive-analysis.js
const WebSocket = require('ws');

const CDP = 'http://127.0.0.1:9222/json/list';

async function main() {
  const list = await (await fetch(CDP)).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!page) { console.log('NO PAGE'); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });

  await new Promise(r => ws.on('open', r));

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  // 1. click the Analysis tab
  const clicked = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const t = tabs.find(x => (x.dataset.tab || '').toLowerCase().includes('analy'));
    if (!t) return 'NO_ANALYSIS_TAB:' + tabs.map(x => x.dataset.tab).join(',');
    t.click();
    return 'clicked:' + t.dataset.tab;
  })()`);
  console.log('CLICK:', clicked);

  await new Promise(r => setTimeout(r, 2500));

  // 2. read the rendered analysis pane text
  const txt = await evaluate(`(() => {
    const ids = ['analysis','analysis-list','panel-analysis','list-analysis','tab-analysis'];
    for (const i of ids) {
      const el = document.getElementById(i);
      if (el && el.innerText && el.innerText.trim()) return '#'+i+' :: '+el.innerText.trim().slice(0,1200);
    }
    const vis = [...document.querySelectorAll('div,section')].filter(e => {
      const s = getComputedStyle(e);
      return s.display !== 'none' && s.visibility !== 'hidden' && e.innerText && e.innerText.includes('Rush');
    });
    return vis.length ? 'FOUND_RUSH :: ' + vis[0].innerText.trim().slice(0,1200) : 'NO_RUSH_IN_DOM';
  })()`);
  console.log('PANE:', txt);

  // 3. does the slug appear anywhere?
  const slug = await evaluate(`document.body.innerText.includes('rush-vs-light') || document.body.innerText.includes('Rush vs Light') || document.body.innerText.includes('Rush') ? 'SLUG_PRESENT' : 'SLUG_ABSENT'`);
  console.log('SLUG:', slug);

  ws.close();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
