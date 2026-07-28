// Fixture test — run directly: node scripts/simplify-geo-assets.test.cjs
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run } = require('./simplify-geo-assets.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-simplify-test-'))
const districtsDir = path.join(tmp, 'districts')
fs.mkdirSync(districtsDir)

const N = 64
const ring = []
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2
  ring.push([Math.cos(a) * 2, Math.sin(a) * 2])
}
ring.push(ring[0])
const fixture = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name: 'Fixture', code: '1' }, geometry: { type: 'Polygon', coordinates: [ring] } }],
}
const fixturePath = path.join(districtsDir, '1.json')
fs.writeFileSync(fixturePath, JSON.stringify(fixture))
const beforeBytes = fs.statSync(fixturePath).size

run([{ label: 'districts', dir: districtsDir, nested: false }], true)

const afterBytes = fs.statSync(fixturePath).size
const rewritten = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

assert.ok(afterBytes < beforeBytes, `expected file to shrink (${beforeBytes} -> ${afterBytes})`)
assert.strictEqual(rewritten.features.length, 1)
assert.strictEqual(rewritten.features[0].properties.code, '1')
assert.ok(rewritten.features[0].geometry.coordinates[0].length < ring.length, 'expected fewer points after simplification')

// dry-run (write=false) must not touch the file
const beforeDryRun = fs.readFileSync(fixturePath, 'utf8')
run([{ label: 'districts', dir: districtsDir, nested: false }], false)
const afterDryRun = fs.readFileSync(fixturePath, 'utf8')
assert.strictEqual(afterDryRun, beforeDryRun, 'write=false must not modify files')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('simplify-geo-assets: all tests passed')
