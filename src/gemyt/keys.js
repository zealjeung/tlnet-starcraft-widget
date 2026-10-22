'use strict'
// GemYT — API key resolution (env → .env → vault)

const fs = require('fs')
const path = require('path')
const os = require('os')

function readDotEnv() {
  const out = {}
  try {
    const file = path.join(__dirname, '..', '..', '.env')
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const eq = s.indexOf('=')
      if (eq < 1) continue
      out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim()
    }
  } catch (_e) { /* no .env */ }
  return out
}

function readVaultKey(title) {
  try {
    const { spawnSync } = require('child_process')
    const py = process.env.HERMES_PYTHON ||
      path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe')
    const resolver = path.join(os.homedir(), '.local', 'state', 'vault-resolve.py')
    if (!fs.existsSync(py) || !fs.existsSync(resolver)) return ''
    const escaped = resolver.replace(/\\/g, '\\\\')
    const script = [
      'import importlib.util, sys, os',
      "spec = importlib.util.spec_from_file_location('vr', r'" + escaped + "')",
      'vr = importlib.util.module_from_spec(spec); spec.loader.exec_module(vr)',
      'pw = os.environ.get("VAULT_PASSWORD") or vr._dpapi_unlock()',
      'v = vr._Vault(pw)',
      'sys.stdout.write(v.get(' + JSON.stringify(title) + '))',
    ].join('\n')
    const res = spawnSync(py, ['-c', script], { encoding: 'utf8', timeout: 30000, windowsHide: true, creationFlags: 0x08000000 })
    if (res.status !== 0) return ''
    const val = (res.stdout || '').trim()
    if (!val || val.length < 20 || /\s/.test(val)) return ''
    return val
  } catch (_e) { return '' }
}

let _keyCache
function getKey() {
  if (_keyCache !== undefined) return _keyCache
  if (process.env.GEMINI_API_KEY) { _keyCache = process.env.GEMINI_API_KEY.trim(); console.log('[gemyt] key from process.env, len=' + _keyCache.length); return _keyCache }
  const env = readDotEnv()
  const raw = env.GEMINI_API_KEY || ''
  console.log('[gemyt] .env GEMINI_API_KEY raw: ' + JSON.stringify(raw.substring(0, 30)))
  if (raw.startsWith('vault://')) {
    const title = raw.slice('vault://'.length).trim()
    console.log('[gemyt] resolving vault title: ' + JSON.stringify(title))
    _keyCache = readVaultKey(title)
    console.log('[gemyt] vault result len=' + (_keyCache ? _keyCache.length : 0))
  }
  else { _keyCache = raw.trim(); console.log('[gemyt] key from .env direct, len=' + _keyCache.length) }
  return _keyCache
}

function haveKey() { return getKey().length > 0 }
function resetKeyCache() { _keyCache = undefined }

module.exports = { readDotEnv, readVaultKey, getKey, haveKey, resetKeyCache }
