'use strict'
// Live-tournament matcher (shared by renderer.js, tested by test/livetourn.test.js).
// An event only earns red LIVE when a match from it is being played RIGHT NOW.
// Everything else ongoing is merely underway (amber). Name matching is fuzzy
// because Liquipedia event names and match-ticker tournament names differ
// in stage suffixes ("ASL Season 22" vs "ASL Season 22 Group Stage").

function normTournName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function buildLiveTournSet(matches) {
  return new Set(
    (matches || [])
      .filter((m) => m.live && m.tournament)
      .map((m) => normTournName(m.tournament)),
  )
}

function isLiveNow(eventName, liveSet) {
  const n = normTournName(eventName)
  if (!n) return false
  for (const lt of liveSet) {
    if (lt && (n.includes(lt) || lt.includes(n))) return true
  }
  return false
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normTournName, buildLiveTournSet, isLiveNow }
}
