// Village boundaries for states whose villages exist only in the Bhuvan/SOI
// sources — which carry their OWN state/district/taluka ids (SID/DID/TID),
// not the LGD sub-district codes the app's hierarchy uses. So instead of a
// code join we do a spatial join: each village polygon is assigned to the
// hierarchy taluka whose bundled boundary (src/assets/talukas/<code>.json,
// keyed by LGD code) contains its interior point. Output is written exactly
// like the other village-shapes so the app loads it unchanged.
//
//   node scripts/spatial-village-join.cjs <geojsonl> <stateCensusCode> [--name NAME_FIELD] [--code CODE_FIELD] [--state STAT_NAME=VALUE]
//
// Defaults suit the Bhuvan village schema (NAME, VILL_CODE, STAT_NAME).
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const [geojsonl, stateCodeArg] = process.argv.slice(2)
if (!geojsonl || !stateCodeArg) { console.error('usage: spatial-village-join.cjs <geojsonl> <stateCode> [--name F] [--code F] [--state K=V]'); process.exit(1) }
const stateCode = Number(stateCodeArg)
const opt = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def }
const NAME_FIELD = opt('--name', 'NAME')
const CODE_FIELD = opt('--code', 'VILL_CODE')
const stateFilter = opt('--state', null) // "STAT_NAME=JK" to pre-filter a national file

// --- geometry helpers (round 4dp + RDP simplify; coords already lon/lat) ---
const TOL = 0.0004
function perp2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}
function rdp(pts, lo, hi, tol2, keep) {
  let md = 0, idx = -1
  for (let i = lo + 1; i < hi; i++) { const d = perp2(pts[i], pts[lo], pts[hi]); if (d > md) { md = d; idx = i } }
  if (md > tol2 && idx !== -1) { rdp(pts, lo, idx, tol2, keep); rdp(pts, idx, hi, tol2, keep) } else keep.add(hi)
}
function ring(coords) {
  const r = []
  for (const [lon, lat] of coords) {
    const x = Math.round(lon * 1e4) / 1e4, y = Math.round(lat * 1e4) / 1e4
    const last = r[r.length - 1]
    if (!last || last[0] !== x || last[1] !== y) r.push([x, y])
  }
  if (r.length <= 4) return r
  const open = r.slice(0, -1)
  const keep = new Set([0]); rdp(open, 0, open.length - 1, TOL * TOL, keep); keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i)); out.push(out[0])
  return out.length >= 4 ? out : r
}
function simplify(geom) {
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(ring)) }
  return geom
}
function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates]
  if (geom.type === 'MultiPolygon') return geom.coordinates
  return []
}
function firstExterior(geom) {
  if (geom.type === 'Polygon') return geom.coordinates[0]
  if (geom.type === 'MultiPolygon') return geom.coordinates[0][0]
  return null
}
// interior-ish representative point: average of a ring's vertices
function repPoint(ext) {
  let sx = 0, sy = 0, n = 0
  for (const [x, y] of ext) { sx += x; sy += y; n++ }
  return [sx / n, sy / n]
}
function bboxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}
function pointInRing(px, py, r) {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

// Load hierarchy taluka boundaries for the state as assignment targets.
const talukaFile = path.join(ROOT, 'src/assets/talukas', `${stateCode}.json`)
if (!fs.existsSync(talukaFile)) { console.error(`no taluka boundaries at ${talukaFile}`); process.exit(1) }
const talukas = JSON.parse(fs.readFileSync(talukaFile, 'utf8')).features.map((f) => {
  const polys = polygonsOf(f.geometry) // each: [exterior, ...holes]
  const exts = polys.map((p) => p[0])
  const bbox = bboxOf(exts)
  const [cx, cy] = repPoint(exts[0])
  return { code: String(f.properties.code), exts, bbox, cx, cy }
})
// state bbox (union) to cheaply skip out-of-state features in a national file
const stateBbox = talukas.reduce((b, t) => [Math.min(b[0], t.bbox[0]), Math.min(b[1], t.bbox[1]), Math.max(b[2], t.bbox[2]), Math.max(b[3], t.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity])

// Nearest-taluka fallback is only allowed within this distance (~deg) of a
// taluka's representative point, so a village in an UNMAPPED taluka (J&K/NE
// only have partial taluka-boundary coverage) is dropped rather than dumped
// into a distant mapped neighbour, which would pollute that neighbour's
// village set. A small radius still rescues points that a simplified boundary
// just misses at the edge.
const FALLBACK_MAX_DEG = 0.03
let nContained = 0, nFallback = 0
function assign(px, py) {
  if (px < stateBbox[0] - 0.5 || px > stateBbox[2] + 0.5 || py < stateBbox[1] - 0.5 || py > stateBbox[3] + 0.5) return null
  for (const t of talukas) {
    if (px < t.bbox[0] || px > t.bbox[2] || py < t.bbox[1] || py > t.bbox[3]) continue
    if (t.exts.some((r) => pointInRing(px, py, r))) { nContained++; return t.code }
  }
  let best = null, bd = Infinity
  for (const t of talukas) { const d = (t.cx - px) ** 2 + (t.cy - py) ** 2; if (d < bd) { bd = d; best = t.code } }
  if (best && bd <= FALLBACK_MAX_DEG * FALLBACK_MAX_DEG) { nFallback++; return best }
  return null
}

const prop = (p, name) => { const k = Object.keys(p).find((x) => x.toLowerCase() === name.toLowerCase()); return k != null ? p[k] : undefined }

async function main() {
  let sf = null
  if (stateFilter) { const [k, v] = stateFilter.split('='); sf = { k, v } }
  const byTaluka = new Map() // talukaCode -> Map(villCode -> {name, polys})
  let total = 0, assigned = 0, fallback = 0
  await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(geojsonl) })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let f; try { f = JSON.parse(line) } catch { return }
      if (sf && String(prop(f.properties, sf.k)) !== sf.v) return
      const ext = firstExterior(f.geometry)
      if (!ext || ext.length < 3) return
      total++
      const [px, py] = repPoint(ext)
      const code = assign(px, py)
      if (!code) return
      assigned++
      const vc = String(prop(f.properties, CODE_FIELD) ?? `v${total}`)
      const name = String(prop(f.properties, NAME_FIELD) ?? '').trim()
      let vils = byTaluka.get(code)
      if (!vils) { vils = new Map(); byTaluka.set(code, vils) }
      let v = vils.get(vc)
      if (!v) { v = { name, polys: [] }; vils.set(vc, v) }
      else if (!v.name && name) v.name = name
      v.polys.push(...polygonsOf(simplify(f.geometry)))
    })
    rl.on('close', resolve); rl.on('error', reject)
  })

  const dir = path.join(ROOT, 'src/assets/village-shapes', String(stateCode))
  fs.mkdirSync(dir, { recursive: true })
  for (const [code, vils] of byTaluka) {
    const features = [...vils.entries()].map(([vc, { name, polys }]) => ({
      type: 'Feature', properties: { name: name || 'Unnamed village', code: vc },
      geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    }))
    fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify({ type: 'FeatureCollection', features }))
  }
  console.log(`state ${stateCode}: ${total} villages -> ${assigned} assigned (${nContained} contained, ${nFallback} edge-fallback, ${total - assigned} dropped) across ${byTaluka.size} talukas`)
}
main().catch((e) => { console.error(e); process.exit(1) })
