// Repairs taluka features whose geometry was left as many small unmerged
// polygon fragments instead of one dissolved shape (e.g. Rajasthan's "Riyan
// Bari": 187 slivers instead of 1 polygon + a few real islands). Detected by
// an outsized MultiPolygon part count for a single taluka; fixed by unioning
// the feature's own parts back together with polygon-clipping, which merges
// every pair of parts that are actually adjacent/overlapping and leaves
// genuinely separate regions (real islands/exclaves) alone.
//
// Run: node scripts/repair-fragmented-talukas.cjs
const fs = require('fs')
const path = require('path')
const pc = require('polygon-clipping')

const TALUKA_DIR = path.join(__dirname, '..', 'src', 'assets', 'talukas')

// A taluka legitimately made of a handful of separate parts (a mainland
// piece plus a couple of real islands/exclaves) is normal; dozens+ of parts
// for one taluka is the fragmentation bug.
const PART_THRESHOLD = 10

/** Unions a batch of polygon parts, or returns null if even that batch is too
 *  much for polygon-clipping in one call (degenerate ring, or a stack
 *  overflow from a too-large internal sweep). */
function tryUnion(parts) {
  try {
    return pc.union(parts)
  } catch {
    return null
  }
}

/** Divide-and-conquer union: splits into small chunks (shallow enough that
 *  polygon-clipping doesn't blow its internal recursion on a single call),
 *  unions each chunk, then unions the chunk results back together. A single
 *  whole-shot union of a heavily shattered taluka (100s of parts) reliably
 *  hits polygon-clipping's recursion/segment-tracking limits; halving the
 *  problem at each level keeps every individual union call small. */
function chunkedUnion(parts, chunkSize) {
  if (parts.length <= 1) return parts
  if (parts.length <= chunkSize) return tryUnion(parts) ?? parts
  const mid = Math.floor(parts.length / 2)
  const left = chunkedUnion(parts.slice(0, mid), chunkSize)
  const right = chunkedUnion(parts.slice(mid), chunkSize)
  return tryUnion(left.concat(right)) ?? left.concat(right)
}

/** Re-unioning collapsed fragments can still leave slivers along seams
 *  between chunks (each chunk was merged internally, but two neighbouring
 *  chunks' shared edge may not have been re-checked against each other at a
 *  coarser grouping) — repeat the chunked union over its own output until it
 *  stops shrinking or a cap is hit, so multi-level seams get cleaned up too. */
function repairGeometry(parts) {
  let cur = parts
  for (let round = 0; round < 8; round++) {
    const next = chunkedUnion(cur, 8)
    if (!next || next.length >= cur.length) return cur
    cur = next
  }
  return cur
}

function main() {
  const files = fs.readdirSync(TALUKA_DIR).filter((f) => f.endsWith('.json'))
  let repairedFeatures = 0

  for (const file of files) {
    const full = path.join(TALUKA_DIR, file)
    const data = JSON.parse(fs.readFileSync(full, 'utf8'))
    let changed = false

    for (const f of data.features) {
      const g = f.geometry
      if (g.type !== 'MultiPolygon' || g.coordinates.length <= PART_THRESHOLD) continue

      const before = g.coordinates.length
      const unioned = repairGeometry(g.coordinates)
      if (unioned.length >= before) continue

      f.geometry = unioned.length === 1
        ? { type: 'Polygon', coordinates: unioned[0] }
        : { type: 'MultiPolygon', coordinates: unioned }
      changed = true
      repairedFeatures++
      console.log(`  ${file} ${f.properties.name}: ${before} parts -> ${unioned.length}`)
    }

    if (changed) fs.writeFileSync(full, JSON.stringify(data))
  }

  console.log(`\nrepaired ${repairedFeatures} taluka feature(s)`)
}

main()
