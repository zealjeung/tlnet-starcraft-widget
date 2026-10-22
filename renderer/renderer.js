'use strict'

const state = {
  tab: 'news',
  game: 'ALL',
  news: [],
  matches: [],
  tournaments: [],
  bracket: null,
  analysis: null,
  analysisList: [],
  analysisListAt: 0,
  changes: [],
  streams: [],
  femsc: [],
  femscAt: null,
  femscOffline: [],
  fromCache: false,
  integrity: null,
  newsAt: null,
  matchesAt: null,
  tournAt: null,
  status: { news: 'loading', matches: 'loading', tournaments: 'loading' },
}

const $ = (id) => document.getElementById(id)


// "Arrived in the app" timer — DISTINCT from `ago()` (when the author posted /
// event happened) and `countdown()` (when a match is scheduled). This tracks
// how long ago the item first appeared in the widget. Items newer than 15 min
// get a live "NEW" pill with its own arrival countdown.
const NEW_WINDOW_MS = 15 * 60 * 1000
const _seenArrivals = new Set() // keys seen this session (persist across renders)
function arrivalKey(item) {
  if (item.link) return 'n:' + item.link
  if (item.url && !item.link) return 'u:' + item.url
  if (item.title) return 't:' + item.title
  if (item.p1 && item.p2 && item.timestamp) return `m:${item.p1}|${item.p2}|${item.timestamp}`
  return 'x:' + JSON.stringify(item).slice(0, 80)
}
// Stamp _arrived on items that are genuinely new this session. `fromCache` data
// (boot/prime or stale fallback) must NOT be marked new — those aren't arrivals.
function markArrivals(list, fromCache) {
  if (!Array.isArray(list)) return list
  for (const it of list) {
    const k = arrivalKey(it)
    if (_seenArrivals.has(k)) {
      // already known; keep its original arrival stamp if present
      continue
    }
    _seenArrivals.add(k)
    if (!fromCache) it._arrived = Date.now()
  }
  return list
}
function arrivedAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}
function isNew(ts) {
  return !!ts && Date.now() - ts < NEW_WINDOW_MS
}
// New-pill HTML. Carries data-arrived so the 1s ticker can refresh its label.
function newBadge(item) {
  if (!isNew(item._arrived)) return ''
  return `<span class="newbadge" data-arrived="${item._arrived}">NEW ${arrivedAgo(item._arrived)}</span>`
}

function matchGame(g) {
  return state.game === 'ALL' || g === state.game || (state.game === 'SC2' && g === 'SC')
}

// Compact day-level countdown for calendar chips ("5d", "tmrw", "soon").
// Full precision lives in the chip tooltip via countdown().
function shortCountdown(ts) {
  if (!ts) return ''
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const d = Math.ceil((ts - startOfToday.getTime()) / 864e5)
  if (d <= 0) return 'soon'
  if (d === 1) return 'tmrw'
  return `${d}d`
}

function renderNews() {
  const el = $('panel-news')
  const items = state.news.filter((i) => matchGame(i.game))
  if (!items.length) {
    el.innerHTML = `<div class="empty">${
      state.status.news === 'loading' ? 'Loading TL.net news…' : 'No StarCraft news for this filter.'
    }</div>`
    return
  }
  el.innerHTML = items
    .map(
      (i) => `<div class="item" data-url="${esc(i.link)}">
        <div class="row1">
          <span class="badge ${esc(i.game)}">${esc(i.game)}</span>
          <span class="src">${esc(i.source || 'TL.net')}</span>
          ${newBadge(i)}
          <span class="when">${esc(ago(i.timestamp))}</span>
        </div>
        <div class="title">${esc(i.title)}</div>
        <div class="meta">${esc(i.author || (i.source === 'TL.net' ? 'TL.net' : 'Liquipedia'))}${i.category ? ' · ' + esc(i.category) : ''}</div>
      </div>`,
    )
    .join('')
}

function renderMatches() {
  const el = $('panel-matches')
  const items = state.matches.filter((m) => matchGame(m.game))
  const live = items.filter((m) => m.live)
  $('livecount').textContent = live.length ? `● ${live.length} LIVE` : ''

  if (!items.length) {
    el.innerHTML = `<div class="empty">${
      state.status.matches === 'loading' ? 'Loading matches…' : 'No upcoming StarCraft matches.'
    }</div>`
    return
  }

  const row = (m) => {
    const url = m.live && m.streamUrl ? m.streamUrl : m.tournamentUrl || 'https://tl.net/'
    const r1 = m.race1 ? `<span class="race ${esc(m.race1)}"></span>` : ''
    const r2 = m.race2 ? `<span class="race ${esc(m.race2)}"></span>` : ''
    const tag = m.live ? 'LIVE' : m.finished ? 'FINAL' : countdown(m.timestamp)
    return `<div class="match ${m.live ? 'live' : ''} ${m.finished ? 'result' : ''}" data-url="${esc(url)}">
      <div class="players">
        ${m.live ? '<span class="livedot"></span>' : ''}
        <span class="p">${r1}${esc(m.p1)}</span>
        <span class="vs">vs</span>
        <span class="p">${r2}${esc(m.p2)}</span>
      </div>
      <div class="sub">
        ${newBadge(m)}
        <span class="badge ${esc(m.game)}">${esc(m.game)}</span>
        ${m.bo ? `<span>${esc(m.bo)}</span>` : ''}
        <span class="tourn">${esc(m.tournament || '')}</span>
        <span class="cd ${m.finished ? 'final' : ''}">${esc(tag)}</span>
        ${m.finished && m.p1 !== 'TBD' && m.p2 !== 'TBD' ? `<button class="abtn" data-a-p1="${esc(m.p1)}" data-a-p2="${esc(m.p2)}" data-a-t="${esc(m.tournament || '')}" data-a-game="${esc(m.game || '')}" data-a-bo="${esc(m.bo || '')}">Analyze</button>` : ''}
      </div>
    </div>`
  }

  const upcoming = items.filter((m) => !m.live && !m.finished)
  const results = items.filter((m) => m.finished)
  let html = ''
  if (live.length) html += `<div class="grouphead">Live now</div>` + live.map(row).join('')
  if (upcoming.length) html += `<div class="grouphead">Upcoming</div>` + upcoming.map(row).join('')
  if (results.length) html += `<div class="grouphead">Recent results</div>` + results.map(row).join('')
  el.innerHTML = html
}

let calCursor = null // { y, m } — persists in-session, defaults to current month

function shiftCal(delta) {
  if (!calCursor) {
    const n = new Date()
    calCursor = { y: n.getFullYear(), m: n.getMonth() }
  }
  const d = new Date(calCursor.y, calCursor.m + delta, 1)
  calCursor = { y: d.getFullYear(), m: d.getMonth() }
  renderTournaments()
}

function renderTournaments() {
  const el = $('panel-tournaments')
  const items = state.tournaments.filter((t) => matchGame(t.game))
  const changes = (state.changes || []).filter((c) => matchGame(c.game))
  if (!items.length && !changes.length) {
    el.innerHTML = `<div class="empty">${
      state.status.tournaments === 'loading' ? 'Loading events…' : 'No StarCraft events.'
    }</div>`
    return
  }

  // Truly-live tournaments: an event only earns red when a match from it is
  // being played RIGHT NOW (matches tab drives this via m.live). Everything
  // else ongoing is merely underway — amber, steady, honest.
  // Matcher lives in livetourn.js (loaded before this script) so it is unit-tested.
  const liveTourns = buildLiveTournSet(state.matches)
  const isLiveNowRow = (t) => isLiveNow(t.name, liveTourns)

  const row = (t) => {
    const live = t.status === 'ongoing' && isLiveNowRow(t)
    const prog = t.status === 'ongoing' && !live
    const cls = live ? 'live' : prog ? 'inprogress' : ''
    const dot = live ? '<span class="livedot"></span>' : prog ? '<span class="progdot"></span>' : ''
    const status = live ? 'LIVE now' : prog ? 'In progress' : 'Upcoming'
    const cd = live ? 'LIVE' : prog ? 'Underway' : countdown(t.timestamp)
    return `<div class="match ${cls}" data-bracket="${esc(t.url || '')}" data-name="${esc(t.name)}">
      <div class="players">
        ${dot}
        <span class="p">${esc(t.name)}</span>
        <span class="chev">›</span>
      </div>
      <div class="sub">
        ${newBadge(t)}
        <span class="badge ${esc(t.game)}">${esc(t.game)}</span>
        <span class="tourn">${status}</span>
        <span class="cd">${esc(cd)}</span>
      </div>
    </div>`
  }

  const changeRow = (c) => `<div class="match" data-url="${esc(c.url || 'https://liquipedia.net')}">
      <div class="players">
        <span class="p">${esc(c.title)}</span>
      </div>
      <div class="sub">
        ${newBadge(c)}
        <span class="badge ${esc(c.game)}">${esc(c.game)}</span>
        <span class="cd">${esc(c.age || '')}</span>
      </div>
    </div>`

  const now = new Date()
  if (!calCursor) calCursor = { y: now.getFullYear(), m: now.getMonth() }
  const { y, m } = calCursor
  const monthName = new Date(y, m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const chip = (t) => {
    const live = t.status === 'ongoing' && isLiveNowRow(t)
    const prog = t.status === 'ongoing' && !live
    // Upcoming with a known start date: anticipation hint — compact countdown
    // suffix + tooltip with the full date. This is the calendar's job.
    const up = t.status !== 'ongoing' && t.timestamp
    const upCd = up ? `<span class="upcd">${esc(shortCountdown(t.timestamp))}</span>` : ''
    const cls = live ? 'live' : prog ? 'inprogress' : up ? 'up' : ''
    const dot = live ? '<span class="livedot"></span>' : prog ? '<span class="progdot"></span>' : ''
    const tip = up
      ? `${t.name} — ${new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${countdown(t.timestamp)})`
      : t.name
    return `<button class="cal-chip ${cls} ${esc(t.game)}" data-bracket="${esc(t.url || '')}" data-name="${esc(t.name)}" title="${esc(tip)}">${dot}<span class="chipname">${esc(t.name)}</span>${upCd}</button>`
  }

  const ongoing = items.filter((t) => t.status === 'ongoing')
  const dated = items.filter((t) => t.status !== 'ongoing' && t.timestamp)
  const tba = items.filter((t) => t.status !== 'ongoing' && !t.timestamp)

  const byDay = {}
  dated.forEach((t) => {
    const d = new Date(t.timestamp)
    if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ||= []).push(t)
  })
  // Ongoing events have no pinnable date (Liquipedia dropped timer-objects
  // from SC2 cards; BW lists never had them) — but they ARE happening now,
  // so pin them to today's cell when viewing the current month. Otherwise
  // the grid is all empty boxes and events only exist in the list below.
  if (y === now.getFullYear() && m === now.getMonth()) {
    const today = now.getDate()
    ongoing.forEach((t) => {
      if (matchGame(t.game)) (byDay[today] ||= []).push(t)
    })
  }
  const first = new Date(y, m, 1).getDay() // 0 = Sunday
  const days = new Date(y, m + 1, 0).getDate()
  let cells = ''
  for (let i = 0; i < first; i++) cells += '<div class="cal-day pad"></div>'
  for (let d = 1; d <= days; d++) {
    const isToday = y === now.getFullYear() && m === now.getMonth() && d === now.getDate()
    cells += `<div class="cal-day${isToday ? ' today' : ''}"><span class="cal-num">${d}</span>${(byDay[d] || []).map(chip).join('')}</div>`
  }

  let html = ''
  if (ongoing.length) html += '<div class="grouphead">In progress</div>' + ongoing.map(row).join('')
  html += `<div class="cal-nav">
      <button class="backbtn" id="cal-prev">‹</button>
      <span class="cal-title">${monthName}</span>
      <button class="backbtn" id="cal-next">›</button>
      <button class="backbtn" id="cal-today">Today</button>
    </div>
    <div class="cal-dow"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
    <div class="cal-grid">${cells}</div>`
  if (!dated.length) html += '<div class="cal-note">No dated events on the board — SC2 events with start times pin to their days here.</div>'
  if (tba.length) html += '<div class="grouphead">Date TBA</div>' + tba.map(row).join('')
  if (changes.length) html += '<div class="grouphead">Recent wiki activity</div>' + changes.map(changeRow).join('')
  el.innerHTML = html
  $('cal-prev').onclick = () => shiftCal(-1)
  $('cal-next').onclick = () => shiftCal(1)
  $('cal-today').onclick = () => {
    const n = new Date()
    calCursor = { y: n.getFullYear(), m: n.getMonth() }
    renderTournaments()
  }

}

function renderStatus() {
  const s = $('status')
  const parts = []
  if (state.status.matches === 'error') parts.push('matches failed')
  if (state.status.tournaments === 'error') parts.push('events failed')

  const updated = Math.max(state.matchesAt || 0, state.tournAt || 0)
  const age = updated ? Date.now() - updated : null

  if (parts.length) {
    s.className = 'error'
    s.textContent = parts.join(' · ')
  } else {
    let cls = ''
    if (age != null && age > 2 * 3600 * 1000) cls = 'error'
    else if (age != null && age > 30 * 60 * 1000) cls = 'warn'
    else if (state.fromCache) cls = 'warn'
    s.className = cls
    const cached = state.fromCache ? ' · cached' : ''
    s.textContent = `${state.matches.length} matches · ${state.tournaments.length} events · ${ago(updated) || '—'}${cached}`
  }

  const warn = $('integrity')
  if (!warn) return
  const problems = state.integrity || []
  if (problems.length) {
    warn.style.display = 'block'
    warn.textContent = `⚠ ${problems[0]}`
    warn.title = problems.join('\n')
  } else {
    warn.style.display = 'none'
  }
}

/* ---- bracket drill-down ---- */

function renderBracketView() {
  const el = $('panel-tournaments')
  const b = state.bracket
  if (!b) return

  const head = `<div class="bracket-head">
      <button class="backbtn" id="btn-back">‹ Events</button>
      <span class="bracket-title">${esc(b.name)}</span>
    </div>`

  if (b.loading) {
    el.innerHTML = head + '<div class="loading">Loading bracket…</div>'
    bindBracketBack()
    return
  }
  if (b.error) {
    el.innerHTML = head + `<div class="empty">Couldn't load bracket.<br><span class="dim">${esc(b.error)}</span></div>`
    bindBracketBack()
    return
  }

  const opp = (o, win) =>
    `<div class="bopp ${win ? 'win' : ''}">
       ${o.race ? `<span class="race ${esc(o.race)}"></span>` : '<span class="race"></span>'}
       <span class="bname">${esc(o.name)}</span>
       <span class="bscore">${esc(o.score ?? '-')}</span>
     </div>`

  const matchRow = (m) => {
    const [a, c] = m.opponents
    const aw = m.winner ? m.winner === a.name : a.winner
    const cw = m.winner ? m.winner === c.name : c.winner
    const when = m.timestamp && !m.finished ? countdown(m.timestamp) : m.finished ? 'final' : ''
    return `<div class="bmatch">
        ${opp(a, aw)}${opp(c, cw)}
        ${when ? `<div class="bwhen">${esc(when)}</div>` : ''}
      </div>`
  }

  let html = head
  for (const br of b.brackets || []) {
    if (br.rounds && br.rounds.length) {
      html += `<div class="grouphead">${esc(br.rounds.join(' · '))}</div>`
    } else {
      html += '<div class="grouphead">Bracket</div>'
    }
    html += br.matches.map(matchRow).join('')
  }
  for (const ml of b.matchlists || []) {
    html += `<div class="grouphead">${esc(ml.title)}</div>`
    html += ml.matches.map(matchRow).join('')
  }
  if (!(b.brackets || []).length && !(b.matchlists || []).length) {
    html += '<div class="empty">No bracket published yet for this event.</div>'
  }
  el.innerHTML = html
  bindBracketBack()
}

function bindBracketBack() {
  const back = $('btn-back')
  if (back) back.addEventListener('click', () => {
    state.bracket = null
    render()
  })
}

async function openBracket(url, name) {
  state.bracket = { name, loading: true }
  renderBracketView()
  const data = await window.tl.getBracket(url)
  state.bracket = { name, ...data }
  renderBracketView()
}

/* ---- match analysis (Phase A: on-click briefs) ----
 * Same drill-down pattern as the bracket view: state-driven sub-view painted
 * over panel-matches, back button clears state. md() is a minimal SAFE subset
 * (HTML is escaped first) — enough for agent-written briefs. */
function md(src) {
  const lines = String(src || '').split('\n')
  let html = ''
  let inList = false
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)/)
    const li = line.match(/^\s*[-*]\s+(.*)/)
    if (h) {
      if (inList) { html += '</ul>'; inList = false }
      const lvl = h[1].length
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`
    } else if (li) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(li[1])}</li>`
    } else if (!line.trim()) {
      if (inList) { html += '</ul>'; inList = false }
    } else {
      if (inList) { html += '</ul>'; inList = false }
      html += `<p>${inline(line.trim())}</p>`
    }
  }
  if (inList) html += '</ul>'
  return html
}

/* Progress UI: stage steps + elapsed time. Deliberately no percentages or
 * ETA — research is real work, not a download. Stages come from
 * analyses/_status/<slug>.json, advanced by the fulfilling agent. */
const ASTAGES = ['requested', 'researching', 'writing', 'ready']
/* Terminal states that are NOT success. The fulfilling agent sets these when it
 * cannot verify a brief's facts (e.g. sources blocked). Polling must stop and
 * the ladder must NOT be shown — rendering "1 · requested" would claim the job
 * is still queued when it has actually finished. */
const ASTALL = ['failed', 'sources_unavailable']
function isTerminal(stage) {
  return stage === 'ready' || ASTALL.includes(stage)
}
function stageIdx(stage) {
  if (ASTALL.includes(stage)) return -1
  const i = ASTAGES.indexOf(stage)
  return i < 0 ? 0 : i
}
function stagesHtml(stage) {
  if (ASTALL.includes(stage)) {
    const cls = stage === 'failed' ? 'stage-failed' : 'stage-blocked'
    return `<div class="${cls}">${esc(stageVerb(stage))}</div>`
  }
  const cur = stageIdx(stage)
  return `<div class="stages">` + ASTAGES.map((s, i) =>
    `<span class="stage${i < cur ? ' done' : ''}${i === cur ? ' cur' : ''}">${i + 1} · ${esc(s)}</span>`,
  ).join('<span class="stage-sep">→</span>') + `</div>`
}
function stageVerb(st) {
  if (st === 'requested') return 'Queued'
  if (st === 'researching') return 'Researching'
  if (st === 'writing') return 'Writing brief'
  if (st === 'failed') return "Couldn't process this request — something went wrong on our end"
  if (st === 'sources_unavailable') return 'Brief ready — but written from incomplete sources'
  return st || 'Queued'
}
/* What to tell the user in a terminal non-success state. */
function stageHint(st) {
  if (st === 'sources_unavailable') {
    return 'The brief exists and you can read it, but some details could not be verified and may be wrong or invented. Check anything you plan to rely on.'
  }
  if (st === 'failed') return 'Tell zer0 what you saw — the error is logged.'
  return ''
}
/* How long the current stage has been unchanged, in ms. */
function stuckMs(progress) {
  const t = (progress && progress.updatedAt) || 0
  return t ? Math.max(0, Date.now() - t) : 0
}
function elapsedSince(progress) {
  const t = (progress && progress.updatedAt) || Date.now()
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}


/* ---- bracket drill-down ---- */

function renderBracketView() {
  const el = $('panel-tournaments')
  const b = state.bracket
  if (!b) return

  const head = `<div class="bracket-head">
      <button class="backbtn" id="btn-back">‹ Events</button>
      <span class="bracket-title">${esc(b.name)}</span>
    </div>`

  if (b.loading) {
    el.innerHTML = head + '<div class="loading">Loading bracket…</div>'
    bindBracketBack()
    return
  }
  if (b.error) {
    el.innerHTML = head + `<div class="empty">Couldn't load bracket.<br><span class="dim">${esc(b.error)}</span></div>`
    bindBracketBack()
    return
  }

  const opp = (o, win) =>
    `<div class="bopp ${win ? 'win' : ''}">
       ${o.race ? `<span class="race ${esc(o.race)}"></span>` : '<span class="race"></span>'}
       <span class="bname">${esc(o.name)}</span>
       <span class="bscore">${esc(o.score ?? '-')}</span>
     </div>`

  const matchRow = (m) => {
    const [a, c] = m.opponents
    const aw = m.winner ? m.winner === a.name : a.winner
    const cw = m.winner ? m.winner === c.name : c.winner
    const when = m.timestamp && !m.finished ? countdown(m.timestamp) : m.finished ? 'final' : ''
    return `<div class="bmatch">
        ${opp(a, aw)}${opp(c, cw)}
        ${when ? `<div class="bwhen">${esc(when)}</div>` : ''}
      </div>`
  }

  let html = head
  for (const br of b.brackets || []) {
    if (br.rounds && br.rounds.length) {
      html += `<div class="grouphead">${esc(br.rounds.join(' · '))}</div>`
    } else {
      html += '<div class="grouphead">Bracket</div>'
    }
    html += br.matches.map(matchRow).join('')
  }
  for (const ml of b.matchlists || []) {
    html += `<div class="grouphead">${esc(ml.title)}</div>`
    html += ml.matches.map(matchRow).join('')
  }
  if (!(b.brackets || []).length && !(b.matchlists || []).length) {
    html += '<div class="empty">No bracket published yet for this event.</div>'
  }
  el.innerHTML = html
  bindBracketBack()
}

function bindBracketBack() {
  const back = $('btn-back')
  if (back) back.addEventListener('click', () => {
    state.bracket = null
    render()
  })
}

async function openBracket(url, name) {
  state.bracket = { name, loading: true }
  renderBracketView()
  const data = await window.tl.getBracket(url)
  state.bracket = { name, ...data }
  renderBracketView()
}

/* ---- match analysis (Phase A: on-click briefs) ----
 * Same drill-down pattern as the bracket view: state-driven sub-view painted
 * over panel-matches, back button clears state. md() is a minimal SAFE subset
 * (HTML is escaped first) — enough for agent-written briefs. */
function md(src) {
  const lines = String(src || '').split('\n')
  let html = ''
  let inList = false
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)/)
    const li = line.match(/^\s*[-*]\s+(.*)/)
    if (h) {
      if (inList) { html += '</ul>'; inList = false }
      const lvl = h[1].length
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`
    } else if (li) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(li[1])}</li>`
    } else if (!line.trim()) {
      if (inList) { html += '</ul>'; inList = false }
    } else {
      if (inList) { html += '</ul>'; inList = false }
      html += `<p>${inline(line.trim())}</p>`
    }
  }
  if (inList) html += '</ul>'
  return html
}

/* What to tell the user in a terminal non-success state. */
function stageHint(st) {
  if (st === 'sources_unavailable') {
    return 'The brief exists and you can read it, but some details could not be verified and may be wrong or invented. Check anything you plan to rely on.'
  }
  if (st === 'failed') return 'Tell zer0 what you saw — the error is logged.'
  return ''
}
/* How long the current stage has been unchanged, in ms. */
function stuckMs(progress) {
  const t = (progress && progress.updatedAt) || 0
  return t ? Math.max(0, Date.now() - t) : 0
}
function elapsedSince(progress) {
  const t = (progress && progress.updatedAt) || Date.now()
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

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
    // A brief written from partial sources may contain INVENTED details.
    // Warn on the document itself -- the reader must not trust it blindly.
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
      // Keep progress: the brief may have been written from partial
      // sources, and the panel must warn about that (see renderAnalysisView).
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

/** Re-poll getAnalysis every 30s (~10 min) while the pane stays open. */
function scheduleAnalysisRecheck(q, title, paneId) {
  const tok = state.analysis
  const n = (tok && tok.polls) || 0
  if (n >= 20) return
  setTimeout(async () => {
    if (state.analysis !== tok) return // user navigated away
    try {
      const r = await window.tl.getAnalysis(q)
      if (r && r.status === 'ready') {
        state.analysis = { title, markdown: r.markdown, q, pane: paneId }
      } else {
        const progress = (r && r.progress) || tok.progress
        const stP = (progress && progress.stage) || ''
        state.analysis = { ...tok, progress, elapsed: elapsedSince(progress), polls: n + 1 }
        // Terminal non-success: stop polling, the job is finished.
        if (!isTerminal(stP)) scheduleAnalysisRecheck(q, title, paneId)
      }
    } catch {
      // Do not resurrect polling for a request that already finished.
      const stErr = (tok.progress && tok.progress.stage) || ''
      if (!isTerminal(stErr)) scheduleAnalysisRecheck(q, title, paneId)
    }
    if (state.analysis) renderAnalysisView(paneId)
  }, 30000)
}

/* ---- Analysis tab: library of finished briefs + pending requests ----
 * Finished matches age out of the Matches tab's 3-day window; briefs live
 * here permanently. Clicking a row re-opens it through the same
 * openAnalysis() drill-down, painted into this panel. */
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
    state.analysisListAt = Date.now()
  } catch { /* keep last list on IPC failure */ }
  const items = list.filter((b) => !b.game || matchGame(b.game))
  const pendingItems = pending.filter((b) => !b.game || matchGame(b.game))
  if (!items.length && !pendingItems.length) {
    el.innerHTML = '<div class="empty">No analyzed matches yet.<br><span class="dim">Click Analyze on any finished match — briefs land here permanently.</span></div>'
    return
  }
  let html = ''
  if (items.length) {
    html += '<div class="grouphead">Analyzed matches</div>' + items.map((b) => {
      if (!b.p1 || !b.p2) {
        return `<div class="match result"><div class="players"><span class="p">${esc(prettySlug(b.slug))}</span></div>`
          + `<div class="sub"><span class="cd final">brief</span></div></div>`
      }
      return `<div class="match result" data-b-p1="${esc(b.p1)}" data-b-p2="${esc(b.p2)}" data-b-t="${esc(b.tournament || '')}" data-b-game="${esc(b.game || '')}">`
        + `<div class="players"><span class="p">${esc(b.p1)}</span><span class="vs">vs</span><span class="p">${esc(b.p2)}</span></div>`
        + `<div class="sub">${b.game ? `<span class="badge ${esc(b.game)}">${esc(b.game)}</span>` : ''}`
        + `${b.tournament ? `<span class="tourn">${esc(b.tournament)}</span>` : ''}`
        + `<span class="cd final">brief</span></div></div>`
    }).join('')
  }
  if (pendingItems.length) {
    html += '<div class="grouphead">Pending analysis</div>' + pendingItems.map((b) => {
      const st = (b.progress && b.progress.stage) || 'requested'
      const elapsed = elapsedSince(b.progress)
      return `<div class="match result" data-b-p1="${esc(b.p1 || '?')}" data-b-p2="${esc(b.p2 || '?')}" data-b-t="${esc(b.tournament || '')}" data-b-game="${esc(b.game || '')}" data-b-slug="${esc(b.slug)}">`
        + `<div class="players"><span class="p">${esc(b.p1 || '?')}</span><span class="vs">vs</span><span class="p">${esc(b.p2 || '?')}</span></div>`
        + `<div class="sub">${b.game ? `<span class="badge ${esc(b.game)}">${esc(b.game)}</span>` : ''}`
        + `${b.tournament ? `<span class="tourn">${esc(b.tournament)}</span>` : ''}`
        + `<span class="cd final">${esc(st)}</span><span class="dim"> · ${esc(elapsed)}</span></div></div>`
    }).join('')
  }
  el.innerHTML = html
  // Click handled globally: document listener on [data-b-p1] calls openAnalysis('panel-analysis').
}

function render() {
  renderNews()
  renderMatches()
  if (state.analysis && (!state.analysis.pane || state.analysis.pane === 'panel-matches')) renderAnalysisView('panel-matches')
  void renderAnalysis()
  if (state.bracket) renderBracketView()
  else renderTournaments()
  renderStreams()
  renderFemsc()
  renderBuildOrders()
  renderBooks()
  renderStatus()
}

/* ---- Activity tab ----
 * Pure wiki-edit pulse ("what changed recently"). Live matches belong to the
 * Matches tab (its "Live now" group) — keeping them here too would duplicate.
 */
function renderLive() {
  const el = $('panel-live')
  if (!el) return

  const changes = (state.changes || []).filter((c) => matchGame(c.game))

  if (!changes.length) {
    el.innerHTML = `<div class="empty">${
      state.status.changes === 'loading'
        ? 'Loading activity…'
        : 'No recent StarCraft wiki activity.'
    }</div>`
    return
  }

  const changeRow = (c) => `<div class="match" data-url="${esc(c.url || 'https://liquipedia.net')}">
      <div class="players">
        <span class="p">${esc(c.title)}</span>
      </div>
      <div class="sub">
        ${newBadge(c)}
        <span class="badge ${esc(c.game)}">${esc(c.game)}</span>
        <span class="cd">${esc(c.age || '')}</span>
      </div>
    </div>`

  el.innerHTML = `<div class="grouphead">Recent wiki activity</div>` + changes.map(changeRow).join('')
}

function renderStreams() {
  const el = $('panel-streams')
  if (!el) return

  if (state.streamsConfigured === false) {
    el.innerHTML = `<div class="empty">No stream sources configured.<br>Twitch: add TWITCH_CLIENT_ID + TWITCH_TOKEN to the widget's <code>.env</code>; SOOP: check <code>data/soop-bjs.json</code>, then refresh.</div>`
    return
  }

  const streams = (state.streams || []).filter((s) => matchGame(s.game))
  if (!streams.length) {
    el.innerHTML = `<div class="empty">${
      state.status.streams === 'loading' ? 'Loading streams…' : 'No live StarCraft streams right now.'
    }</div>`
    return
  }

  const row = (s) => `<div class="stream" data-url="${esc(s.url)}">
      <div class="s-head">
        ${newBadge(s)}
        <span class="badge ${esc(s.game)}">${esc(s.game)}</span>
        ${s.platform ? `<span class="badge platform ${esc(s.platform)}">${esc(s.platform)}</span>` : ''}
        ${s.caster ? `<span class="badge caster">🎙</span>` : ''}
        <span class="s-name">${esc(s.name)}</span>
        <span class="s-viewers">${s.viewers.toLocaleString()} watching</span>
      </div>
      <div class="s-title">${esc(s.title)}</div>
    </div>`

  el.innerHTML = streams.map(row).join('')
}

function renderFemsc() {
  const el = $('femsc-list')
  if (!el) return

  if (state.femscConfigured === false) {
    el.innerHTML = `<div class="empty">FemSC roster not configured.<br>Add bjids to <code>data/femsc.json</code>, then refresh.</div>`
    return
  }

  const streams = state.femsc || []
  const offline = state.femscOffline || []
  if (!streams.length && !offline.length) {
    el.innerHTML = `<div class="empty">${
      state.status.femsc === 'loading' ? 'Loading female SC streams…' : 'No monitored streamers.'
    }</div>`
    return
  }

  const tiers = []
  const byTier = {}
  for (const s of streams) {
    const t = String(s.tier || '?')
    if (!byTier[t]) { byTier[t] = []; tiers.push(t) }
    byTier[t].push(s)
  }
  tiers.sort((a, b) => {
    const na = Number(a), nb = Number(b)
    if (isNaN(na) && isNaN(nb)) return 0
    if (isNaN(na)) return 1
    if (isNaN(nb)) return -1
    return na - nb
  })

  const row = (s) => {
    const isCustom = s.tier === 'custom'
    return `<div class="femsc-row" data-url="${esc(s.url)}">
      <span class="femsc-live">● LIVE</span>
      <span class="femsc-name">${esc(s.rosterName || s.name)}</span>
      ${s.isSC ? '<span class="badge is-sc">SC</span>' : '<span class="badge is-other">non-SC</span>'}
      <span class="femsc-viewers">${s.viewers.toLocaleString()} watching</span>
      <span class="femsc-title">${esc(s.title)}</span>
      ${isCustom ? `<button class="femsc-x" data-bjid="${esc(s.bjid)}" title="Remove">×</button>` : ''}
    </div>`
  }

  const offRow = (s) => {
    const isCustom = s.tier === 'custom'
    return `<div class="femsc-row femsc-offline" data-url="${esc(s.url)}">
      <span class="femsc-off">○ offline</span>
      <span class="femsc-name">${esc(s.rosterName || s.name)}</span>
      ${isCustom ? `<button class="femsc-x" data-bjid="${esc(s.bjid)}" title="Remove">×</button>` : ''}
    </div>`
  }

  let html = tiers.map((t) =>
    `<div class="femsc-tier"><div class="femsc-tierhead">${esc(byTier[t][0].tierLabel || ('Tier ' + t))}</div>` +
    byTier[t].map(row).join('') + `</div>`
  ).join('')

  if (offline.length) {
    html += `<div class="femsc-tier"><div class="femsc-tierhead femsc-offhead">Offline (${offline.length})</div>` +
      offline.map(offRow).join('') + `</div>`
  }

  el.innerHTML = html
}

function parseBjidFromInput(raw) {
  const t = (raw || '').trim()
  if (!t) return null
  if (/^[a-z0-9_\-]+$/i.test(t)) return t
  try {
    let urlStr = t
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(urlStr) && /\./.test(urlStr)) {
      urlStr = 'https://' + urlStr
    }
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    if (!(host === 'sooplive.com' || host.endsWith('.sooplive.com'))) return null
    if (host === 'vod.sooplive.com') return null
    const KEYWORDS = new Set(['station', 'player', 'vod', 'channel', 'broadcast'])
    const segs = u.pathname.split('/').filter((s) => s && !KEYWORDS.has(s.toLowerCase()))
    if (segs.length >= 1 && segs[0]) return segs[0]
    return null
  } catch (_e) {
    return null
  }
}

async function addFemscFromInput() {
  const input = $('femsc-url')
  const status = $('femsc-status')
  if (!input || !status) return
  const bjid = parseBjidFromInput(input.value)
  if (!bjid) {
    status.textContent = 'Could not parse a streamer URL or bjid.'
    status.style.color = '#ff6b81'
    input.value = ''
    return
  }
  status.textContent = 'Adding…'
  status.style.color = 'var(--dim)'
  try {
    const r = await window.tl.addFemsc(bjid)
    if (r && r.ok) {
      status.textContent = `Added ${bjid} (${r.count} custom).`
      status.style.color = '#55f9a1'
      input.value = ''
    } else {
      status.textContent = (r && r.error) || 'Failed to add.'
      status.style.color = '#ff6b81'
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`
    status.style.color = '#ff6b81'
  }
  setTimeout(() => { status.textContent = '' }, 4000)
}

const femscAddBtn = $('femsc-add')
if (femscAddBtn) femscAddBtn.addEventListener('click', addFemscFromInput)
const femscUrlInput = $('femsc-url')
if (femscUrlInput) femscUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFemscFromInput() })

// capture-phase: remove a custom row before the [data-url] delegate opens the stream
document.addEventListener('click', (e) => {
  const x = e.target.closest('.femsc-x')
  if (x) {
    e.stopPropagation()
    e.preventDefault()
    const bjid = x.getAttribute('data-bjid')
    if (bjid) void window.tl.removeFemsc(bjid)
  }
}, true)

function renderBuildOrders() {
  const el = $('panel-buildorders')
  const listEl = $('bo-list')
  if (!el || !listEl) return
  const mu = state.boMatchup || 'pvx'
  let orders = state.buildorders || []
  // Filter by game (ALL, BW, SC2) and matchup
  if (state.game === 'BW') orders = orders.filter((b) => b.game === 'BW')
  else if (state.game === 'SC2') orders = orders.filter((b) => b.game !== 'BW')
  if (mu !== 'pvx') orders = orders.filter((b) => (b.matchup || '').toUpperCase() === mu.toUpperCase())

  if (!orders.length) {
    listEl.innerHTML = `<div class="empty">${
      state.status.buildorders === 'loading' ? 'Loading build orders…' : 'No build orders found for this matchup.'
    }</div>`
    return
  }

  const row = (b) => `<div class="bo" data-url="${esc(b.url)}">
      <div class="bo-head">
        ${newBadge(b)}
        <span class="bo-mu ${esc(b.game || 'SC2')}">${esc(b.matchup || '')}</span>
        <span class="bo-game">${esc(b.game || 'SC2')}</span>
        <span class="bo-name">${esc(b.name)}</span>
        ${b.difficulty ? `<span class="bo-diff">${esc(b.difficulty)}</span>` : ''}
      </div>
      <div class="bo-sub">
        ${b.creator ? `<span class="bo-creator">by ${esc(b.creator)}</span>` : ''}
        ${b.source ? `<span class="bo-source">— ${esc(b.source)}</span>` : ''}
        ${b.updated ? `<span class="bo-date">${esc(new Date(b.updated).toISOString().slice(0, 10))}</span>` : ''}
        ${typeof b.winrate === 'number' ? `<span class="bo-wr">${b.winrate}% WR</span>` : ''}
        ${typeof b.votes === 'number' ? `<span class="bo-votes">${b.votes} votes</span>` : ''}
      </div>
      ${b.description ? `<div class="bo-desc">${esc(b.description)}</div>` : ''}
    </div>`

  listEl.innerHTML = orders.map(row).join('')
}

/* ---- matchup filter for the Build Orders tab ---- */
document.querySelectorAll('.bo-chip').forEach((c) =>
  c.addEventListener('click', () => {
    document.querySelectorAll('.bo-chip').forEach((x) => x.classList.remove('active'))
    c.classList.add('active')
    state.boMatchup = c.dataset.mu
    renderBuildOrders()
  }),
)

/* ---- Replays tab: latest RepMastered games (public front page) ---- */
let replayCache = []
let replayMu = 'ALL'
let replaysLoaded = false

function replayMatchesMu(g) {
  if (replayMu === 'ALL') return true
  // Matchup strings look like "PvT"; normalize before comparing.
  const mu = (g.matchup || '').replace(/\s+/g, '')
  return mu.toUpperCase() === replayMu.toUpperCase()
}

async function hydrateImage(imgEl) {
  const url = imgEl.getAttribute('data-img')
  if (!url) return
  const res = await window.tl.getImage(url)
  if (res && res.dataUrl) imgEl.src = res.dataUrl
  else imgEl.style.display = 'none'
}

/* ---- Books tab: your local/OneDrive library ---- */
function renderBooks() {
  const el = $('book-list')
  if (!el) return
  const books = state.books || []
  if (!books.length) {
    el.innerHTML = `<div class="empty">No books yet — add a PDF/EPUB/MOBI/TXT/CBR.</div>`
    return
  }
  el.innerHTML = books
    .map(
      (b) =>
        `<div class="book-item" data-path="${esc(b.path)}">
          ${b.cover ? `<img class="book-cover" src="${esc(b.cover)}" alt="" />` : `<div class="book-cover book-icon ${esc(b.format)}">${esc(b.format.toUpperCase())}</div>`}
          <div class="book-meta">
            <div class="book-title">${esc(b.title)}</div>
            ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
            <div class="book-path">${esc(b.path)}</div>
          </div>
          <button class="book-x" data-path="${esc(b.path)}" title="Remove">×</button>
        </div>`,
    )
    .join('')
}
$('book-add').addEventListener('click', async () => {
  const p = await window.tl.openBookDialog()
  if (!p) return // cancelled
  const format = (p.split('.').pop() || 'file').toLowerCase()
  const baseName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
  window.tl
    .addBook({ title: baseName, path: p, format, cover: null })
    .then(async () => {
      state.books = await window.tl.getBooks()
      renderBooks()
      enrichBook(p, baseName)
    })
})

// Background metadata: extract ISBN from filename, look up Open Library,
// fetch the cover via the main process, and patch the book entry.
async function enrichBook(path, fallbackTitle) {
  let meta
  try {
    meta = await window.tl.lookupIsbn(fallbackTitle)
  } catch (_) {
    return
  }
  if (!meta || (!meta.title && !meta.coverUrl)) return
  const patch = { path }
  if (meta.title) patch.title = meta.title
  if (meta.author) patch.author = meta.author
  if (meta.coverUrl) {
    try {
      const img = await window.tl.getImage(meta.coverUrl)
      if (img && img.dataUrl) patch.cover = img.dataUrl
    } catch (_) {
      /* cover optional */
    }
  }
  if (Object.keys(patch).length > 1) {
    await window.tl.updateBook(patch)
    state.books = await window.tl.getBooks()
    renderBooks()
  }
}
$('book-list').addEventListener('click', async (e) => {
  const x = e.target.closest('.book-x')
  if (x) {
    await window.tl.removeBook(x.dataset.path)
    state.books = await window.tl.getBooks()
    renderBooks()
    return
  }
  const item = e.target.closest('.book-item')
  if (item) {
    const r = await window.tl.openBook(item.dataset.path)
    if (r && r.error) alert('Could not open: ' + r.error)
  }
})
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    if (window.TabSfx) window.TabSfx.play(t.dataset.tab)
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'))
    t.classList.add('active')
    state.tab = t.dataset.tab
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'))
    $(`panel-${state.tab}`).classList.add('active')
  }),
)

document.querySelectorAll('.chip').forEach((c) =>
  c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'))
    c.classList.add('active')
    state.game = c.dataset.game
    render()
  }),
)

function setDebugFlash(msg) {
  let el = document.getElementById('__debug-flash')
  if (!el) {
    el = document.createElement('div')
    el.id = '__debug-flash'
    el.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'z-index:2147483647',
      'background:#000000ee',
      'color:#fff',
      'font:12px/1.35 monospace',
      'padding:6px 8px',
      'border:1px solid #333',
      'border-radius:4px',
      'max-width:520px',
      'word-break:break-all',
      'pointer-events:none',
      'box-shadow:0 2px 8px rgba(0,0,0,.5)',
      'opacity:0',
      'transition:opacity .12s ease',
    ].join(';')
    document.documentElement.appendChild(el)
  }
  el.textContent = msg
  el.style.opacity = '1'
  clearTimeout(setDebugFlash._t)
  setDebugFlash._t = setTimeout(() => { el.style.opacity = '0' }, 1400)
}
document.addEventListener('click', (e) => {
  const target = e.target
  const rawUrl = target.getAttribute && target.getAttribute('data-url')
  const row = e.target.closest('[data-url]')
  const matchedRow = row || null
  const url = matchedRow ? matchedRow.getAttribute('data-url') : rawUrl || null
  // TEMP VERIFICATION: log click target and any matched [data-url] row
  if (url) {
    window.__debugStreamClick = window.__debugStreamClick || []
    window.__debugStreamClick.push({
      time: Date.now(),
      target: target.tagName + '.' + (target.className || ''),
      url: url,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      button: e.button,
    })
  }
  const bf = e.target.closest('[data-b-p1]')
  if (bf) {
    void openAnalysis({
      p1: bf.dataset.bP1,
      p2: bf.dataset.bP2,
      tournament: bf.dataset.bT,
      game: bf.dataset.bGame,
    }, false, 'panel-analysis')
    return
  }
  // Analyze button lives INSIDE the [data-url] match row — handle first.
  const an = e.target.closest('[data-a-p1]')
  if (an) {
    void openAnalysis({
      p1: an.dataset.aP1,
      p2: an.dataset.aP2,
      tournament: an.dataset.aT,
      game: an.dataset.aGame,
      bo: an.dataset.aBo,
    })
    return
  }
  const br = e.target.closest('[data-bracket]')
  if (br) {
    const url = br.dataset.bracket
    if (url) openBracket(url, br.dataset.name || 'Bracket')
    return
  }
  const el = e.target.closest('[data-url]')
  if (el && el.dataset.url) {
    const u = el.dataset.url
    window.__lastStreamClickExec = window.__lastStreamClickExec || []
    window.__lastStreamClickExec.push({ time: Date.now(), url: u, kind: 'user-click' })
    setDebugFlash('OPEN ' + u)
    window.tl.open(u)
    return
  }
})

$('btn-refresh').addEventListener('click', () => { markLiqPull(); void window.tl.refresh() })
$('btn-hide').addEventListener('click', () => void window.tl.hide())
$('btn-quit').addEventListener('click', () => void window.tl.quit())
$('btn-pin').addEventListener('click', async () => {
  const on = await window.tl.togglePin()
  $('btn-pin').classList.toggle('on', on)
})
$('btn-run-analysis-bar').addEventListener('click', async () => {
  const btn = $('btn-run-analysis-bar')
  if (!btn) return
  btn.disabled = true
  btn.textContent = '⏳'
  try {
    const r = await window.tl.runAnalysisSweep()
    if (r && r.ok && r.pending > 0) {
      alert(`${r.pending} pending analysis request(s): ${r.slugs.join(', ')}`)
    } else if (r && r.ok) {
      alert('No pending analysis requests.')
    } else {
      alert('Error: ' + (r?.error || 'unknown'))
    }
  } catch (e) {
    alert('Error: ' + e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '▶ Analysis'
  }
})
$('opacity').addEventListener('input', (e) => void window.tl.setOpacity(Number(e.target.value) / 100))
$('sfx').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100
  if (window.TabSfx) window.TabSfx.setVolume(v)
  void window.tl.setSfxVolume(v)
})
$('liq-toggle').addEventListener('click', async () => {
  const blocked = !$('liq-toggle').classList.contains('off')
  const r = await window.tl.setLiquipedia(blocked)
  applyLiquipediaState(r && r.blocked)
  if (r && !r.blocked) markLiqPull() // enabling pulls newest once
})

function applyLiquipediaState(blocked) {
  const btn = $('liq-toggle')
  if (blocked) {
    btn.classList.add('off')
    btn.textContent = 'Liquipedia: OFF'
  } else {
    btn.classList.remove('off')
    btn.textContent = 'Liquipedia: pull-only'
  }
}


// Pull-only indicator: time since the last Liquipedia fetch was requested.
let lastLiqPull = 0
function markLiqPull() { lastLiqPull = Date.now(); updateLiqAge() }
function updateLiqAge() {
  const el = $('liq-age')
  if (!el) return
  if (!lastLiqPull) { el.textContent = 'never'; return }
  const s = Math.floor((Date.now() - lastLiqPull) / 1000)
  if (s < 60) el.textContent = s + 's ago'
  else if (s < 3600) el.textContent = Math.floor(s / 60) + 'm ago'
  else el.textContent = Math.floor(s / 3600) + 'h ago'
}
setInterval(updateLiqAge, 1000)

// Refresh the "NEW Xs/m/h" arrival pills every second. Items past the 15-min
// window lose the pill (but keep their author-time `when`/schedule `countdown`).
function renderNewTimers() {
  document.querySelectorAll('.newbadge[data-arrived]').forEach((el) => {
    const ts = Number(el.getAttribute('data-arrived'))
    if (!isNew(ts)) {
      el.remove()
    } else {
      el.textContent = 'NEW ' + arrivedAgo(ts)
    }
  })
}
setInterval(renderNewTimers, 1000)

window.tl.onPullStart(() => markLiqPull())
window.tl.onNews((d) => {
  state.news = markArrivals(d.items || [], !!d.fromCache)
  state.newsAt = d.fetchedAt
  state.status.news = 'ok'
  state.fromCache = !!d.fromCache
  state.integrity = d.integrity || state.integrity
  render()
})
window.tl.onMatches((d) => {
  state.matches = markArrivals(d.matches || [], !!d.fromCache)
  state.matchesAt = d.fetchedAt
  if (d.fromCache) state.fromCache = true
  if (!d.fromCache) markLiqPull() // a real Liquipedia pull — start/reset the timer

  render()
})
window.tl.onTournaments((d) => {
  state.tournaments = markArrivals(d.tournaments || [], !!d.fromCache)
  state.tournAt = d.fetchedAt
  state.status.tournaments = 'ok'
  if (!d.fromCache) markLiqPull()
  render()
})
window.tl.onChanges((d) => {
  state.changes = markArrivals(d.items || [], !!d.fromCache)
  state.changesAt = d.fetchedAt
  state.status.changes = d.fromCache ? 'stale' : 'ok'
  if (!d.fromCache) markLiqPull()
  render()
})
window.tl.onStreams((d) => {
  state.streams = markArrivals(d.streams || [], !!d.fromCache)
  state.streamsAt = d.fetchedAt
  state.streamsConfigured = d.configured
  if (d.configured === false) state.status.streams = 'needs-config'
  else if (d.errors && d.errors.length && !(d.streams || []).length) state.status.streams = 'error'
  else state.status.streams = 'ok'
  render()
})

window.tl.onFemsc((d) => {
  state.femsc = d.streams || []
  state.femscOffline = d.offline || []
  state.femscAt = d.fetchedAt
  state.femscConfigured = d.configured
  if (d.configured === false) state.status.femsc = 'needs-config'
  else if (d.errors && d.errors.length && !(d.streams || []).length) state.status.femsc = 'error'
  else state.status.femsc = 'ok'
  render()
})
window.tl.onBuildOrders((d) => {
  state.buildorders = markArrivals(d.orders || [], !!d.fromCache)
  state.buildordersAt = d.fetchedAt
  state.status.buildorders = (d.orders || []).length ? 'ok' : 'error'
  render()
})
window.tl.onStatus((d) => {
  state.status[d.scope] = d.state
  renderStatus()
})

// ---- banner: apply saved image, handle click-to-upload ----
const bannerEl = $('banner')
const bannerInput = $('banner-input')
function applyBanner(dataUrl) {
  if (dataUrl) {
    bannerEl.style.backgroundImage = `url("${dataUrl}")`
    bannerEl.classList.add('has-image')
  } else {
    bannerEl.style.backgroundImage = ''
    bannerEl.classList.remove('has-image')
  }
}
bannerEl.addEventListener('click', () => bannerInput.click())
bannerInput.addEventListener('change', async () => {
  const file = bannerInput.files && bannerInput.files[0]
  if (!file) return
  const dataUrl = await new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.readAsDataURL(file)
  })
  applyBanner(dataUrl)
  await window.tl.setBanner(dataUrl)
  bannerInput.value = ''
})

;(async () => {
  const pinned = await window.tl.getPin()
  $('btn-pin').classList.toggle('on', pinned)
  const st = await window.tl.getState()
  if (st && st.opacity) {
    $('opacity').value = Math.round(st.opacity * 100)
    window.tl.setOpacity(st.opacity)
  }
  if (st && typeof st.sfxVolume === 'number') {
    $('sfx').value = Math.round(st.sfxVolume * 100)
    if (window.TabSfx) window.TabSfx.setVolume(st.sfxVolume)
  }
  if (st && st.banner) applyBanner(st.banner)
  if (window.TabSfx && window.TabSfx.init) window.TabSfx.init()
  state.books = (st && st.books) || []
  renderBooks()
  applyLiquipediaState(!!(st && st.liquipediaBlocked))
  initJournal()
})()

// Journal: free-type notes with debounced auto-save.
let journalTimer = null
let journalDirty = false
function journalStamp(msg) {
  const el = $('journal-status')
  if (el) el.textContent = msg
}
async function initJournal() {
  const box = $('journal-text')
  if (!box) return
  try {
    box.value = (await window.tl.getJournal()) || ''
  } catch (_e) { /* start empty */ }
  journalStamp(box.value ? `loaded · ${box.value.length} chars` : 'empty journal')
  box.addEventListener('input', () => {
    journalDirty = true
    journalStamp('typing…')
    clearTimeout(journalTimer)
    journalTimer = setTimeout(async () => {
      try {
        const r = await window.tl.saveJournal(box.value)
        journalStamp(r && r.error ? `save failed: ${r.error}` : `saved ✓ ${new Date().toLocaleTimeString()}`)
      } catch (e) {
        journalStamp(`save failed: ${e.message}`)
      }
      journalDirty = false
    }, 800)
  })
  // Flush on tab switch away so nothing is lost mid-typing.
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      if (journalDirty && box.value !== undefined) {
        clearTimeout(journalTimer)
        journalDirty = false
        void window.tl.saveJournal(box.value).then(
          (r) => journalStamp(r && r.error ? `save failed: ${r.error}` : `saved ✓ ${new Date().toLocaleTimeString()}`),
          (e) => journalStamp(`save failed: ${e.message}`),
        )
      }
    }),
  )
}

// Journal Strategy Chat resizer: drag the divider to give more room to notes or chat.
// Double-click the divider to collapse/expand the chat panel. Height is kept in memory
// only (a widget restart returns to the default split) — no state file needed for this.
(function journalResizeInit() {
  const resizer = $('journal-resizer')
  const chat = document.querySelector('.journal-chat')
  const panel = $('panel-journal')
  if (!resizer || !chat || !panel) return

  const MIN_CHAT = 48
  const MIN_NOTES = 80
  let dragging = false
  let startY = 0
  let startChatH = 0

  function clampChatHeight(h) {
    const panelH = panel.clientHeight || 660
    const maxChat = Math.max(MIN_CHAT, panelH - MIN_NOTES - 120)
    return Math.max(MIN_CHAT, Math.min(maxChat, h))
  }

  function setChatHeight(h) {
    const clamped = clampChatHeight(h)
    chat.style.height = clamped + 'px'
    return clamped
  }

  resizer.addEventListener('pointerdown', (e) => {
    dragging = true
    startY = e.clientY
    startChatH = chat.clientHeight || 220
    resizer.classList.add('dragging')
    resizer.setPointerCapture(e.pointerId)
    chat.style.transition = 'none'
  })

  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return
    // Dragging UP gives the chat MORE height (notes shrink); DOWN gives notes more.
    const next = startChatH + (startY - e.clientY)
    setChatHeight(next)
  })

  function endDrag() {
    if (!dragging) return
    dragging = false
    resizer.classList.remove('dragging')
    chat.style.transition = ''
  }

  resizer.addEventListener('pointerup', endDrag)
  resizer.addEventListener('pointercancel', endDrag)

  resizer.addEventListener('dblclick', () => {
    const collapsed = chat.classList.toggle('collapsed')
    if (!collapsed) {
      chat.style.height = ''
    } else {
      chat.style.height = ''
    }
  })

  window.addEventListener('resize', () => {
    if (!chat.classList.contains('collapsed')) setChatHeight(chat.clientHeight || 220)
  })
})()

// Strategy Chat: discuss builds, matchups, notes — grounded in journal content.
(function journalChatInit() {
  const input = $('journal-chat-input')
  const sendBtn = $('journal-chat-send')
  const msgs = $('journal-chat-msgs')
  const clearBtn = $('journal-chat-clear')
  const journalBox = $('journal-text')
  if (!input || !sendBtn || !msgs) return

  let history = [] // [{role:'user'|'assistant', text}]
  let busy = false

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  }

  function scrollDown() { msgs.scrollTop = msgs.scrollHeight }

  function addMsg(kind, text) {
    const d = document.createElement('div')
    d.className = 'journal-msg ' + kind
    d.textContent = text
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

  async function send() {
    if (busy) return
    const q = input.value.trim()
    if (!q) return

    addMsg('user', q)
    input.value = ''
    history.push({ role: 'user', text: q })

    // Build context: recent journal notes + conversation history
    const journalText = (journalBox && journalBox.value) ? journalBox.value.slice(-3000) : ''
    const historyBlock = history.slice(-8).map(m =>
      (m.role === 'user' ? 'Player: ' : 'Assistant: ') + m.text.replace(/\s+/g, ' ').slice(0, 400)
    ).join('\n')

    const systemContent = [
      'You are a StarCraft Brood War strategy coach embedded in the TL.net widget.',
      'The player follows progaming (Protoss player, watches Mini/Bisu).',
      'Be direct and concise; use short lists when the answer is steps.',
      'Reference specific players, builds, or matchups when relevant.',
      'If unsure about a matchup or build, say so plainly.',
      journalText ? '\nPlayer journal notes (recent):\n' + journalText : '',
      historyBlock ? '\nConversation so far:\n' + historyBlock : '',
    ].filter(Boolean).join('\n')

    const userMessage = (historyBlock ? 'Conversation:\n' + historyBlock + '\n\n' : '') + 'Question: ' + q

    setBusy(true)
    const live = addMsg('assistant', '…')
    try {
      const r = await window.tl.journalChat(JSON.stringify({ message: userMessage, system: systemContent }))
      if (r && r.response) {
        live.textContent = r.response.trim() || 'No response.'
        history.push({ role: 'assistant', text: r.response.trim() })
      } else if (r && r.error) {
        live.className = 'journal-msg err'
        live.textContent = 'Chat error: ' + (r.detail || r.error)
      } else {
        live.className = 'journal-msg err'
        live.textContent = 'Chat returned empty response.'
      }
    } catch (e) {
      live.className = 'journal-msg err'
      live.textContent = 'Chat error: ' + e.message
    } finally {
      setBusy(false)
    }
  }

  sendBtn.addEventListener('click', send)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send() })
  if (clearBtn) clearBtn.addEventListener('click', () => {
    history = []
    msgs.innerHTML = '<div class="journal-msg sys">Conversation cleared. Ask about strategies, build orders, or your journal notes.</div>'
  })
})()

setInterval(render, 30000);

// Delegation to extracted modules
if (window.__analysis) {
  renderAnalysisView = window.__analysis.renderAnalysisView
  openAnalysis = window.__analysis.openAnalysis
  scheduleAnalysisRecheck = window.__analysis.scheduleAnalysisRecheck
  prettySlug = window.__analysis.prettySlug
  renderAnalysis = window.__analysis.renderAnalysis
}
if (window.__replays) {
  renderReplayList = window.__replays.renderReplayList
  lookupReplays = window.__replays.lookupReplays
  window.__replays.initReplaysTab()
}
