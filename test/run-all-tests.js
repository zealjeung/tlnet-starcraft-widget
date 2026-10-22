'use strict'

const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')

const testDir = __dirname
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()

console.log(`\n=== Running ${files.length} Unit Test Suites ===\n`)

let totalSuites = files.length
let passedSuites = 0
let failedSuites = 0

function runSuite(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(testDir, file)
    const start = Date.now()
    const proc = fork(fullPath, [], {
      cwd: path.resolve(testDir, '..'),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })

    proc.on('close', (code) => {
      const ms = Date.now() - start
      if (code === 0) {
        passedSuites++
        console.log(`  PASS [${ms}ms] ${file}`)
        resolve(true)
      } else {
        failedSuites++
        console.error(`  FAIL [${ms}ms] ${file} (exit code ${code})`)
        if (stdout.trim()) {
          console.error(stdout.split('\n').map((l) => '    ' + l).join('\n'))
        }
        if (stderr.trim()) {
          console.error(stderr.split('\n').map((l) => '    ' + l).join('\n'))
        }
        resolve(false)
      }
    })
  })
}

async function main() {
  for (const f of files) {
    await runSuite(f)
  }

  console.log(`\n========================================`)
  console.log(`Suites: ${passedSuites} passed, ${failedSuites} failed, ${totalSuites} total`)
  console.log(`========================================\n`)

  if (failedSuites > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test runner failure:', err)
  process.exit(1)
})
