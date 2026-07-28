// Plain node:assert tests — this repo has no test runner configured, and
// adding one just for a one-time script would be overkill. Run directly:
// node scripts/geo-simplify-lib.test.cjs
const assert = require('assert')
const {
  bboxDiagonal, roundCoords, isUsableRing, simplifyRing, processPolygonRings,
} = require('./geo-simplify-lib.cjs')

// bboxDiagonal
{
  const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
  const diag = bboxDiagonal(ring)
  assert.ok(Math.abs(diag - Math.sqrt(2)) < 1e-9, `expected diagonal ~1.414, got ${diag}`)
}

// roundCoords
{
  const rounded = roundCoords([1.123456, 2.987654], 3)
  assert.deepStrictEqual(rounded, [1.123, 2.988])
}

// isUsableRing
{
  assert.strictEqual(isUsableRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), true)
  assert.strictEqual(isUsableRing([[0, 0], [1, 1], [0, 0]]), false) // fewer than 4 points
  assert.strictEqual(isUsableRing([[0, 0], [0, 0], [0, 0], [0, 0]]), false) // zero area
}

// simplifyRing reduces points on a densely-sampled, safely-simplifiable ring
{
  const N = 64
  const ring = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    ring.push([Math.cos(a) * 2, Math.sin(a) * 2])
  }
  ring.push(ring[0]) // exact closure — avoid float drift from evaluating cos/sin at exactly 2*PI
  const result = simplifyRing(ring)
  assert.ok(result.length < ring.length, `expected fewer points after simplification (${ring.length} -> ${result.length})`)
  assert.ok(isUsableRing(result), 'simplified ring must still be usable')
}

// simplifyRing falls back to the original ring when there's nothing to simplify
{
  const ring = [[5, 5], [5, 6], [6, 5], [5, 5]] // 4 points — already at the floor
  const result = simplifyRing(ring)
  assert.deepStrictEqual(result, ring)
}

// processPolygonRings drops a negligible-area hole but keeps a substantial one,
// and never drops the exterior ring even though it dwarfs both holes
{
  const exterior = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] // bbox area 100
  const tinyHole = [[5, 5], [5.0001, 5], [5.0001, 5.0001], [5, 5.0001], [5, 5]] // area ~1e-8, threshold is 1e-4 * 100 = 1e-2
  const substantialHole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]] // area 4
  const result = processPolygonRings([exterior, tinyHole, substantialHole])
  assert.strictEqual(result.length, 2, 'tiny hole should be pruned, substantial hole should survive')
  assert.strictEqual(result[0].length, exterior.length, 'exterior ring point count preserved (already at simplify floor)')
}

console.log('geo-simplify-lib: all tests passed')
