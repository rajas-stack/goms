// Shared polygon-union helper for every boundary-dissolve step in the geo
// pipeline (villages -> taluka in build-geo-from-lgd.cjs, talukas -> district
// in dissolve-districts.cjs, and the standalone taluka self-repair in
// repair-fragmented-talukas.cjs). Unioning many adjacent source polygons
// whose shared edges don't land on identical coordinates (independently
// simplified/digitized pieces) reliably produces two kinds of debris instead
// of one clean seam:
//   1. Leftover sliver "parts" in the output MultiPolygon — a whole-shot
//      `pc.union` of dozens/hundreds of parts can throw outright (degenerate
//      ring, or a stack overflow in polygon-clipping's sweep line for very
//      large inputs) or silently return many unmerged fragments.
//   2. Near-zero-area interior "holes" in an otherwise-correct polygon, one
//      per seam that didn't perfectly close.
// robustUnion() fixes (1) via divide-and-conquer chunking (keeps every single
// polygon-clipping call small enough to succeed) repeated until it stops
// shrinking; dropSliverHoles() fixes (2) by area ratio against the same
// polygon's own exterior ring.
const path = require('path')
const { Worker } = require('worker_threads')
const pc = require('polygon-clipping')

function tryUnion(parts) {
  try {
    return pc.union(parts)
  } catch {
    return null
  }
}

/** Divide-and-conquer union: halves the input until each call is small enough
 *  for polygon-clipping to handle in one shot, unions each half, then unions
 *  the two results together. Falls back to plain concatenation (parts stay
 *  un-merged, but nothing is lost) wherever a union call fails even at the
 *  smallest chunk size. */
function chunkedUnion(parts, chunkSize = 8) {
  if (parts.length <= 1) return parts
  if (parts.length <= chunkSize) return tryUnion(parts) ?? parts
  const mid = Math.floor(parts.length / 2)
  const left = chunkedUnion(parts.slice(0, mid), chunkSize)
  const right = chunkedUnion(parts.slice(mid), chunkSize)
  return tryUnion(left.concat(right)) ?? left.concat(right)
}

/** Repeats chunkedUnion over its own output — a first pass can still leave
 *  slivers along seams between two chunks that were never unioned directly
 *  against each other — until it stops shrinking or a round cap is hit. */
function robustUnion(parts, maxRounds = 8) {
  let cur = parts
  for (let round = 0; round < maxRounds; round++) {
    const next = chunkedUnion(cur, 8)
    if (!next || next.length >= cur.length) return cur
    cur = next
  }
  return cur
}

/** Runs robustUnion(parts) in a worker thread with a hard wall-clock budget.
 *  A handful of source polygons (see union-worker.cjs) put polygon-clipping's
 *  sweep-line into what is, empirically, an unbounded-time worst case at even
 *  a single small leaf-level call — no amount of chunking helps because the
 *  bad geometry itself is what's slow, not the batch size. On timeout the
 *  worker is killed and the parts are returned un-dissolved (a real boundary
 *  with visible interior seams beats a pipeline that never finishes). */
function robustUnionWithTimeout(parts, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'union-worker.cjs'), { workerData: { parts } })
    const timer = setTimeout(() => {
      worker.terminate()
      resolve(parts)
    }, timeoutMs)
    worker.once('message', (result) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    })
    worker.once('error', () => {
      clearTimeout(timer)
      resolve(parts)
    })
  })
}

function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

// A hole under a tenth of a percent of its parent ring's area is definitionally
// invisible at any zoom this app renders boundaries at, and always a seam
// artifact rather than a genuine administrative enclave.
const SLIVER_HOLE_RATIO = 0.001

/** Drops holes (every ring after the first in a polygon) too small to be a
 *  real feature; keeps the exterior ring untouched. */
function dropSliverHoles(multi) {
  return multi.map((rings) => {
    if (rings.length <= 1) return rings
    const exteriorArea = ringArea(rings[0])
    const keptHoles = rings.slice(1).filter((r) => ringArea(r) >= exteriorArea * SLIVER_HOLE_RATIO)
    return [rings[0], ...keptHoles]
  })
}

module.exports = { robustUnion, robustUnionWithTimeout, dropSliverHoles, ringArea }
