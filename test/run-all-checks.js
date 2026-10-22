'use strict'

const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')

const testDir = __dirname
// Run local checks only (exclude live/e2e which make live network calls)
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith('.check.js') && f !== 'live.check.js' && f !== 'e2e.check.js')
  .sort()

console.log(`\n=== Running ${files.length} Fixture Check Scripts ===\n`)

async function main() {
  let passed = 0
  let failed = 0

  for (const file of files) {
    const fullPath = path.join(testDir, file)
    const res = await new Promise((resolve) => {
      const proc = fork(fullPath, [], {
        cwd: path.resolve(testDir, '..'),
        stdio: 'inherit',
      })
      proc.on('close', (code) => resolve(code === 0))
    })

    if (res) {
      passed++
      console.log(`\n[PASS] ${file}\n`)
    } else {
      failed++
      console.error(`\n[FAIL] ${file}\n`)
    }
  }

  console.log(`Checks: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
