// Fills the last few src/assets/districts/<state>.json gaps from the Survey
// of India district layer (SOI_Districts, via
// https://github.com/yashveeeeeeer/india-geodata, CC BY 4.0, release tag
// admin/districts). Never overwrites an existing polygon.
//
// By the time this runs, dissolve-districts.cjs + fill-gaps-from-national-lgd
// have already resolved all but a handful of districts nationally — the
// stragglers are ones renamed or newly split since this app's admin snapshot
// (e.g. "S.P.S. Nellore" for the LGD-current "Sri Potti Sriramulu Nellore",
// Telangana's post-2016 Warangal Urban/Rural split). This layer conveniently
// ships pre-cleaned `STATE_C`/`District_C` fields (ASCII, no diacritics)
// alongside the raw transliterated `STATE`/`District`, so no local
// diacritic-stripping is needed — just the same name normaliser (nd) and
// edit-distance fallback used by the sibling fill scripts.
//
// Run: node scripts/fill-districts-from-soi.cjs <SOI_Districts.geojsonl>
const fs = require('fs')
const path = require('path')
const { readLines } = require('./linereader.cjs')

const ROOT = path.join(__dirname, '..')
const DISTRICT_DIR = path.join(ROOT, 'src', 'assets', 'districts')
const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))

const DISTRICT_TOLERANCE = 0.002

const nd = (x) => String(x ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')

function editDistance(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1)
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
// A source state name using "&" instead of "and" won't hit an exact nd()
// match — see the identical fix/comment in fill-talukas-from-soi.cjs.
const STATE_ALIASES = {
  jammukashmir: 'jammuandkashmir',
  andamannicobar: 'andamanandnicobarislands',
}
function resolveAppStateCode(stname) {
  const n = nd(stname)
  return appStateByName.get(n) ?? (STATE_ALIASES[n] ? appStateByName.get(STATE_ALIASES[n]) : undefined)
}
const districtsOf = new Map()
for (const st of admin) {
  const list = st.districts.map((d) => ({ name: d.district, normalised: nd(d.district), dtCode: String(Number(d.dt_code)) }))
  districtsOf.set(Number(st.st_code), list)
}
function resolveDistrict(stateCode, dtname) {
  const list = districtsOf.get(stateCode)
  if (!list) return undefined
  const n = nd(dtname)
  const exact = list.find((d) => d.normalised === n)
  if (exact) return exact
  const near = list.filter((d) => d.normalised.length > 3 && (d.normalised.includes(n) || n.includes(d.normalised)))
  if (near.length === 1) return near[0]
  if (n.length > 3) {
    const budget = Math.max(2, Math.floor(n.length * 0.3))
    let best, bestDist = Infinity, tie = false
    for (const d of list) {
      if (Math.abs(d.normalised.length - n.length) > budget) continue
      const dist = editDistance(n, d.normalised)
      if (dist < bestDist) { bestDist = dist; best = d; tie = false }
      else if (dist === bestDist) tie = true
    }
    if (best && bestDist <= budget && !tie) return best
  }
  return undefined
}

// ---- geometry (same RDP simplifier as the sibling build scripts) ---------

function perpDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}
function rdp(points, lo, hi, tol2, keep) {
  let maxD = 0, idx = -1
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist2(points[i], points[lo], points[hi])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > tol2 && idx !== -1) { rdp(points, lo, idx, tol2, keep); rdp(points, idx, hi, tol2, keep) }
  else keep.add(hi)
}
function simplifyRing(ring) {
  const rounded = []
  for (const pt of ring) {
    const p = [Math.round(pt[0] * 10000) / 10000, Math.round(pt[1] * 10000) / 10000]
    const last = rounded[rounded.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p)
  }
  if (rounded.length < 4) return null
  const f = rounded[0], l = rounded[rounded.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) rounded.push([f[0], f[1]])
  if (rounded.length <= 5) return rounded
  const open = rounded.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, DISTRICT_TOLERANCE ** 2, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  return out.length >= 4 ? out : rounded
}
function simplifyGeometry(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : []
  const out = []
  for (const poly of polys) {
    const rings = poly.map(simplifyRing).filter(Boolean)
    if (rings.length) out.push(rings)
  }
  return out
}
function combine(polyLists) {
  // polyLists is already an array of "poly" (each poly an array of rings) —
  // see the identical fix/comment in fill-talukas-from-soi.cjs's combine():
  // a stray `.flat()` here stripped that grouping and corrupted output
  // geometry one nesting level too shallow.
  const polys = polyLists
  if (!polys.length) return null
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

function existingCodes(stateCode) {
  const file = path.join(DISTRICT_DIR, `${stateCode}.json`)
  if (!fs.existsSync(file)) return { file, features: [], codes: new Set() }
  const features = JSON.parse(fs.readFileSync(file, 'utf8')).features
  return { file, features, codes: new Set(features.map((f) => String(Number(f.properties.code)))) }
}

async function main() {
  const soiFile = process.argv[2]
  if (!soiFile) { console.error('usage: node scripts/fill-districts-from-soi.cjs <SOI_Districts.geojsonl>'); process.exit(1) }

  const layers = new Map()
  for (const st of admin) layers.set(Number(st.st_code), existingCodes(Number(st.st_code)))

  const pending = new Map()
  let features = 0
  let unresolved = 0
  const sample = []

  for await (const line of readLines(soiFile, { onOversizedLine: (len) => console.warn(`  ! skipped oversized line (${len})`) })) {
    if (!line.trim()) continue
    features++
    let f
    try { f = JSON.parse(line) } catch { continue }
    const p = f.properties
    const stateCode = resolveAppStateCode(p.STATE_C ?? p.STATE)
    if (stateCode == null) { unresolved++; continue }
    const layer = layers.get(stateCode)
    const match = resolveDistrict(stateCode, p.District_C ?? p.District)
    if (!match) { unresolved++; if (sample.length < 20) sample.push(`${p.STATE_C}/${p.District_C}`); continue }
    if (layer.codes.has(match.dtCode)) continue // already covered — never overwrite

    const polys = simplifyGeometry(f.geometry)
    if (!polys.length) continue
    const key = `${stateCode}/${match.dtCode}`
    const entry = pending.get(key)
    if (entry) entry.polyLists.push(...polys)
    else pending.set(key, { stateCode, code: match.dtCode, name: match.name, polyLists: [...polys] })
  }

  const addedByState = new Map()
  for (const { stateCode, code, name, polyLists } of pending.values()) {
    const geometry = combine(polyLists)
    if (!geometry) continue
    const layer = layers.get(stateCode)
    layer.features.push({ type: 'Feature', properties: { name, code }, geometry })
    layer.codes.add(code)
    addedByState.set(stateCode, (addedByState.get(stateCode) ?? 0) + 1)
  }
  for (const [stateCode, added] of addedByState) {
    const layer = layers.get(stateCode)
    layer.features.sort((a, b) => Number(a.properties.code) - Number(b.properties.code))
    fs.writeFileSync(layer.file, JSON.stringify({ type: 'FeatureCollection', features: layer.features }))
    const st = admin.find((s) => Number(s.st_code) === stateCode)
    console.log(`  + ${added} district outline(s)  ${st.st_nm}`)
  }
  const total = [...addedByState.values()].reduce((a, b) => a + b, 0)
  console.log(`\n${features} source features: ${total} districts added, ${unresolved} unresolved`)
  if (sample.length) console.log('  unresolved e.g.:', sample.join('; '))
}

main()
