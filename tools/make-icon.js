const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// Minimal 32x32 PNG generator: TL blue rounded square with white "TL".
const W = 32,
  H = 32
const px = Buffer.alloc(W * H * 4, 0)

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

// rounded square background #4aa8ff
const R = 6
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = Math.max(R - x, x - (W - 1 - R), 0)
    const dy = Math.max(R - y, y - (H - 1 - R), 0)
    if (dx * dx + dy * dy <= R * R) set(x, y, 0x4a, 0xa8, 0xff, 255)
  }
}

// "TL" glyphs in dark navy
const D = [0x06, 0x10, 0x1d, 255]
// T: top bar + stem
for (let x = 5; x <= 14; x++) for (let y = 9; y <= 11; y++) set(x, y, ...D)
for (let y = 9; y <= 23; y++) for (let x = 8; x <= 10; x++) set(x, y, ...D)
// L: stem + foot
for (let y = 9; y <= 23; y++) for (let x = 18; x <= 20; x++) set(x, y, ...D)
for (let x = 18; x <= 27; x++) for (let y = 21; y <= 23; y++) set(x, y, ...D)

// encode PNG
const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}

function crc32(buf) {
  let c,
    t = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const out = path.join(__dirname, '..', 'assets', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
