// One-time simplification pass over src/assets/{districts,talukas,village-shapes}.
// Run: node scripts/simplify-geo-assets.cjs [--dry-run]
const fs = require('fs')
const path = require('path')
const { simplifyFeature } = require('./geo-simplify-lib.cjs')

const ROOT = path.join(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')

const TARGETS = [
  { label: 'districts', dir: path.join(ROOT, 'src', 'assets', 'districts'), nested: false },
  { label: 'talukas', dir: path.join(ROOT, 'src', 'assets', 'talukas'), nested: false },
  { label: 'village-shapes', dir: path.join(ROOT, 'src', 'assets', 'village-shapes'), nested: true },
]

function listJsonFiles(dir, nested) {
  if (!nested) {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f))
  }
  const files = []
  for (const sub of fs.readdirSync(dir)) {
    const subPath = path.join(dir, sub)
    if (!fs.statSync(subPath).isDirectory()) continue
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith('.json')) files.push(path.join(subPath, f))
    }
  }
  return files
}

function simplifyOneFile(filePath, write) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const beforeBytes = Buffer.byteLength(raw)
  const data = JSON.parse(raw)
  data.features = data.features.map(simplifyFeature)
  const out = JSON.stringify(data)
  const afterBytes = Buffer.byteLength(out)
  if (write) fs.writeFileSync(filePath, out)
  return { beforeBytes, afterBytes }
}

function run(targets, write) {
  let grandBefore = 0
  let grandAfter = 0
  for (const { label, dir, nested } of targets) {
    const files = listJsonFiles(dir, nested)
    let before = 0
    let after = 0
    for (const file of files) {
      const r = simplifyOneFile(file, write)
      before += r.beforeBytes
      after += r.afterBytes
    }
    grandBefore += before
    grandAfter += after
    const pct = before === 0 ? '0.0' : (100 * (1 - after / before)).toFixed(1)
    console.log(`${label}: ${files.length} files, ${before} -> ${after} bytes (-${pct}%)`)
  }
  const grandPct = grandBefore === 0 ? '0.0' : (100 * (1 - grandAfter / grandBefore)).toFixed(1)
  console.log(`${write ? '' : '[dry-run] '}total: ${grandBefore} -> ${grandAfter} bytes (-${grandPct}%)`)
  return { grandBefore, grandAfter }
}

module.exports = { listJsonFiles, simplifyOneFile, run, TARGETS }

if (require.main === module) {
  run(TARGETS, !dryRun)
}
