'use strict'
// Liquipedia block policy — single source of truth for the block/unblock state.
// Re-exports the http.js primitives and adds boot-time seeding from saved state.

const { setLiquipediaBlocked, isLiquipediaBlocked } = require('./http')

/**
 * Seed the block state from saved widget state.
 * Called once at boot after store.init() and loadState().
 * @param {object} state - the object returned by loadState()
 */
function seedFromState(state) {
  setLiquipediaBlocked(!!state.liquipediaBlocked)
}

module.exports = {
  setLiquipediaBlocked,
  isLiquipediaBlocked,
  seedFromState,
}
