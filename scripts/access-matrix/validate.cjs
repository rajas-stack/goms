// Validates the canonical workbook and the generated policy inside "Access Matrix.dc.html".
//   node scripts/access-matrix/validate.cjs [workbook.xlsx] [design.dc.html]
// Exits 1 on any failure.
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { parseWorkbook, SHEET, TEAMS, PAGES, SCOPES } = require('./policy.cjs')
const engine = require('./engine.cjs')

const root = path.resolve(__dirname, '..', '..')
const workbook = path.resolve(process.argv[2] || path.join(root, 'GOMS_RBAC_FINAL_implementation_ready_v7.xlsx'))
const target = path.resolve(process.argv[3] || path.join(root, 'Access Matrix.dc.html'))
const failures = []
const fail = (code, msg) => failures.push({ code, msg })
const CHECKS = ['edit-without-read', 'undefined-scope', 'hidden-with-scope', 'invalid-level-token', 'invalid-team-token', 'own-asg-preserved', 'cxo-level-restricted', 'missing-from-matrix', 'stale-react-policy', 'stale-react-engine']

// 1. Strict workbook parse
const { errors } = parseWorkbook(workbook)
errors.forEach((e) => fail(e.code, `${e.ctx}: ${e.msg}`))

// 2. Read the generated block back out of the design file
const html = fs.readFileSync(target, 'utf8')
const a = html.indexOf('// <access-matrix:generated>'), b = html.indexOf('// </access-matrix:generated>')
if (a < 0 || b < a) { console.error('generated block not found in ' + target); process.exit(1) }
const block = html.slice(a, b)
const m = block.match(/const POLICY = (\{.*\});\s*$/s)
if (!m) { console.error('POLICY not found in generated block'); process.exit(1) }
const policy = JSON.parse(m[1])
const engineSrc = fs.readFileSync(path.join(__dirname, 'engine.cjs'), 'utf8').trimEnd()
if (!block.includes(engineSrc)) fail('stale-engine', 'engine.cjs differs from the copy inlined in the design file; re-run build.cjs')
if (JSON.stringify(policy.teams) !== JSON.stringify(TEAMS)) fail('invalid-team-token', 'POLICY.teams differs from the canonical team order')
if (JSON.stringify(policy.pages.map((p) => p.name)) !== JSON.stringify(PAGES)) fail('unexpected-page', 'POLICY pages are not exactly ' + PAGES.join(', '))

// CXO may only hold L0 and L1. The strict parse above checks the workbook; this checks the GENERATED policies directly,
// so a hand-edited or stale generated file cannot smuggle in a CXO cell above L1.
const cxoViolations = (pol, label) => {
  const ti = pol.teams.indexOf('CXO')
  if (ti < 0) return
  for (const pg of pol.pages) for (const f of pg.fields) (f.p[ti] || '').split(',').forEach((cell, l) => {
    if (!engine.amLevelAllowed('CXO', l) && engine.amDecodeCell(cell).state > 0) fail('cxo-level-restricted', `${label}: ${pg.name}|${f.s}|${f.n} [CXO L${l}] is "${cell}"; CXO may only hold L0 and L1`)
  })
}
cxoViolations(policy, 'design file policy')

// 3. Independent re-read of the raw sheet, compared cell by cell with what the matrix will use
const rows = XLSX.utils.sheet_to_json(XLSX.readFile(workbook).Sheets[SHEET], { header: 1, defval: '' }).slice(1).filter((r) => r[2])
const embedded = new Map()
for (const p of policy.pages) {
  for (const f of p.fields) {
    const k = `${p.name}|${f.s}|${f.n}`
    if (embedded.has(k)) fail('duplicate-field', 'generated matrix has duplicate field ' + k)
    embedded.set(k, f)
  }
}
let cells = 0, ownAsgBoth = 0, ownOnly = 0, asgOnly = 0
const states = [0, 0, 0]
const scopeCount = {}
for (const r of rows) {
  const key = `${r[0]}|${r[1]}|${r[2]}`
  const f = embedded.get(key)
  if (!f) { fail('missing-from-matrix', 'in canonical sheet but not in generated matrix: ' + key); continue }
  embedded.delete(key)
  TEAMS.forEach((t, ti) => {
    const toks = String(r[5 + ti]).split('|').map((s) => s.trim())
    const enc = (f.p[ti] || '').split(',')
    if (toks.length !== 6 || enc.length !== 6) { fail('invalid-level-token', `${key} [${t}] has ${toks.length} sheet / ${enc.length} generated level cells`); return }
    toks.forEach((tok, l) => {
      cells++
      const d = engine.amDecodeCell(enc[l])
      const mm = tok.match(/^L(\d):(H|RW|R)(?:@(.+))?$/)
      if (!mm || +mm[1] !== l) return // already reported by the strict parse
      const wantState = mm[2] === 'H' ? 0 : mm[2] === 'RW' ? 2 : 1
      const wantScopes = mm[3] ? mm[3].split('/').map((s) => s.trim()) : []
      states[d.state]++
      if (d.state !== wantState) fail('state-mismatch', `${key} [${t} L${l}] sheet "${tok}" -> generated "${enc[l]}"`)
      if (wantState === 0 && enc[l].length > 1) fail('hidden-with-scope', `${key} [${t} L${l}] generated Denied cell carries a scope "${enc[l]}"`)
      if (wantState > 0) {
        if (wantScopes.some((s) => !SCOPES.includes(s))) return // reported as undefined-scope
        if (JSON.stringify([...wantScopes].sort()) !== JSON.stringify([...d.scopes].sort())) fail('scope-mismatch', `${key} [${t} L${l}] sheet "${tok}" -> generated scopes ${d.scopes.join('/')}`)
        d.scopes.forEach((s) => { scopeCount[s] = (scopeCount[s] || 0) + 1 })
        const hasBoth = d.scopes.includes('OWN') && d.scopes.includes('ASG')
        if (mm[3] === 'OWN/ASG') {
          if (hasBoth && d.scopes.length === 2) ownAsgBoth++
          else fail('own-asg-preserved', `${key} [${t} L${l}] OWN/ASG not kept as two separate scopes: ${d.scopes.join('/')}`)
        } else if (mm[3] === 'OWN') {
          if (d.scopes.length === 1 && d.scopes[0] === 'OWN') ownOnly++
          else fail('own-asg-preserved', `${key} [${t} L${l}] OWN changed to ${d.scopes.join('/')}`)
        } else if (mm[3] === 'ASG') {
          if (d.scopes.length === 1 && d.scopes[0] === 'ASG') asgOnly++
          else fail('own-asg-preserved', `${key} [${t} L${l}] ASG changed to ${d.scopes.join('/')}`)
        }
      }
    })
  })
}
for (const k of embedded.keys()) fail('extra-in-matrix', 'in generated matrix but not in canonical sheet: ' + k)

// 4. Scope dropdown in the design offers every scope label the engine can produce
const labels = [...Object.values(engine.AM_SCOPE_LABEL), 'Own / Assigned']
for (const l of labels) if (!html.includes(`<option value="${l}">`)) fail('missing-scope-option', `design has no scope dropdown option "${l}"`)

// 5. The React module consumes generated files; they must be exactly what the workbook produces right now
const genDir = path.join(root, 'src', 'modules', 'admin-access', 'access-matrix', 'generated')
const readGen = (f) => { try { return fs.readFileSync(path.join(genDir, f), 'utf8') } catch { return null } }
const tsPolicy = readGen('policy.generated.ts')
if (tsPolicy === null) fail('stale-react-policy', 'src/.../generated/policy.generated.ts is missing; run build.cjs')
else {
  const tm = tsPolicy.match(/export const POLICY: Policy = (\{.*\})\s*$/s)
  if (!tm || JSON.stringify(JSON.parse(tm[1])) !== JSON.stringify(policy)) fail('stale-react-policy', 'policy.generated.ts differs from the policy embedded in the design file; run build.cjs')
  if (tm) cxoViolations(JSON.parse(tm[1]), 'policy.generated.ts')
}
const jsEngine = readGen('engine.generated.js')
if (jsEngine === null || !jsEngine.includes(engineSrc)) fail('stale-react-engine', 'engine.generated.js does not contain the current engine.cjs source; run build.cjs')
const dts = readGen('engine.generated.d.ts')
if (dts === null || dts !== fs.readFileSync(path.join(__dirname, 'engine.d.ts'), 'utf8')) fail('stale-react-engine', 'engine.generated.d.ts differs from scripts/access-matrix/engine.d.ts; run build.cjs')

// Report
const count = (c) => failures.filter((f) => f.code === c).length
const fieldCount = rows.length
console.log('Workbook :', path.basename(workbook), `(sheet "${SHEET}")`)
console.log('Matrix   :', path.basename(target))
console.log(`Fields   : ${fieldCount} in sheet, ${policy.pages.reduce((n, p) => n + p.fields.length, 0)} generated (${policy.pages.map((p) => `${p.name} ${p.fields.length}`).join(', ')})`)
console.log(`Cells    : ${cells} (${fieldCount} fields x ${TEAMS.length} teams x 6 levels = ${fieldCount * TEAMS.length * 6})`)
console.log(`States   : Denied ${states[0]}, Read ${states[1]}, Edit ${states[2]}`)
console.log('Scopes   :', Object.entries(scopeCount).map(([k, v]) => `${k} ${v}`).join(', '))
console.log(`OWN/ASG  : ${ownAsgBoth} OWN/ASG cells kept as two scopes, ${ownOnly} OWN-only, ${asgOnly} ASG-only`)
console.log('Checks   :')
for (const c of CHECKS) console.log(`  ${count(c) ? 'FAIL' : 'ok  '} ${c}${count(c) ? ' (' + count(c) + ')' : ''}`)
if (failures.length) {
  failures.slice(0, 40).forEach((f) => console.log(`  [${f.code}] ${f.msg}`))
  console.log(`FAILED: ${failures.length} problem(s)`)
  process.exit(1)
}
console.log('PASSED')
