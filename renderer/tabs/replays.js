'use strict'
// Replays view extracted from renderer.js
// Exposes functions via window.__replays for renderer.js to call

(function() {
  function renderReplayList() {
    const listEl = $('replay-list')
    if (!listEl) return
    const rows = replayCache.filter(replayMatchesMu)
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">No ${replayMu === 'ALL' ? '' : replayMu + ' '}games in the latest ${replayCache.length} public games.<br>Full archive search needs a (free) RepMastered login — use a row link below.</div>`
      return
    }
    listEl.innerHTML = rows
      .map(
        (g) => `<div class="replay" data-url="${esc(g.url)}">
        <div class="r-head">
          <span class="badge BW">${esc(g.matchup || 'BW')}</span>
          <span class="s-name">${esc(g.players)}</span>
          <span class="s-viewers">${esc(g.length || '')} · ⏱ ${esc(g.avgApm || '')} APM</span>
        </div>
        <div class="s-title">🗺 ${esc(g.map)} · ${esc(g.date)}${g.ladder ? ` · ${esc(g.ladder)}` : ''}</div>
      </div>`,
      )
      .join('')
  }

  async function lookupReplays(players) {
    const listEl = $('replay-list')
    if (!listEl) return
    listEl.innerHTML = `<div class="loading">Loading latest replays${players ? ` for ${esc(players)}` : ''}…</div>`
    let r
    try {
      r = await window.tl.getReplays({ players: (players || '').trim() })
    } catch (e) {
      listEl.innerHTML = `<div class="empty">Replay fetch failed: ${esc(e.message)}</div>`
      return
    }
    if (r.errors && r.errors.length && !r.replays.length) {
      listEl.innerHTML = `<div class="empty">Replay fetch failed: ${esc(r.errors.join('; '))}</div>`
      return
    }
    replayCache = r.replays || []
    replaysLoaded = true
    if (!replayCache.length) {
      listEl.innerHTML = `<div class="empty">No games${players ? ` matching "${esc(players)}"` : ''} in the latest ${r.total || ''} public games.<br>Full archive search needs a (free) RepMastered login — use the link below.</div>`
      return
    }
    renderReplayList()
  }

  function initReplaysTab() {
    document.getElementById('replay-go').addEventListener('click', () => {
      lookupReplays(document.getElementById('replay-input').value)
    })
    document.getElementById('replay-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') lookupReplays(e.target.value)
    })
    document.querySelectorAll('.mu-chip').forEach((c) =>
      c.addEventListener('click', () => {
        document.querySelectorAll('.mu-chip').forEach((x) => x.classList.remove('active'))
        c.classList.add('active')
        replayMu = c.dataset.mu || 'ALL'
        if (replaysLoaded) renderReplayList()
        else lookupReplays(document.getElementById('replay-input').value)
      }),
    )
    // Auto-load the first time the Replays tab opens (search alone never fires it).
    document.querySelector('[data-tab="replays"]').addEventListener('click', () => {
      if (!replaysLoaded) lookupReplays('')
    })
  }

  // Expose to renderer.js
  window.__replays = { renderReplayList, lookupReplays, initReplaysTab }
})()
