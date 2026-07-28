// Read-only structural check over src/assets/{districts,talukas,village-shapes}:
// confirms every file parses as GeoJSON and every feature's geometry is a
// Polygon/MultiPolygon whose rings all have at least 4 points and non-zero
// area — the same usability criteria simplify-geo-assets.cjs's guard
// enforces. Run: node scripts/verify-geo-assets.cjs
const fs = require('fs')
const { listJsonFiles, TARGETS } = require('./simplify-geo-assets.cjs')
const { isUsableRing } = require('./geo-simplify-lib.cjs')

function countPoints(coords) {
  if (typeof coords[0] === 'number') return 1
  return coords.reduce((sum, c) => sum + countPoints(c), 0)
}

function checkGeometry(geometry, errors, context) {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring, i) => {
      if (!isUsableRing(ring)) errors.push(`${context}: ring ${i} is degenerate (${ring.length} points)`)
    })
    return
  }
  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly, p) => {
      poly.forEach((ring, i) => {
        if (!isUsableRing(ring)) errors.push(`${context}: part ${p} ring ${i} is degenerate (${ring.length} points)`)
      })
    })
    return
  }
  errors.push(`${context}: unexpected geometry type ${geometry.type}`)
}

function verify(targets) {
  const errors = []
  const summary = []

  for (const { label, dir, nested } of targets) {
    let bytes = 0
    let points = 0
    let features = 0
    for (const file of listJsonFiles(dir, nested)) {
      const raw = fs.readFileSync(file, 'utf8')
      bytes += Buffer.byteLength(raw)
      let data
      try {
        data = JSON.parse(raw)
      } catch (e) {
        errors.push(`${file}: invalid JSON (${e.message})`)
        continue
      }
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        errors.push(`${file}: not a FeatureCollection`)
        continue
      }
      for (const feature of data.features) {
        const context = `${file} feature ${feature.properties?.code ?? '?'}`
        if (!feature.geometry) {
          errors.push(`${context}: missing geometry`)
          continue
        }
        checkGeometry(feature.geometry, errors, context)
        features++
        points += countPoints(feature.geometry.coordinates)
      }
    }
    summary.push({ label, bytes, points, features })
  }

  return { errors, summary }
}

module.exports = { verify }

if (require.main === module) {
  const { errors, summary } = verify(TARGETS)
  for (const s of summary) {
    console.log(`${s.label}: ${s.features} features, ${s.points} points, ${s.bytes} bytes`)
  }
  if (errors.length) {
    console.error(`${errors.length} problem(s):`)
    errors.slice(0, 20).forEach((e) => console.error(' -', e))
    process.exitCode = 1
  } else {
    console.log('all features valid')
  }
}
