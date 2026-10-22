// Tab-click unit SFX — real StarCraft unit/commander voice lines.
// Each tab has a small POOL of lines; one is picked at random per session
// (on TabSfx.init), so every launch serves a different set. WAV PCM is decoded
// via Web Audio (decodeAudioData + AudioBufferSourceNode) — works even when the
// <audio> element's media pipeline is unavailable. Synth blip is last resort.

let enabled = true
let volume = 0.4
let buffers = {}   // tab -> AudioBuffer (the randomly chosen one for this session)
let ac = null
let ready = false

function getAC() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ac = new AC()
  }
  if (ac.state === 'suspended') ac.resume()
  return ac
}

function fallbackBlip() {
  const a = getAC()
  if (!a) return
  const o = a.createOscillator()
  const g = a.createGain()
  o.frequency.value = 660
  g.gain.setValueAtTime(0.12, a.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.12)
  o.connect(g).connect(a.destination)
  o.start()
  o.stop(a.currentTime + 0.14)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function playBuffer(buf) {
  if (!buf) return fallbackBlip()
  const a = getAC()
  if (!a) return fallbackBlip()
  const src = a.createBufferSource()
  src.buffer = buf
  const gain = a.createGain()
  gain.gain.value = volume
  src.connect(gain).connect(a.destination)
  src.start(0)
}

window.TabSfx = {
  setEnabled(on) { enabled = !!on },
  setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)) },
  getVolume() { return volume },
  isReady() { return ready },
  async init() {
    try {
      const sfx = (await window.tl.getSfx()) || {}
      const a = getAC()
      if (!a) { ready = true; return }
      for (const tab of Object.keys(sfx)) {
        const pool = sfx[tab]
        if (!Array.isArray(pool) || !pool.length) continue
        const url = pickRandom(pool)
        const b64 = url.split(',')[1]
        if (!b64) continue
        try {
          const ab = b64ToBytes(b64)
          buffers[tab] = await new Promise((res, rej) => a.decodeAudioData(ab, res, rej))
        } catch (_e) {
          buffers[tab] = null
        }
      }
    } catch (_e) { /* ignore */ }
    ready = true
  },
  play(tab) {
    if (!enabled) return
    try { playBuffer(buffers[tab] || buffers.news) } catch (_e) { fallbackBlip() }
  },
}
