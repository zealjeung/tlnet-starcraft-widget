'use strict'
// Analysis view extracted from renderer.js
// Exposes functions via window.__analysis for renderer.js to call

(function() {
  function renderAnalysisView(pane) {
    const paneId = pane || (state.analysis && state.analysis.pane) || 'panel-matches'
    const el = $(paneId)
    if (!el) return
    const a = state.analysis
    if (!a) return
    const backLabel = paneId === 'panel-analysis' ? '‹ Analysis' : '‹ Matches'
    const head = `<div class="bracket-head">
      <button class="backbtn" id="btn-back-analysis">${backLabel}</button>
      <span class="bracket-title">${esc(a.title)}</span>
    </div>`
    if (a.loading) {
      el.innerHTML = head + '<div class="loading">Checking for analysis…</div>'
    } else if (a.markdown) {
      const bst = (a.progress && a.progress.stage) || ''
      const banner = bst === 'sources_unavailable'
        ? `<div class="brief-warn">⚠ Written from incomplete sources. Some details could not be verified and may be wrong or invented — check before relying on them.</div>`
        : ''
      el.innerHTML = head + banner + `<div class="brief">${md(a.markdown)}</div>`
    } else if (a.requested || (a.progress && a.progress.stage && a.progress.stage !== 'ready')) {
      const st = (a.progress && a.progress.stage) || 'requested'
      el.innerHTML = head + `<div class="empty">
        ${stagesHtml(st)}
        ${isTerminal(st)
          ? ''
          : `<div class="stage-line">${esc(stageVerb(st))} · ${esc(a.elapsed || elapsedSince(a.progress))}</div>`}
        ${a.progress && a.progress.detail ? `<span class="dim">${esc(a.progress.detail)}</span><br>` : ''}
        ${!isTerminal(st) && stuckMs(a.progress) > 10 * 60 * 1000
          ? `<span class="dim">Still working after ${esc(elapsedSince(a.progress))} — if it looks stuck, tell zer0 to retry.</span><br>`
          : ''}
        ${isTerminal(st)
          ? `<span class="dim">${esc(stageHint(st))}</span><br>`
          : `<span class="dim">Tell zer0 to run it, or leave this open — auto-checks every 30s for ~10 min.</span><br>`}
        <button class="backbtn" id="btn-recheck">↻ Check now</button></div>`
    } else {
      el.innerHTML = head + `<div class="empty">Couldn't load analysis.<br><span class="dim">${esc(a.error || 'unknown error')}</span></div>`
    }
    const back = $('btn-back-analysis')
    if (back) back.addEventListener('click', () => {
      state.analysis = null
      render()
    })
    const recheck = $('btn-recheck')
    if (recheck) recheck.addEventListener('click', () => {
      if (state.analysis && state.analysis.q) void openAnalysis(state.analysis.q, true)
    })
  }

  async function openAnalysis(q, isRecheck, pane) {
    const title = `${q.p1 || '?'} vs ${q.p2 || '?'}`
    const paneId = pane || (state.analysis && state.analysis.pane) || 'panel-matches'
    if (!isRecheck) {
      state.analysis = { title, loading: true, q, pane: paneId }
      renderAnalysisView(paneId)
    }
    try {
      const r = await window.tl.getAnalysis(q)
      if (r && r.status === 'ready') {
        state.analysis = { title, markdown: r.markdown, q, pane: paneId, progress: r.progress || null }
      } else {
        const req = await window.tl.requestAnalysis(q)
        const progress = (req && req.progress) || (r && r.progress) || null
        const prev = state.analysis || {}
        const stNow = (progress && progress.stage) || 'requested'
        state.analysis = {
          title, requested: true, q, pane: paneId, progress,
          elapsed: elapsedSince(progress),
          polls: prev.polls || 0,
        }
        if (!isTerminal(stNow)) scheduleAnalysisRecheck(q, title, paneId)
      }
    } catch (e) {
      state.analysis = { title, error: e.message, q, pane: paneId }
    }
    renderAnalysisView(paneId)
  }

  function scheduleAnalysisRecheck(q, title, paneId) {
    const tok = state.analysis
    const n = (tok && tok.polls) || 0
    if (n >= 20) return
    setTimeout(async () => {
      if (state.analysis !== tok) return
      try {
        const r = await window.tl.getAnalysis(q)
        if (r && r.status === 'ready') {
          state.analysis = { title, markdown: r.markdown, q, pane: paneId }
        } else {
          const progress = (r && r.progress) || tok.progress
          const stP = (progress && progress.stage) || ''
          state.analysis = { ...tok, progress, elapsed: elapsedSince(progress), polls: n + 1 }
          if (!isTerminal(stP)) scheduleAnalysisRecheck(q, title, paneId)
        }
      } catch {
        const stErr = (tok.progress && tok.progress.stage) || ''
        if (!isTerminal(stErr)) scheduleAnalysisRecheck(q, title, paneId)
      }
      if (state.analysis) renderAnalysisView(paneId)
    }, 30000)
  }

  function prettySlug(s) {
    return String(s || 'match').replace(/-/g, ' ')
  }

  async function renderAnalysis() {
    const el = $('panel-analysis')
    if (!el) return
    if (state.analysis && state.analysis.pane === 'panel-analysis') {
      renderAnalysisView('panel-analysis')
      return
    }
    let list = state.analysisList || []
    let pending = state.analysisPending || []
    try {
      const r = await window.tl.listAnalysis()
      if (r && Array.isArray(r.briefs)) {
        list = r.briefs
        state.analysisList = list
      }
      if (r && Array.isArray(r.pending)) {
        pending = r.pending
        state.analysisPending = pending
      }
    } catch (e) {
      // listAnalysis is best-effort; the tab still renders from cache
    }
    const rows = list.map((b) => {
      const slug = prettySlug(b.slug)
      const at = b.at ? ago(b.at) : ''
      return `<div class="analysis-row" data-slug="${esc(b.slug)}">
        <div class="ar-head">
          <span class="ar-title">${esc(b.title || slug)}</span>
          <span class="ar-at">${esc(at)}</span>
        </div>
        <div class="ar-meta">${esc(b.model || '')} · ${esc(b.ms ? b.ms + 'ms' : '')}</div>
      </div>`
    }).join('')
    const pendingRows = pending.map((p) => {
      const slug = prettySlug(p.slug)
      const st = (p.progress && p.progress.stage) || 'requested'
      return `<div class="analysis-row pending" data-slug="${esc(p.slug)}">
        <div class="ar-head">
          <span class="ar-title">${esc(p.title || slug)}</span>
          <span class="ar-at">${esc(st)}</span>
        </div>
        <div class="ar-meta">Waiting for zer0…</div>
      </div>`
    }).join('')
    el.innerHTML = `<div class="bracket-head">
        <span class="bracket-title">Analysis</span>
      </div>
      ${pendingRows}
      ${rows || '<div class="empty">No analyses yet. Click "Analyze" on a finished match.</div>'}`
    el.querySelectorAll('.analysis-row').forEach((row) => {
      row.addEventListener('click', () => {
        const slug = row.dataset.slug
        const brief = list.find((b) => b.slug === slug)
        if (brief) {
          state.analysis = { title: brief.title, markdown: brief.markdown, pane: 'panel-analysis' }
          renderAnalysisView('panel-analysis')
        }
      })
    })
  }

  // Run Analysis button — on-demand check for pending requests
  async function initRunAnalysisBtn() {
    const btn = $('btn-run-analysis')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '⏳ Checking…'
      try {
        const r = await window.tl.runAnalysisSweep()
        if (r && r.ok && r.pending > 0) {
          const slugs = r.slugs.join(', ')
          alert(`${r.pending} pending analysis request(s): ${slugs}\n\nAsk zer0 to process them.`)
        } else if (r && r.ok) {
          alert('No pending analysis requests.')
        } else {
          alert('Error: ' + (r?.error || 'unknown'))
        }
      } catch (e) {
        alert('Error: ' + e.message)
      } finally {
        btn.disabled = false
        btn.textContent = '▶ Run Analysis'
      }
    })
  }
  initRunAnalysisBtn()

  // Expose to renderer.js
  window.__analysis = { renderAnalysisView, openAnalysis, scheduleAnalysisRecheck, prettySlug, renderAnalysis }
})()
