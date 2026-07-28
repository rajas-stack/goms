// Pure geometry helpers for scripts/simplify-geo-assets.cjs — no file I/O
// here, so the prune/simplify/round logic can be unit-tested without
// touching the real (hundreds-of-MB) asset directories.
//
// Investigation finding (see docs/superpowers/specs/2026-07-28-load-time-
// optimization-design.md): the dominant source of file size in districts/
// talukas is not excess point density but tens of thousands of near-zero-
// area sliver holes left by the dissolve/union step that built this data —
// mismatched shared edges between adjacent source polygons. Pruning those
// (HOLE_AREA_FRACTION) is the primary lever; Douglas-Peucker simplification
// (TOLERANCE_FRACTION) is secondary, and is village-shapes' only lever since
// those files have no holes.
const { simplify } = require('@turf/simplify')

const HOLE_AREA_FRACTION = 1e-4
const TOLERANCE_FRACTION = 0.02
const MIN_TOLERANCE_FRACTION = TOLERANCE_FRACTION / 8
const ROUND_DECIMALS = 5

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function bboxArea(ring) {
  const b = bboxOf(ring)
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

function bboxDiagonal(ring) {
  const b = bboxOf(ring)
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
}

/** Signed planar area of a ring (shoelace formula) — same winding
 *  convention GeoMapView.tsx's `ringArea` already uses. */
function ringArea(ring) {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

function isUsableRing(ring) {
  return ring.length >= 4 && Math.abs(ringArea(ring)) > 0
}

function roundCoords(coords, decimals) {
  const factor = 10 ** decimals
  if (typeof coords[0] === 'number') {
    return coords.map((n) => Math.round(n * factor) / factor)
  }
  return coords.map((c) => roundCoords(c, decimals))
}

/** Douglas-Peucker-simplifies one ring, retrying at half the tolerance
 *  whenever an attempt throws (`@turf/simplify` throws on some malformed
 *  results, e.g. "fewer than 4 points") or produces a degenerate ring,
 *  down to MIN_TOLERANCE_FRACTION of the ring's own bounding-box diagonal.
 *  Falls back to the untouched original ring if no attempt succeeds — a
 *  ring is never dropped or corrupted, worst case it keeps its original
 *  point density.
 *
 *  Validity is checked as "at least 4 points and non-zero area" rather than
 *  via `@turf/boolean-valid` or `@turf/kinks`: boolean-valid did not flag a
 *  hand-built self-intersecting test polygon, and kinks flags thousands of
 *  harmless touching-vertex "intersections" already present in this app's
 *  current, correctly-rendering production data (same dissolve artifact
 *  family as the sliver holes above) — neither matches this app's actual
 *  failure mode, which is a ring collapsing below a renderable shape. */
function simplifyRing(ring) {
  if (ring.length <= 4) return ring
  const diag = bboxDiagonal(ring)
  if (diag === 0) return ring

  let tolerance = diag * TOLERANCE_FRACTION
  const floor = diag * MIN_TOLERANCE_FRACTION
  while (tolerance >= floor) {
    try {
      const attempt = simplify(
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
        { tolerance, highQuality: true },
      )
      const simplified = attempt.geometry.coordinates[0]
      if (isUsableRing(simplified)) return simplified
    } catch {
      // Malformed attempt (e.g. collapsed below 4 points) — retry smaller.
    }
    tolerance /= 2
  }
  return ring
}

/** Rounds a ring, but only if rounding doesn't collapse it into a degenerate
 *  one (two points within ~1.1m of each other becoming numerically identical
 *  once rounded, zeroing out an already-tiny ring's area). Falls back to the
 *  unrounded (but still simplified) ring in that case — rounding is a pure
 *  byte-shaving step, never something that should be allowed to break a ring
 *  simplifyRing already confirmed was usable. */
function roundRingSafely(ring) {
  const rounded = roundCoords(ring, ROUND_DECIMALS)
  return isUsableRing(rounded) ? rounded : ring
}

/** Processes one Polygon's ring list: drops holes (index >= 1) whose area
 *  is negligible relative to the exterior ring's own bounding box — dissolve
 *  artifact slivers, not real geography — then simplifies + rounds whatever
 *  rings survive. The exterior ring (index 0) is never dropped by this
 *  function, only simplified — see processGeometry for the one case where a
 *  whole part can still disappear (a MultiPolygon part whose exterior was
 *  *already* degenerate before this ever ran). */
function processPolygonRings(rings) {
  const exterior = rings[0]
  const threshold = HOLE_AREA_FRACTION * bboxArea(exterior)
  const survivors = [exterior, ...rings.slice(1).filter((ring) => Math.abs(ringArea(ring)) >= threshold)]
  return survivors.map((ring) => roundRingSafely(simplifyRing(ring)))
}

function processGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: processPolygonRings(geometry.coordinates) }
  }
  if (geometry.type === 'MultiPolygon') {
    // A part whose exterior (ring 0) is already degenerate going in (e.g. a
    // sub-meter sliver left over from an earlier processing pass, before
    // roundRingSafely existed) can't be repaired — simplifyRing's own
    // ring.length <= 4 early-return means such a ring passes straight
    // through unchanged. Rather than keep an unusable, invisible part
    // around, drop it: every part dropped this way already has zero visible
    // area, and the feature's other parts (every one of these is a
    // MultiPolygon with more than one part) are untouched.
    const processed = geometry.coordinates.map(processPolygonRings)
    const usable = processed.filter((rings) => isUsableRing(rings[0]))
    // Never drop down to zero parts (would make the feature invisible) — in
    // the pathological case where every part is degenerate, keep them all
    // rather than erase the feature entirely.
    return { type: 'MultiPolygon', coordinates: usable.length > 0 ? usable : processed }
  }
  return geometry
}

function simplifyFeature(feature) {
  return { ...feature, geometry: processGeometry(feature.geometry) }
}

module.exports = {
  bboxOf,
  bboxArea,
  bboxDiagonal,
  ringArea,
  isUsableRing,
  roundCoords,
  simplifyRing,
  processPolygonRings,
  processGeometry,
  simplifyFeature,
  HOLE_AREA_FRACTION,
  TOLERANCE_FRACTION,
  MIN_TOLERANCE_FRACTION,
  ROUND_DECIMALS,
}
