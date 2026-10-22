/* GemYT tab — video analysis, chat, and timer.
 * Extracted from renderer.js (ring F7, 2026-10-04). Pure move: three IIFEs
 * that were already closure-isolated. Loaded before renderer.js.
 */
/* --- GemYT: Gemini video analysis --------------------------------------- */
(function gemytInit() {
  const urlEl = document.getElementById('gemyt-url')
  const goEl = document.getElementById('gemyt-go')
  const outEl = document.getElementById('gemyt-out')
  const footEl = document.getElementById('gemyt-foot')
  const metaEl = document.getElementById('gemyt-meta')
  const hintEl = document.getElementById('gemyt-hint')
  const qaWrap = document.getElementById('gemyt-qa-wrap')
  const qEl = document.getElementById('gemyt-q')
  const forceEl = document.getElementById('gemyt-force')
  const recentEl = document.getElementById('gemyt-recent')
  if (!urlEl || !goEl) return

  let mode = 'summary'
  let last = null // { url, mode, question, text }

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  }

  // Turn MM:SS / HH:MM:SS into clickable jump links (open YouTube at that second).
  function linkifyTimestamps(escaped) {
    return escaped.replace(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g, (m, h, mm, ss) => {
      const secs = (h ? parseInt(h, 10) * 3600 : 0) + parseInt(mm, 10) * 60 + parseInt(ss, 10)
      return '<span class="gemyt-ts" data-secs="' + secs + '" title="Open at ' + m + '">' + m + '</span>'
    })
  }

  function render(text, videoUrl) {
    outEl.innerHTML = linkifyTimestamps(esc(text))
    outEl.querySelectorAll('.gemyt-ts').forEach((el) => {
      el.addEventListener('click', () => {
        const s = el.dataset.secs
        const base = (last && last.url) || videoUrl
        if (base && s !== undefined) void window.tl.open(base + '&t=' + s + 's')
      })
    })
  }

  function busy(on) {
    goEl.disabled = on
    goEl.textContent = on ? 'Analyzing…' : 'Analyze'
  }

  function showMeta(r) {
    const bits = []
    if (r.model) bits.push(r.model)
    if (r.cached) bits.push('cached')
    else if (r.ms) bits.push((r.ms / 1000).toFixed(1) + 's')
    if (r.usage && r.usage.totalTokenCount) bits.push(r.usage.totalTokenCount.toLocaleString() + ' tok')
    metaEl.textContent = bits.join(' · ')
    footEl.style.display = bits.length ? 'flex' : 'none'
  }

  async function loadRecent() {
    try {
      const s = await window.tl.gemytStatus()
      const items = (s && s.recent) || []
      recentEl.innerHTML = items.length
        ? items.slice(0, 8).map((e) =>
            '<div class="r" data-vid="' + esc(e.videoId) + '">' +
            esc(e.label || e.videoId) + ' · ' + esc(e.mode) + '</div>').join('')
        : ''
      recentEl.querySelectorAll('.r').forEach((el) => {
        el.addEventListener('click', () => {
          urlEl.value = 'https://www.youtube.com/watch?v=' + el.dataset.vid
          void run()
        })
      })
    } catch (_e) { /* history is optional */ }
  }

  // Progressive paint: chunks arrive while Gemini is still generating.
  let streamBuf = ''
  if (window.tl.onGemytChunk) {
    window.tl.onGemytChunk((chunk) => {
      streamBuf += chunk
      render(streamBuf, (last && last.url) || urlEl.value.trim())
    })
  }

  async function run() {
    const url = urlEl.value.trim()
    if (!url) { outEl.innerHTML = '<div class="loading">Paste a YouTube link first.</div>'; return }
    if (mode === 'qa' && !qEl.value.trim()) {
      outEl.innerHTML = '<div class="err">Q&amp;A mode needs a question below.</div>'
      return
    }
    busy(true)
    streamBuf = ''
    if (window.__gemytTimerStart) window.__gemytTimerStart()
    outEl.innerHTML = '<div class="loading">Gemini is watching the video…</div>'
    footEl.style.display = 'none'
    try {
      const r = await window.tl.gemytAnalyzeStream(url, mode, {
        question: qEl.value.trim(),
        force: forceEl.checked,
      })
      if (!r || !r.ok) {
        outEl.innerHTML = '<div class="err">' + esc((r && r.error) || 'Analysis failed.') + '</div>'
        return
      }
      last = { url: r.url || url, mode, question: qEl.value.trim(), text: r.text }
      render(r.text, last.url)
      showMeta(r)
      void loadRecent()
    } catch (e) {
      outEl.innerHTML = '<div class="err">' + esc(e.message || String(e)) + '</div>'
    } finally {
      busy(false)
      if (window.__gemytTimerStop) window.__gemytTimerStop()
    }
  }

  goEl.addEventListener('click', () => void run())
  urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void run() })
  qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void run() })

  document.querySelectorAll('#gemyt-modes .chip').forEach((c) =>
    c.addEventListener('click', () => {
      document.querySelectorAll('#gemyt-modes .chip').forEach((x) => x.classList.remove('active'))
      c.classList.add('active')
      mode = c.dataset.mode
      qaWrap.style.display = mode === 'qa' ? 'block' : 'none'
      if (mode === 'qa') qEl.focus()
    }),
  )

  const copyEl = document.getElementById('gemyt-copy')
  if (copyEl) copyEl.addEventListener('click', () => {
    if (last) void navigator.clipboard.writeText(last.text)
  })

  const jEl = document.getElementById('gemyt-journal')
  if (jEl) jEl.addEventListener('click', async () => {
    if (!last) return
    const box = document.getElementById('journal-text')
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const entry = '\n\n## GemYT ' + stamp + ' — ' + last.mode + '\n' + last.url + '\n\n' + last.text + '\n'
    if (box) {
      box.value = (box.value || '') + entry
      await window.tl.saveJournal(box.value)
      jEl.textContent = 'Saved ✓'
      setTimeout(() => { jEl.textContent = 'Save to Journal' }, 1500)
    }
  })

  const reEl = document.getElementById('gemyt-rerun')
  if (reEl) reEl.addEventListener('click', () => {
    forceEl.checked = true
    void run()
  })

  async function prefillFromClipboard() {
    try {
      const t = await navigator.clipboard.readText()
      if (t && /youtu\.?be|youtube\.com/.test(t) && !urlEl.value) urlEl.value = t.trim()
    } catch (_e) { /* clipboard permission — ignore */ }
  }

  const tabBtn = document.querySelector('[data-tab="gemyt"]')
  if (tabBtn) tabBtn.addEventListener('click', () => {
    void prefillFromClipboard()
    void loadRecent()
    if (hintEl && !hintEl.dataset.checked) {
      hintEl.dataset.checked = '1'
      void window.tl.gemytStatus().then((s) => {
        if (s && !s.configured) {
          hintEl.textContent = 'No Gemini key configured — add GEMINI_API_KEY=vault://GEMINI_API_KEY to the widget .env'
          hintEl.style.color = 'var(--live)'
        }
      })
    }
  })

  void loadRecent()
})();

/* --- GemYT chat: multi-turn conversation about the loaded video ---------- */
(function gemytChatInit() {
  const input = document.getElementById('gemyt-chat-input')
  const sendBtn = document.getElementById('gemyt-chat-send')
  const msgs = document.getElementById('gemyt-msgs')
  const clearBtn = document.getElementById('gemyt-chat-clear')
  const tokensEl = document.getElementById('gemyt-tokens')
  const urlEl = document.getElementById('gemyt-url')
  if (!input || !sendBtn || !msgs) return

  let history = []   // [{role:'user'|'model', text}]
  let busy = false

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  }

  function linkify(escaped) {
    return escaped.replace(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g, (m, h, mm, ss) => {
      const secs = (h ? parseInt(h, 10) * 3600 : 0) + parseInt(mm, 10) * 60 + parseInt(ss, 10)
      return '<span class="gemyt-ts" data-secs="' + secs + '">' + m + '</span>'
    })
  }

  function scrollDown() { msgs.scrollTop = msgs.scrollHeight }

  function addMsg(kind, text) {
    const d = document.createElement('div')
    d.className = 'gemyt-msg ' + kind
    if (kind === 'model') {
      d.innerHTML = linkify(esc(text))
      d.querySelectorAll('.gemyt-ts').forEach((el) => {
        el.addEventListener('click', () => {
          const u = urlEl.value.trim()
          if (u && el.dataset.secs !== undefined) void window.tl.open(u + '&t=' + el.dataset.secs + 's')
        })
      })
    } else {
      d.textContent = text
    }
    msgs.appendChild(d)
    scrollDown()
    return d
  }

  function setBusy(on) {
    busy = on
    sendBtn.disabled = on
    sendBtn.textContent = on ? '…' : 'Send'
    input.disabled = on
  }

  // Progressive paint into the live model bubble.
  if (window.tl.onGemytChatChunk) {
    window.tl.onGemytChatChunk((chunk) => {
      const live = msgs.querySelector('.gemyt-msg.model.live')
      if (!live) return
      live.dataset.raw = (live.dataset.raw || '') + chunk
      live.innerHTML = linkify(esc(live.dataset.raw))
      scrollDown()
    })
  }

  async function send() {
    if (busy) return
    const url = urlEl.value.trim()
    const q = input.value.trim()
    if (!url) { addMsg('sys', 'Paste a YouTube link above first.'); return }
    if (!q) return

    addMsg('user', q)
    input.value = ''
    history.push({ role: 'user', text: q })

    const live = addMsg('model', '')
    live.classList.add('live')
    live.dataset.raw = ''
    setBusy(true)
    if (window.__gemytTimerStart) window.__gemytTimerStart()

    try {
      const r = await window.tl.gemytChat(url, history, q, {})
      live.classList.remove('live')
      if (!r || !r.ok) {
        live.className = 'gemyt-msg err'
        live.textContent = (r && r.error) || 'Chat failed.'
        history.pop()
      } else {
        live.dataset.raw = r.text
        live.innerHTML = linkify(esc(r.text))
        live.querySelectorAll('.gemyt-ts').forEach((el) => {
          el.addEventListener('click', () => {
            if (el.dataset.secs !== undefined) void window.tl.open(url + '&t=' + el.dataset.secs + 's')
          })
        })
        history.push({ role: 'model', text: r.text })
        if (tokensEl && r.session) {
          tokensEl.textContent = r.session.totalTokens.toLocaleString() + ' tok · ' +
            r.session.budgetPct + '%'
          if (r.session.budgetPct >= 80) tokensEl.style.color = 'var(--live)'
          if (r.cached) tokensEl.title = 'context cache active'
        }
        if (r.historyDropped > 0) {
          addMsg('sys', r.historyDropped + ' older turn(s) trimmed to bound cost.')
        }
      }
    } catch (e) {
      live.classList.remove('live')
      live.className = 'gemyt-msg err'
      live.textContent = e.message || String(e)
      history.pop()
    } finally {
      setBusy(false)
      if (window.__gemytTimerStop) window.__gemytTimerStop()
      scrollDown()
      input.focus()
    }
  }

  sendBtn.addEventListener('click', () => void send())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  })

  if (clearBtn) clearBtn.addEventListener('click', () => {
    history = []
    msgs.innerHTML = '<div class="gemyt-msg sys">Conversation cleared. Ask anything about the video.</div>'
  })

  // Forward the current conversation to the Journal tab.
  const fwdBtn = document.getElementById('gemyt-chat-forward')
  if (fwdBtn) fwdBtn.addEventListener('click', async () => {
    if (!history.length) return
    const url = urlEl.value.trim()
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const lines = history.map((m) => `**${m.role === 'user' ? 'You' : 'Gemini'}:** ${m.text}`)
    const entry = `\n\n## GemYT Chat ${stamp}\n${url}\n\n${lines.join('\n\n')}\n`
    try {
      const cur = (await window.tl.getJournal()) || ''
      const next = cur + entry
      await window.tl.saveJournal(next)
      fwdBtn.textContent = 'Saved ✓'
      setTimeout(() => { fwdBtn.textContent = '→ Journal' }, 1500)
    } catch (e) {
      fwdBtn.textContent = 'Failed'
      setTimeout(() => { fwdBtn.textContent = '→ Journal' }, 1500)
    }
  })

  // New video in the URL box -> reset the conversation (context is per-video).
  let lastUrl = urlEl.value
  setInterval(() => {
    if (urlEl.value !== lastUrl) {
      lastUrl = urlEl.value
      if (history.length) {
        history = []
        msgs.innerHTML = '<div class="gemyt-msg sys">New video loaded — conversation reset.</div>'
      }
    }
  }, 1500)
})();


/* --- GemYT timer: live elapsed counter + last-request readout ------------ */
(function gemytTimerInit() {
  const timerEl = document.getElementById('gemyt-timer')
  const chatTimerEl = document.getElementById('gemyt-chat-timer')
  if (!timerEl && !chatTimerEl) return

  let startedAt = 0
  let ticking = null

  function fmt(ms) {
    const s = ms / 1000
    if (s < 60) return s.toFixed(1) + 's'
    const m = Math.floor(s / 60)
    return m + 'm ' + (s - m * 60).toFixed(0) + 's'
  }

  function paint(html, busy) {
    for (const el of [timerEl, chatTimerEl]) {
      if (!el) continue
      el.innerHTML = html
      el.classList.toggle('busy', Boolean(busy))
    }
  }

  function start() {
    startedAt = Date.now()
    if (ticking) clearInterval(ticking)
    ticking = setInterval(() => {
      const el = startedAt ? Date.now() - startedAt : 0
      paint('analyzing… ' + fmt(el), true)
    }, 250)
  }

  function stop() {
    if (ticking) { clearInterval(ticking); ticking = null }
    const elapsed = startedAt ? Date.now() - startedAt : 0
    startedAt = 0
    paint('last: ' + fmt(elapsed) + ' (just now)', false)
  }

  // Expose to the GemYT/chat code paths via window (they're separate IIFEs).
  window.__gemytTimerStart = start
  window.__gemytTimerStop = stop

  // Settle the "ago" label periodically from the main-process clock.
  setInterval(async () => {
    if (ticking || !window.tl.gemytTiming) return
    try {
      const t = await window.tl.gemytTiming()
      if (t && t.lastRequestAt) {
        const ago = t.sinceLastMs != null ? t.sinceLastMs : Date.now() - t.lastRequestAt
        paint('last: ' + fmt(t.lastRequestMs || 0) + ' (' + fmt(ago) + ' ago)', false)
      }
    } catch (_e) { /* timing is cosmetic */ }
  }, 3000)

  // First paint from whatever the main process already knows.
  if (window.tl.gemytTiming) {
    void window.tl.gemytTiming().then((t) => {
      if (t && t.lastRequestAt) {
        paint('last: ' + fmt(t.lastRequestMs || 0) + ' (' + fmt(Date.now() - t.lastRequestAt) + ' ago)', false)
      } else {
        paint('no requests yet', false)
      }
    }).catch(() => {})
  }
})();