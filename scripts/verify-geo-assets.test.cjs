// Fixture test — run directly: node scripts/verify-geo-assets.test.cjs
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { verify } = require('./verify-geo-assets.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-verify-test-'))
const goodDir = path.join(tmp, 'good')
const badDir = path.join(tmp, 'bad')
fs.mkdirSync(goodDir)
fs.mkdirSync(badDir)

const validFeature = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'Square', code: '1' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  }],
}
fs.writeFileSync(path.join(goodDir, '1.json'), JSON.stringify(validFeature))

const degenerateFeature = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'Sliver', code: '2' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[5, 5], [5, 5], [5, 5]]],
    },
  }],
}
fs.writeFileSync(path.join(badDir, '2.json'), JSON.stringify(degenerateFeature))

const goodResult = verify([{ label: 'good', dir: goodDir, nested: false }])
assert.strictEqual(goodResult.errors.length, 0, `expected no errors, got ${JSON.stringify(goodResult.errors)}`)
assert.strictEqual(goodResult.summary[0].features, 1)

const badResult = verify([{ label: 'bad', dir: badDir, nested: false }])
assert.strictEqual(badResult.errors.length, 1, `expected exactly one error, got ${JSON.stringify(badResult.errors)}`)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('verify-geo-assets: all tests passed')
