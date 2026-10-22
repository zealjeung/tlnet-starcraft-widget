'use strict'
// Refresh functions extracted from main.js.
// Factory pattern: createRefresh(deps) returns the refresh functions
// bound to the provided dependencies (win, store, send, state, etc.).

const { fetchNewsAggregate } = require('./news')
const { fetchAll, selectFreshOrCached } = require('./matches')
const { fetchChanges } = require('./changes')
const { fetchStreams } = require('./twitch')
const { fetchStreams: fetchSoopStreams } = require('./soop')
const { fetchStreams: fetchYoutubeStreams } = require('./youtube')
const { fetchStreams: fetchFemscStreams } = require('./femsc')
const { fetchBuildOrders } = require('./buildorders')
const { BW_BUILDS } = require('./bw-buildorders')
const { checkNews, checkAll } = require('./integrity')
const { splitTournamentUrl, fetchBrackets } = require('./brackets')
const { isLiquipediaBlocked } = require('./liquipedia-policy')

const NEWS_INTERVAL_MS = 30 * 60 * 1000
const STREAM_INTERVAL_MS = 5 * 60 * 1000
const FEMSC_INTERVAL_MS = 5 * 60 * 1000 // female BJ live list, same cadence as streams
const BUILD_ORDERS_INTERVAL_MS = 30 * 60 * 1000
const BOOT_STAGGER_MS = 2500
const BRACKET_TTL_MS = 10 * 60 * 1000

function createRefresh(deps) {
  const { win, store, send, getState, saveState, bracketCache, shell, Notification } = deps
  let seenNewsLinks = new Set()
  let firstNewsLoad = true
  let prefetched = false
  let timers = []

  function refreshNews(notify = true) {
    send('status', { scope: 'news', state: 'loading' })
    return fetchNewsAggregate().then(({ items, totalFetched, filteredOut, sources }) => {
      if (notify && !firstNewsLoad) {
        const fresh = items.filter((i) => !seenNewsLinks.has(i.link))
        if (fresh.length && Notification.isSupported()) {
          const tlFresh = fresh.filter((i) => i.source === 'TL.net')
          const n = new Notification({
            title: tlFresh.length === 1 ? 'New on TL.net' : tlFresh.length ? `${tlFresh.length} new TL.net posts` : `${fresh.length} SC updates`,
            body: fresh[0].title,
            silent: false,
          })
          n.on('click', () => shell.openExternal(fresh[0].link))
          n.show()
        }
      }
      items.forEach((i) => seenNewsLinks.add(i.link))
      firstNewsLoad = false
      const check = checkNews(items)
      if (!check.ok) store.log('WARN', 'news integrity', { problems: check.problems })
      store.write('news', items)
      send('news', { items, totalFetched, filteredOut, sources: sources || null, fetchedAt: Date.now(), integrity: check.ok ? null : check.problems })
      send('status', { scope: 'news', state: 'ok' })
    }).catch((e) => {
      store.log('ERROR', 'news refresh failed', { error: e.message })
      const cached = store.read('news')
      if (cached) {
        send('news', { items: cached.payload, fetchedAt: cached.savedAt, fromCache: true })
        send('status', { scope: 'news', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'news', state: 'error', message: e.message })
      }
    })
  }

  function refreshMatches() {
    send('status', { scope: 'matches', state: 'loading' })
    return fetchAll().then(({ matches, tournaments, errors }) => {
      const check = checkAll({ news: [], matches, tournaments, errors })
      const problems = check.summary.filter((s) => !s.startsWith('news:'))
      if (problems.length) store.log('WARN', 'liquipedia integrity', { problems })
      const cm = store.read('matches')
      let useM = selectFreshOrCached(matches, errors, cm && cm.payload)
      if (!useM.fromCache && !useM.payload.length && cm && cm.payload.length) {
        useM = { payload: cm.payload, fromCache: true }
        store.log('WARN', 'matches parsed zero, keeping stale cache', { errors })
      }
      const ct = store.read('tournaments')
      let useT = selectFreshOrCached(tournaments, errors, ct && ct.payload)
      if (!useT.fromCache && !useT.payload.length && ct && ct.payload.length) {
        useT = { payload: ct.payload, fromCache: true }
        store.log('WARN', 'tournaments parsed zero, keeping stale cache', { errors })
      }
      if (!useT.fromCache && errors.length && ct && ct.payload.length > useT.payload.length) {
        const freshN = useT.payload.length
        useT = { payload: ct.payload, fromCache: true }
        store.log('WARN', 'tournaments partial fetch, keeping fuller cache', { fresh: freshN, cached: ct.payload.length, errors })
      }
      if (!useM.fromCache) store.write('matches', matches)
      else store.log('WARN', 'matches refresh failed, serving stale', { errors })
      if (!useT.fromCache) store.write('tournaments', tournaments)
      const at = Date.now()
      send('matches', { matches: useM.payload, errors, fetchedAt: useM.fromCache && cm ? cm.savedAt : at, fromCache: useM.fromCache, integrity: problems.length ? problems : null })
      send('tournaments', { tournaments: useT.payload, errors, fetchedAt: useT.fromCache && ct ? ct.savedAt : at, fromCache: useT.fromCache, integrity: problems.length ? problems : null })
      send('status', { scope: 'matches', state: useM.fromCache ? 'stale' : errors.length && !useM.payload.length ? 'error' : 'ok', message: errors.join('; ') })
      send('status', { scope: 'tournaments', state: 'ok' })
      prefetchOngoingBracket(tournaments)
    }).catch((e) => {
      store.log('ERROR', 'matches refresh failed', { error: e.message })
      const cm = store.read('matches')
      const ct = store.read('tournaments')
      if (cm) {
        send('matches', { matches: cm.payload, errors: [], fetchedAt: cm.savedAt, fromCache: true })
        send('status', { scope: 'matches', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'matches', state: 'error', message: e.message })
      }
      if (ct) {
        send('tournaments', { tournaments: ct.payload, errors: [], fetchedAt: ct.savedAt, fromCache: true })
        send('status', { scope: 'tournaments', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'tournaments', state: 'error', message: e.message })
      }
    })
  }

  function refreshChanges() {
    send('status', { scope: 'changes', state: 'loading' })
    return fetchChanges().then(({ items, errors }) => {
      const cc = store.read('changes')
      const useC = selectFreshOrCached(items, errors, cc && cc.payload)
      if (!useC.fromCache) store.write('changes', items)
      const at = Date.now()
      send('changes', { items: useC.payload, errors, fetchedAt: useC.fromCache && cc ? cc.savedAt : at, fromCache: useC.fromCache })
      send('status', { scope: 'changes', state: useC.fromCache ? 'stale' : errors.length && !useC.payload.length ? 'error' : 'ok', message: errors.join('; ') })
    }).catch((e) => {
      store.log('ERROR', 'changes refresh failed', { error: e.message })
      const c = store.read('changes')
      if (c) {
        send('changes', { items: c.payload, errors: [], fetchedAt: c.savedAt, fromCache: true })
        send('status', { scope: 'changes', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'changes', state: 'error', message: e.message })
      }
    })
  }

  function refreshStreams() {
    send('status', { scope: 'streams', state: 'loading' })
    const at = Date.now()
    return Promise.all([
      fetchStreams().catch((e) => ({ streams: [], errors: [`twitch: ${e.message}`], configured: true })),
      fetchSoopStreams().catch((e) => ({ streams: [], errors: [`soop: ${e.message}`], configured: true })),
      fetchYoutubeStreams().catch((e) => ({ streams: [], errors: [`youtube: ${e.message}`], configured: false })),
    ]).then(([tw, soop, yt]) => {
      const streams = [...tw.streams, ...soop.streams, ...yt.streams].sort((a, b) => b.viewers - a.viewers)
      const errors = [...tw.errors, ...soop.errors, ...yt.errors]
      const configured = tw.configured || soop.configured || yt.configured
      store.write('streams', streams)
      send('streams', { streams, errors, configured, fetchedAt: at })
      send('status', { scope: 'streams', state: !configured ? 'needs-config' : errors.length && !streams.length ? 'error' : 'ok', message: !configured ? 'Twitch credentials not set — see .env' : errors.join('; ') })
    }).catch((e) => {
      store.log('ERROR', 'streams refresh failed', { error: e.message })
      const c = store.read('streams')
      if (c) {
        send('streams', { streams: c.payload, errors: [], fetchedAt: c.savedAt, fromCache: true })
        send('status', { scope: 'streams', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'streams', state: 'error', message: e.message })
      }
    })
  }

  function refreshFemsc() {
    send('status', { scope: 'femsc', state: 'loading' })
    const at = Date.now()
    return fetchFemscStreams().then(({ streams, offline, errors, configured }) => {
      store.write('femsc', streams)
      send('femsc', { streams, offline, errors, configured, fetchedAt: at })
      send('status', { scope: 'femsc', state: !configured ? 'needs-config' : errors.length && !streams.length ? 'error' : 'ok', message: errors.join('; ') })
    }).catch((e) => {
      store.log('ERROR', 'femsc refresh failed', { error: e.message })
      const c = store.read('femsc')
      if (c) {
        send('femsc', { streams: c.payload, offline: [], errors: [], fetchedAt: c.savedAt, fromCache: true })
        send('status', { scope: 'femsc', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'femsc', state: 'error', message: e.message })
      }
    })
  }

  async function refreshBuildOrders() {
    send('status', { scope: 'buildorders', state: 'loading' })
    const at = Date.now()
    try {
      const bw = BW_BUILDS.map((b) => ({ ...b, game: 'BW' }))
      let sc2 = []
      try {
        sc2 = (await fetchBuildOrders('pvx')).map((b) => ({ ...b, game: 'SC2' }))
      } catch (e) {
        store.log('WARN', 'spawningtool SC2 fetch failed, BW only', { error: e.message })
      }
      const orders = [...bw, ...sc2]
      store.write('buildorders', orders)
      send('buildorders', { orders, errors: [], fetchedAt: at })
      send('status', { scope: 'buildorders', state: orders.length ? 'ok' : 'error' })
    } catch (e) {
      store.log('ERROR', 'build orders refresh failed', { error: e.message })
      const c = store.read('buildorders')
      if (c) {
        send('buildorders', { orders: c.payload, errors: [], fetchedAt: c.savedAt, fromCache: true })
        send('status', { scope: 'buildorders', state: 'stale', message: e.message })
      } else {
        send('status', { scope: 'buildorders', state: 'error', message: e.message })
      }
    }
  }

  function primeFromCache() {
    const n = store.read('news')
    const m = store.read('matches')
    const t = store.read('tournaments')
    const c = store.read('changes')
    if (n) {
      n.payload.forEach((i) => seenNewsLinks.add(i.link))
      firstNewsLoad = false
      send('news', { items: n.payload, fetchedAt: n.savedAt, fromCache: true })
    }
    if (m) send('matches', { matches: m.payload, errors: [], fetchedAt: m.savedAt, fromCache: true })
    if (t) send('tournaments', { tournaments: t.payload, errors: [], fetchedAt: t.savedAt, fromCache: true })
    if (c) send('changes', { items: c.payload, errors: [], fetchedAt: c.savedAt, fromCache: true })
    const s = store.read('streams')
    if (s) send('streams', { streams: s.payload, errors: [], configured: true, fetchedAt: s.savedAt, fromCache: true })
    const bo = store.read('buildorders')
    if (bo) send('buildorders', { orders: bo.payload, errors: [], fetchedAt: bo.savedAt, fromCache: true })
    const f = store.read('femsc')
    if (f) send('femsc', { streams: f.payload, offline: [], errors: [], configured: true, fetchedAt: f.savedAt, fromCache: true })
    store.log('INFO', 'primed from cache', { news: !!n, matches: !!m, tournaments: !!t, changes: !!c, streams: !!s, buildorders: !!bo, femsc: !!f })
  }

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

  function refreshAll() {
    refreshNews(true)
    refreshStreams()
    refreshFemsc()
    refreshBuildOrders()
    if (!isLiquipediaBlocked()) pullLiquipediaStaggered()
  }

  function pullLiquipediaStaggered() {
    setTimeout(refreshMatches, BOOT_STAGGER_MS)
    setTimeout(refreshChanges, BOOT_STAGGER_MS * 2)
  }

  function startTimers() {
    timers.forEach(clearInterval)
    timers = [
      setInterval(() => refreshNews(true), NEWS_INTERVAL_MS),
      setInterval(refreshStreams, STREAM_INTERVAL_MS),
      setInterval(refreshFemsc, FEMSC_INTERVAL_MS),
      setInterval(refreshBuildOrders, BUILD_ORDERS_INTERVAL_MS),
    ]
  }

  function stopTimers() {
    timers.forEach(clearInterval)
    timers = []
  }

  return {
    refreshNews,
    refreshMatches,
    refreshChanges,
    refreshStreams,
    refreshFemsc,
    refreshBuildOrders,
    primeFromCache,
    prefetchOngoingBracket,
    refreshAll,
    pullLiquipediaStaggered,
    startTimers,
    stopTimers,
    getSeenNewsLinks: () => seenNewsLinks,
    getFirstNewsLoad: () => firstNewsLoad,
  }
}

module.exports = { createRefresh }
