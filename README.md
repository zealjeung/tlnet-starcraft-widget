# TL.net StarCraft Widget

Always-on-top Electron widget showing TL.net news + Liquipedia matches/brackets, filtered to StarCraft / StarCraft II / Brood War only.

![Widget preview](screenshot.png?style=placeholder)

## Features

- **5 tabs**: News · Matches · Activity · Events · Streams
- **Match analysis** with CDP-verified live briefs
- **News aggregation**: TL.net RSS merged with Liquipedia recent-changes pulse
- **StarCraft filter**: Only shows SC2/BW content (generic games blocked)
- **Replay cache** with bracket analysis
- **Guardrails**: Budget tracking, throttle limits, history caps

## Quick Start

```bash
# Install
npm install

# Run tests
node test/run-all-tests.js  # all 15 suites must pass

# Start the widget
npm start  # or: electron .
```

## Development

```bash
# Run all tests
node test/run-all-tests.js

# Run checks
node test/run-all-checks.js

# Live network check (requires credentials)
node test/live.check.js
```

## Architecture

```
main.js          — app bootstrap, window creation, tray
src/refresh.js   — refresh functions (factory pattern)
src/ipc-handlers.js  — IPC handlers (factory pattern)
src/liquipedia-policy.js  — single source of truth for block state
src/gemyt/       — Gemini video analysis submodules
  - keys.js      — API key resolution (env → .env → vault)
  - transport.js — HTTP layer (apiPost, apiGet, apiStream, apiDelete)
  - cache.js     — response cache (JSON file, max 100 entries)
  - models.js    — model resolution + retry logic
  - budget.js    — guardrails (budget, throttle, history cap)
src/http.js      — HTTP client with rate limiting
renderer/        — Electron renderer process
  tabs/
    - analysis.js    — Analysis view
    - replays.js     — Replays view
  lib/format.js   — Format helpers (esc, ago, countdown, formatDate, formatTime, formatDuration)
  format.js      — Pure format helpers (loaded before renderer.js)
```

## Test Suites

15 unit test suites covering:

- analysis, bw-tournaments, cache-guard, carddate, changes, filter, integrity
- livetourn, news-aggregate, replays, soop, twitch, youtube
- **lixepedia-block** (F2 regression test)
- **select-fresh-or-cached** (pure function test)

## License

MIT License - see LICENSE file for details.

## Security

- **No hardcoded API keys** — key resolved from `GEMINI_API_KEY` env var or vault
- **Never commit** `.env` files or `cache-gemyt.json`
- **Add to `.gitignore`**: `node_modules/`, `.env`, `cache-gemyt.json`, `journal.md`, `widget.log`
- **Throttle**: `MIN_INTERVAL_MS` = 1200ms between API calls
- **Budget cap**: `MAX_SESSION_TOKENS` = 3,000,000 tokens per process

---

Generated with automated refactoring pipeline — Phases 1-4 complete.
All 15 test suites passing. Widget boots successfully across restart cycles.

---

*For support, open an issue on the GitHub repository.*
`,