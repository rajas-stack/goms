/* One-off: shrink sales_persons.photo_url values that exceed the API's size cap
 * (apps/api/src/photoUrl.ts MAX_PHOTO_URL_LENGTH) so those people are
 * saveable again and sales.listPersons stops returning ~33 MB.
 *
 * Node port of src/lib/resizeProfilePhoto.ts — same parameters: longest side
 * capped at 512px, aspect ratio preserved, never upscaled, JPEG at quality 85
 * stepping down only as needed toward 70 to stay near ~300 KB. Written with
 * Node built-ins only (zlib) because the goms-api image ships no image library
 * and the prod DB is only reachable from inside the VPC.
 *
 * Usage (DATABASE_URL required):
 *   DRY_RUN=1 node resize-oversized-sales-photos.cjs   # computes + prints table, writes nothing
 *   node resize-oversized-sales-photos.cjs             # applies, in ONE transaction
 * Aborts (no writes) unless exactly EXPECTED_ROWS rows are over the cap.
 * Never prints photo data — only ids, sizes and percentages. */
const zlib = require('zlib')

const MAX_DIMENSION = 512
const START_QUALITY = 85
const MIN_QUALITY = 70
const QUALITY_STEP = 5
const TARGET_DATA_URL_LENGTH = 400000
const MAX_PHOTO_URL_LENGTH = 700000

// ───────────────────────── PNG decode → RGB (white-composited) ─────────────
function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG')
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0
  let palette = null, trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; ctype = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (interlace !== 0) throw new Error('interlaced PNG not supported')
  if (!width || !height) throw new Error('bad PNG header')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]
  if (!channels) throw new Error('unsupported PNG color type ' + ctype)
  const bpp = channels * depth
  const stride = Math.ceil((width * bpp) / 8)
  const bytesPP = Math.max(1, bpp >> 3)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG data')

  // unfilter
  const img = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const up = dst - stride
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x]
      const a = x >= bytesPP ? img[dst + x - bytesPP] : 0
      const b = y > 0 ? img[up + x] : 0
      const c = x >= bytesPP && y > 0 ? img[up + x - bytesPP] : 0
      let v
      switch (ft) {
        case 0: v = r; break
        case 1: v = r + a; break
        case 2: v = r + b; break
        case 3: v = r + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error('bad PNG filter ' + ft)
      }
      img[dst + x] = v & 255
    }
  }

  // sample accessor for sub-byte and 16-bit depths
  const maxv = (1 << Math.min(depth, 8)) - 1
  function sample(y, idx) { // idx = sample index within the row
    if (depth === 8) return img[y * stride + idx]
    if (depth === 16) return img[y * stride + idx * 2] // high byte
    const bit = idx * depth
    const byte = img[y * stride + (bit >> 3)]
    return (byte >> (8 - depth - (bit & 7))) & maxv
  }
  const scale = depth < 8 ? 255 / maxv : 1

  const rgb = new Uint8Array(width * height * 3)
  const tr = trns && ctype === 0 ? ((trns[0] << 8) | trns[1]) : -1
  const trRGB = trns && ctype === 2 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r, g, b, al = 255
      if (ctype === 0) {
        const raw16 = depth === 16 ? (img[y * stride + x * 2] << 8) | img[y * stride + x * 2 + 1] : sample(y, x)
        const v = Math.round(sample(y, x) * scale)
        r = g = b = v
        if (tr >= 0 && raw16 === tr) al = 0
      } else if (ctype === 2) {
        r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2)
        if (trRGB && depth === 8 && r === trRGB[0] && g === trRGB[1] && b === trRGB[2]) al = 0
      } else if (ctype === 3) {
        const i = sample(y, x)
        if (!palette || i * 3 + 2 >= palette.length) throw new Error('bad palette index')
        r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2]
        if (trns && i < trns.length) al = trns[i]
      } else if (ctype === 4) {
        r = g = b = sample(y, x * 2); al = sample(y, x * 2 + 1)
      } else {
        r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); al = sample(y, x * 4 + 3)
      }
      const o = (y * width + x) * 3
      if (al === 255) { rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b }
      else { // composite over white — same as the browser resizer's white fill
        const f = al / 255
        rgb[o] = Math.round(r * f + 255 * (1 - f)); rgb[o + 1] = Math.round(g * f + 255 * (1 - f)); rgb[o + 2] = Math.round(b * f + 255 * (1 - f))
      }
    }
  }
  return { width, height, rgb }
}

// ───────────────────────── resize (area average, no crop/upscale) ──────────
function fitWithin(width, height, max) {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const s = max / longest
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }
}

function resizeArea(src, sw, sh, dw, dh) {
  if (dw === sw && dh === sh) return Float32Array.from(src)
  // horizontal pass
  const tmp = new Float32Array(dw * sh * 3)
  const sx = sw / dw
  for (let dx = 0; dx < dw; dx++) {
    const x0 = dx * sx, x1 = (dx + 1) * sx
    const i0 = Math.floor(x0), i1 = Math.min(sw, Math.ceil(x1))
    for (let y = 0; y < sh; y++) {
      let r = 0, g = 0, b = 0, wsum = 0
      for (let i = i0; i < i1; i++) {
        const w = Math.min(i + 1, x1) - Math.max(i, x0)
        const o = (y * sw + i) * 3
        r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; wsum += w
      }
      const t = (y * dw + dx) * 3
      tmp[t] = r / wsum; tmp[t + 1] = g / wsum; tmp[t + 2] = b / wsum
    }
  }
  // vertical pass
  const out = new Float32Array(dw * dh * 3)
  const sy = sh / dh
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * sy, y1 = (dy + 1) * sy
    const j0 = Math.floor(y0), j1 = Math.min(sh, Math.ceil(y1))
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, wsum = 0
      for (let j = j0; j < j1; j++) {
        const w = Math.min(j + 1, y1) - Math.max(j, y0)
        const o = (j * dw + x) * 3
        r += tmp[o] * w; g += tmp[o + 1] * w; b += tmp[o + 2] * w; wsum += w
      }
      const t = (dy * dw + x) * 3
      out[t] = r / wsum; out[t + 1] = g / wsum; out[t + 2] = b / wsum
    }
  }
  return out
}

// ───────────────────────── baseline JPEG encoder (4:2:0) ───────────────────
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]
const QY = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99]
const DC_L = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
const DC_C = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
const AC_L = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  vals: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa],
}
const AC_C = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  vals: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa],
}
for (const t of [DC_L, DC_C, AC_L, AC_C]) {
  if (t.bits.reduce((a, b) => a + b, 0) !== t.vals.length) throw new Error('JPEG Huffman table is inconsistent')
}

function buildCodes(t) {
  const codes = new Map()
  let code = 0, k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < t.bits[len - 1]; i++) codes.set(t.vals[k++], { code: code++, len })
    code <<= 1
  }
  return codes
}
const HC = { dcL: buildCodes(DC_L), dcC: buildCodes(DC_C), acL: buildCodes(AC_L), acC: buildCodes(AC_C) }

const COS = (() => { // COS[u][x] = c(u)/2 * cos((2x+1)uπ/16)
  const m = []
  for (let u = 0; u < 8; u++) { m.push([]); for (let x = 0; x < 8; x++) m[u].push((u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) }
  return m
})()

function scaledTable(base, quality) {
  const s = quality < 50 ? 5000 / quality : 200 - quality * 2
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))))
}

function encodeJpeg(rgbF, w, h, quality) {
  const qy = scaledTable(QY, quality), qc = scaledTable(QC, quality)
  // planes (edge-replicated to 16x16 MCU multiples)
  const pw = Math.ceil(w / 16) * 16, ph = Math.ceil(h / 16) * 16
  const Y = new Float32Array(pw * ph), Cb = new Float32Array(pw * ph), Cr = new Float32Array(pw * ph)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(y, h - 1)
    for (let x = 0; x < pw; x++) {
      const o = (sy * w + Math.min(x, w - 1)) * 3
      const r = rgbF[o], g = rgbF[o + 1], b = rgbF[o + 2]
      const i = y * pw + x
      Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128
      Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b
      Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b
    }
  }
  const cw = pw / 2, ch = ph / 2
  const Cb2 = new Float32Array(cw * ch), Cr2 = new Float32Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = 2 * y * pw + 2 * x
    Cb2[y * cw + x] = (Cb[i] + Cb[i + 1] + Cb[i + pw] + Cb[i + pw + 1]) / 4
    Cr2[y * cw + x] = (Cr[i] + Cr[i + 1] + Cr[i + pw] + Cr[i + pw + 1]) / 4
  }

  const out = []
  let acc = 0, nbits = 0
  function putBits(code, len) {
    acc = (acc << len) | code; nbits += len
    while (nbits >= 8) {
      const byte = (acc >> (nbits - 8)) & 255
      out.push(byte); if (byte === 255) out.push(0)
      nbits -= 8
    }
    acc &= (1 << nbits) - 1
  }
  function putSym(map, sym) {
    const c = map.get(sym)
    if (!c) throw new Error('missing Huffman symbol ' + sym)
    putBits(c.code, c.len)
  }
  const tmp = new Float32Array(64), blk = new Int32Array(64)
  function block(plane, stride, bx, by, qt, dcMap, acMap, pred) {
    // forward DCT (separable)
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
      let s = 0; for (let x = 0; x < 8; x++) s += plane[(by + y) * stride + bx + x] * COS[u][x]
      tmp[y * 8 + u] = s
    }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
      let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v][y]
      blk[v * 8 + u] = Math.round(s / qt[v * 8 + u])
    }
    const dc = blk[0], diff = dc - pred
    let mag = Math.abs(diff), size = 0; while (mag) { size++; mag >>= 1 }
    putSym(dcMap, size)
    if (size) putBits(diff < 0 ? (diff - 1) & ((1 << size) - 1) : diff, size)
    let run = 0
    for (let k = 1; k < 64; k++) {
      const v = blk[ZZ[k]]
      if (v === 0) { run++; continue }
      while (run > 15) { putSym(acMap, 0xf0); run -= 16 }
      let m = Math.abs(v), sz = 0; while (m) { sz++; m >>= 1 }
      putSym(acMap, (run << 4) | sz)
      putBits(v < 0 ? (v - 1) & ((1 << sz) - 1) : v, sz)
      run = 0
    }
    if (run > 0) putSym(acMap, 0x00)
    return dc
  }
  let pY = 0, pCb = 0, pCr = 0
  for (let my = 0; my < ph; my += 16) for (let mx = 0; mx < pw; mx += 16) {
    pY = block(Y, pw, mx, my, qy, HC.dcL, HC.acL, pY)
    pY = block(Y, pw, mx + 8, my, qy, HC.dcL, HC.acL, pY)
    pY = block(Y, pw, mx, my + 8, qy, HC.dcL, HC.acL, pY)
    pY = block(Y, pw, mx + 8, my + 8, qy, HC.dcL, HC.acL, pY)
    pCb = block(Cb2, cw, mx / 2, my / 2, qc, HC.dcC, HC.acC, pCb)
    pCr = block(Cr2, cw, mx / 2, my / 2, qc, HC.dcC, HC.acC, pCr)
  }
  if (nbits) putBits((1 << (8 - nbits)) - 1, 8 - nbits) // pad with 1s

  const head = []
  const u16 = (v) => [(v >> 8) & 255, v & 255]
  head.push(0xff, 0xd8)
  head.push(0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, ...u16(1), ...u16(1), 0, 0)
  const dqt = (id, t) => head.push(0xff, 0xdb, ...u16(67), id, ...ZZ.map((z) => t[z]))
  dqt(0, qy); dqt(1, qc)
  head.push(0xff, 0xc0, ...u16(17), 8, ...u16(h), ...u16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)
  const dht = (cls, id, t) => head.push(0xff, 0xc4, ...u16(19 + t.vals.length), (cls << 4) | id, ...t.bits, ...t.vals)
  dht(0, 0, DC_L); dht(1, 0, AC_L); dht(0, 1, DC_C); dht(1, 1, AC_C)
  head.push(0xff, 0xda, ...u16(12), 3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0)
  return Buffer.concat([Buffer.from(head), Buffer.from(out), Buffer.from([0xff, 0xd9])])
}

function jpegSize(buf) { // SOF0 dims — used to verify the output header
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) throw new Error('bad JPEG marker stream')
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2)
    if (m === 0xc0) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('no SOF0 in JPEG')
}

/** PNG buffer → { dataUrl, width, height, quality } */
function resizePngToJpegDataUrl(pngBuf) {
  const { width, height, rgb } = decodePng(pngBuf)
  const fit = fitWithin(width, height, MAX_DIMENSION)
  const scaled = resizeArea(rgb, width, height, fit.width, fit.height)
  let quality = START_QUALITY
  let jpg = encodeJpeg(scaled, fit.width, fit.height, quality)
  let dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64')
  while (dataUrl.length > TARGET_DATA_URL_LENGTH && quality - QUALITY_STEP >= MIN_QUALITY) {
    quality -= QUALITY_STEP
    jpg = encodeJpeg(scaled, fit.width, fit.height, quality)
    dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64')
  }
  const got = jpegSize(jpg)
  if (got.width !== fit.width || got.height !== fit.height) throw new Error('encoded JPEG dimensions differ from plan')
  return { dataUrl, width: fit.width, height: fit.height, quality, srcWidth: width, srcHeight: height }
}

module.exports = { decodePng, fitWithin, resizeArea, encodeJpeg, resizePngToJpegDataUrl, jpegSize, MAX_PHOTO_URL_LENGTH }

// ───────────────────────── driver ──────────────────────────────────────────
async function main() {
  const EXPECTED_ROWS = Number(process.env.EXPECTED_ROWS || 13)
  const DRY = process.env.DRY_RUN === '1'
  const pg = require('pg')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const log = (...a) => console.log('PHOTOFIX', ...a)
  try {
    await client.query(DRY ? 'BEGIN READ ONLY' : 'BEGIN')
    const sel = await client.query(
      `SELECT id, employee_code AS code, photo_url FROM sales_persons WHERE length(photo_url) > $1 ORDER BY id${DRY ? '' : ' FOR UPDATE'}`,
      [MAX_PHOTO_URL_LENGTH])
    log(`rows over cap: ${sel.rows.length} (expected ${EXPECTED_ROWS}) mode=${DRY ? 'DRY_RUN' : 'APPLY'}`)
    if (sel.rows.length !== EXPECTED_ROWS) throw new Error(`affected row count ${sel.rows.length} != expected ${EXPECTED_ROWS} — aborting, nothing written`)

    const plan = []
    for (const r of sel.rows) {
      const m = /^data:image\/(?:png|jpeg);base64,/.exec(r.photo_url)
      if (!m) throw new Error(`row ${r.id}: unrecognised data URL header — aborting`)
      const bytes = Buffer.from(r.photo_url.slice(m[0].length), 'base64')
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error(`row ${r.id}: bytes are not PNG (only PNG handled) — aborting`)
      const res = resizePngToJpegDataUrl(bytes)
      if (res.dataUrl.length >= MAX_PHOTO_URL_LENGTH) throw new Error(`row ${r.id}: result still over the cap — aborting`)
      plan.push({ id: r.id, code: r.code, oldLen: r.photo_url.length, ...res })
    }

    log('id | code | old_chars | new_chars | reduction | dims (src -> new) | jpeg_q')
    for (const p of plan) {
      log(`${p.id} | ${p.code || '-'} | ${p.oldLen} | ${p.dataUrl.length} | ${(100 * (1 - p.dataUrl.length / p.oldLen)).toFixed(1)}% | ${p.srcWidth}x${p.srcHeight} -> ${p.width}x${p.height} | q${p.quality}`)
    }
    const totOld = plan.reduce((a, p) => a + p.oldLen, 0), totNew = plan.reduce((a, p) => a + p.dataUrl.length, 0)
    log(`TOTAL old=${totOld} new=${totNew} reduction=${(100 * (1 - totNew / totOld)).toFixed(1)}%`)

    if (DRY) { await client.query('ROLLBACK'); log('DRY_RUN complete — nothing written'); return }

    let updated = 0
    for (const p of plan) {
      const u = await client.query('UPDATE sales_persons SET photo_url = $1 WHERE id = $2 AND length(photo_url) = $3', [p.dataUrl, p.id, p.oldLen])
      if (u.rowCount !== 1) throw new Error(`update of ${p.id} affected ${u.rowCount} rows — rolling back`)
      updated += u.rowCount
    }
    if (updated !== EXPECTED_ROWS) throw new Error(`updated ${updated} != ${EXPECTED_ROWS} — rolling back`)
    // in-transaction verification before COMMIT
    const ids = plan.map((p) => p.id)
    const v = await client.query('SELECT id, length(photo_url) AS len, left(photo_url, 23) AS head FROM sales_persons WHERE id = ANY($1::uuid[])', [ids])
    for (const row of v.rows) {
      const p = plan.find((x) => x.id === row.id)
      if (Number(row.len) !== p.dataUrl.length || Number(row.len) >= MAX_PHOTO_URL_LENGTH || row.head !== 'data:image/jpeg;base64,') throw new Error(`post-update check failed for ${row.id} — rolling back`)
    }
    const still = await client.query('SELECT count(*)::int AS n FROM sales_persons WHERE length(photo_url) > $1', [MAX_PHOTO_URL_LENGTH])
    if (still.rows[0].n !== 0) throw new Error('rows still over cap after update — rolling back')
    await client.query('COMMIT')
    log(`COMMITTED ${updated} rows`)
    const after = await client.query('SELECT max(length(photo_url))::int AS max_len, sum(length(photo_url))::bigint AS total_len, count(photo_url)::int AS with_photo FROM sales_persons')
    log('POST-COMMIT sales_persons photo stats', JSON.stringify(after.rows[0]))
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    log('ABORTED:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

if (require.main === module) main()
