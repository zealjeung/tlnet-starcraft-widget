'use strict'

/**
 * Parse-integrity checks.
 *
 * The failure mode this exists to kill: Liquipedia/TL.net change their markup,
 * every regex stops matching, and the widget shows an EMPTY list. Empty is
 * indistinguishable from "no games today" — so a source breakage looks like
 * normal quiet and goes unnoticed for weeks.
 *
 * These checks turn "silently empty" into a loud, visible warning.
 */

const YEAR_MS = 365 * 24 * 3600 * 1000

/** A result object every checker returns. */
function ok(kind, count) {
  return { kind, ok: true, count, problems: [] }
}
function bad(kind, count, problems) {
  return { kind, ok: false, count, problems }
}

/**
 * News is expected to be non-empty essentially always — TL.net's feed carries
 * ~20 items at all times, so zero means the feed shape changed.
 */
function checkNews(items) {
  const problems = []
  if (!Array.isArray(items)) return bad('news', 0, ['news is not an array'])
  if (items.length === 0) problems.push('feed returned zero items (expected ~20)')

  const noTitle = items.filter((n) => !n.title || !n.title.trim()).length
  if (noTitle) problems.push(`${noTitle} item(s) with empty title`)

  // News items expose `link` (RSS naming); tournaments/matches use `url`.
  // Accept either so the checker doesn't cry wolf on a correct payload.
  const noLink = items.filter((n) => {
    const href = n.link || n.url
    return !href || !/^https?:\/\//.test(href)
  }).length
  if (noLink) problems.push(`${noLink} item(s) with invalid url`)

  const future = items.filter((n) => n.timestamp && n.timestamp > Date.now() + 2 * 24 * 3600 * 1000).length
  if (future) problems.push(`${future} item(s) dated in the future`)

  return problems.length ? bad('news', items.length, problems) : ok('news', items.length)
}

/**
 * Matches: validate SHAPE, never a specific count. Genuinely quiet hours exist
 * (SC2 has dead slots), so zero matches is only suspicious in combination with
 * zero tournaments — that pairing is checked in checkAll().
 */
function checkMatches(matches) {
  const problems = []
  if (!Array.isArray(matches)) return bad('matches', 0, ['matches is not an array'])

  const now = Date.now()
  const noPlayers = matches.filter((m) => !m.p1 || !m.p2).length
  if (noPlayers) problems.push(`${noPlayers} match(es) missing a player`)

  // The exact bug that shipped 2024 data: past-dated rows presented as upcoming.
  const stale = matches.filter((m) => m.timestamp && m.timestamp < now - 24 * 3600 * 1000).length
  if (stale) problems.push(`${stale} stale match(es) older than 24h — source cache may be stale`)

  const farFuture = matches.filter((m) => m.timestamp && m.timestamp > now + YEAR_MS).length
  if (farFuture) problems.push(`${farFuture} match(es) dated more than a year out`)

  const noTs = matches.filter((m) => !m.timestamp).length
  if (noTs === matches.length && matches.length > 0) problems.push('no match has a timestamp — timer markup changed?')

  // Duplicate self-matchups (the sibling-collapse parser bug) — p1 === p2.
  // TBD vs TBD is legitimate: unseeded future rounds genuinely have no players
  // yet, so excluding placeholders keeps this from crying wolf every day.
  const selfMatch = matches.filter((m) => m.p1 && m.p1 === m.p2 && !/^tbd$/i.test(m.p1.trim())).length
  if (selfMatch) problems.push(`${selfMatch} match(es) where both opponents are identical — parser bug`)

  return problems.length ? bad('matches', matches.length, problems) : ok('matches', matches.length)
}

function checkTournaments(tournaments) {
  const problems = []
  if (!Array.isArray(tournaments)) return bad('tournaments', 0, ['tournaments is not an array'])

  const noName = tournaments.filter((t) => !t.name || !t.name.trim()).length
  if (noName) problems.push(`${noName} tournament(s) with no name`)

  const badUrl = tournaments.filter((t) => t.url && !/liquipedia\.net\/(starcraft2|starcraft)\//.test(t.url)).length
  if (badUrl) problems.push(`${badUrl} tournament(s) with a non-StarCraft url`)

  return problems.length ? bad('tournaments', tournaments.length, problems) : ok('tournaments', tournaments.length)
}

function checkBracket(data) {
  const problems = []
  const brackets = (data && data.brackets) || []
  const lists = (data && data.matchlists) || []
  const all = [...brackets.flatMap((b) => b.matches || []), ...lists.flatMap((l) => l.matches || [])]

  if (!all.length) problems.push('no bracket or matchlist rows found on the tournament page')

  const selfMatch = all.filter((m) => {
    const [a, b] = m.opponents || []
    return a && b && a.name !== 'TBD' && a.name === b.name
  }).length
  if (selfMatch) problems.push(`${selfMatch} bracket row(s) with identical opponents — parser bug`)

  const noScores = all.filter((m) => m.finished && (m.score === '-–-' || m.score == null)).length
  if (noScores) problems.push(`${noScores} finished match(es) with no score`)

  return problems.length ? bad('bracket', all.length, problems) : ok('bracket', all.length)
}

/**
 * Cross-source check. Matches AND tournaments both empty is the signature of a
 * Liquipedia markup change (both are parsed from the same Main_Page payload),
 * whereas a genuinely quiet day still lists tournaments.
 */
function checkAll({ news, matches, tournaments, errors }) {
  const results = [checkNews(news), checkMatches(matches), checkTournaments(tournaments)]

  if ((matches || []).length === 0 && (tournaments || []).length === 0) {
    const fetchErrors = Array.isArray(errors) ? errors.filter(Boolean) : []
    if (fetchErrors.length) {
      // Empty because the fetch itself failed/blocked — NOT a parser/markup break.
      results.push(
        bad('liquipedia', 0, [
          `both matches and tournaments are empty — fetch failed/blocked (not a markup change): ${fetchErrors.join('; ')}`,
        ]),
      )
    } else {
      // No fetch error but nothing parsed — genuine parser/markup break.
      results.push(
        bad('liquipedia', 0, [
          'both matches and tournaments are empty — Liquipedia markup likely changed',
        ]),
      )
    }
  }

  const problems = results.filter((r) => !r.ok)
  return {
    ok: problems.length === 0,
    results,
    problems,
    summary: problems.flatMap((p) => p.problems.map((t) => `${p.kind}: ${t}`)),
  }
}

module.exports = { checkNews, checkMatches, checkTournaments, checkBracket, checkAll }
