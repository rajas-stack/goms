// Fills src/assets/talukas/<state>.json for hierarchy talukas still missing a
// polygon, from the LGD rural-development-block layer (LGD_Blocks, via
// https://github.com/yashveeeeeeer/india-geodata, CC BY 4.0, release tag
// admin/blocks). Never overwrites an existing polygon.
//
// Why blocks: this is the one national layer that has ANY coverage at all for
// Ladakh, Arunachal Pradesh, and better coverage of J&K/Nagaland/Manipur/
// Mizoram/Meghalaya/Himachal Pradesh than LGD_Subdistricts or SOI_Subdistricts
// — in hill/NE states the rural-development "block" often literally IS the
// administrative sub-district unit (no separate revenue tehsil layer), so a
// block corresponds directly to one of this app's taluka nodes. Confirmed by
// spot check: Ladakh's blocks are named DRASS/SHARGOL/TAISURU/NYOMA/KHALTSI/
// DURBUK/SASPOL/KHARU/Deskit — an near-exact match to the 9 Ladakh talukas
// this pipeline had no boundary for at all.
//
// In states with a real (finer) tehsil/block distinction, most blocks simply
// won't name-match a taluka and are safely skipped — this only ever adds a
// polygon when a block's name resolves uniquely to a hierarchy taluka in the
// correct district, so it can't misfile a many-blocks-per-tehsil state.
//
// Run: node --max-old-space-size=4096 scripts/fill-talukas-from-blocks.cjs <LGD_Blocks.geojsonl>
const fs = require('fs')
const path = require('path')
const { readLines } = require('./linereader.cjs')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const TALUKA_TOLERANCE = 0.001

const nd = (x) => String(x ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')
const nt = (x) => String(x ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(tehsil|tahsil|tahasil|taluka|taluk|mandal|circle|block|sub\s*division|subdivision|revenue|sadar)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '')

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
function nearestByEditDistance(n, candidates, getNormalised) {
  if (n.length <= 3) return undefined
  const budget = Math.max(2, Math.floor(n.length * 0.3))
  let best, bestDist = Infinity, tie = false
  for (const c of candidates) {
    const cn = getNormalised(c)
    if (Math.abs(cn.length - n.length) > budget) continue
    const d = editDistance(n, cn)
    if (d < bestDist) { bestDist = d; best = c; tie = false }
    else if (d === bestDist) tie = true
  }
  return best !== undefined && bestDist <= budget && !tie ? best : undefined
}

const STATE_ALIASES = {
  orissa: 'odisha',
  unionterritoryofjammuandkashmir: 'jammuandkashmir',
  unionterritoryofladakh: 'ladakh',
  jammukashmir: 'jammuandkashmir', // "JAMMU & KASHMIR" -> nd() drops "&" without an "and" to replace it
  andamannicobar: 'andamanandnicobarislands', // "ANDAMAN & NICOBAR" (no "Islands")
}
const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
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
  if (exact) return exact.dtCode
  const near = list.filter((d) => d.normalised.length > 3 && (d.normalised.includes(n) || n.includes(d.normalised)))
  if (near.length === 1) return near[0].dtCode
  const fuzzy = nearestByEditDistance(n, list, (d) => d.normalised)
  return fuzzy?.dtCode
}

const talukasByDistrict = new Map()
for (const s of subdistricts) {
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
}
function resolveTaluka(dtCode, blockName) {
  const candidates = talukasByDistrict.get(dtCode) ?? []
  const match = candidates.find((c) => nt(c.name) === nt(blockName))
  if (match) return match
  const n = nt(blockName)
  if (n.length > 3) {
    const near = candidates.filter((c) => {
      const cn = nt(c.name)
      return cn.length > 3 && (cn.includes(n) || n.includes(cn))
    })
    if (near.length === 1) return near[0]
  }
  return nearestByEditDistance(n, candidates, (c) => nt(c.name))
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
  rdp(open, 0, open.length - 1, TALUKA_TOLERANCE ** 2, keep)
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
  // do NOT .flat() this (see fill-talukas-from-soi.cjs for the bug that
  // caused when this was gotten wrong).
  const polys = polyLists
  if (!polys.length) return null
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

function existingCodes(stateCode) {
  const file = path.join(TALUKA_DIR, `${stateCode}.json`)
  if (!fs.existsSync(file)) return { file, features: [], codes: new Set() }
  const features = JSON.parse(fs.readFileSync(file, 'utf8')).features
  return { file, features, codes: new Set(features.map((f) => String(Number(f.properties.code)))) }
}

async function main() {
  const blocksFile = process.argv[2]
  if (!blocksFile) { console.error('usage: node scripts/fill-talukas-from-blocks.cjs <LGD_Blocks.geojsonl>'); process.exit(1) }

  const layers = new Map()
  for (const st of admin) layers.set(Number(st.st_code), existingCodes(Number(st.st_code)))

  const pending = new Map()
  let features = 0
  let unresolvedState = 0, unresolvedDistrict = 0, unresolvedTaluka = 0, alreadyCovered = 0
  const sample = { state: [], district: [], taluka: [] }

  for await (const line of readLines(blocksFile, { onOversizedLine: (len) => console.warn(`  ! skipped oversized line (${len})`) })) {
    if (!line.trim()) continue
    features++
    let f
    try { f = JSON.parse(line) } catch { continue }
    const p = f.properties

    const stateCode = resolveAppStateCode(p.state)
    if (stateCode == null) { unresolvedState++; if (sample.state.length < 10) sample.state.push(p.state); continue }
    const dtCode = resolveDistrict(stateCode, p.district)
    if (!dtCode) { unresolvedDistrict++; if (sample.district.length < 15) sample.district.push(`${p.state}/${p.district}`); continue }
    const match = resolveTaluka(dtCode, p.block_name)
    if (!match) { unresolvedTaluka++; if (sample.taluka.length < 15) sample.taluka.push(`${p.state}/${p.district}/${p.block_name}`); continue }

    const code = String(Number(match.code))
    const layer = layers.get(stateCode)
    if (layer.codes.has(code)) { alreadyCovered++; continue }

    const polys = simplifyGeometry(f.geometry)
    if (!polys.length) continue
    const key = `${stateCode}/${code}`
    const entry = pending.get(key)
    if (entry) entry.polyLists.push(...polys)
    else pending.set(key, { stateCode, code, name: match.name, polyLists: [...polys] })
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
    console.log(`  + ${String(added).padStart(4)} taluka outlines  ${st.st_nm}`)
  }

  const total = [...addedByState.values()].reduce((a, b) => a + b, 0)
  console.log(
    `\n${features} source features: ${total} talukas added, ${alreadyCovered} already had a polygon, ` +
    `unresolved state ${unresolvedState} / district ${unresolvedDistrict} / taluka ${unresolvedTaluka}`,
  )
  if (sample.state.length) console.log('  unresolved states e.g.:', [...new Set(sample.state)].join(', '))
  if (sample.district.length) console.log('  unresolved districts e.g.:', sample.district.slice(0, 10).join('; '))
  if (sample.taluka.length) console.log('  unresolved talukas e.g.:', sample.taluka.slice(0, 10).join('; '))
}

main()
