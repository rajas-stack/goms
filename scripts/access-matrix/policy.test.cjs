// Plain node:assert tests for the workbook parser's CXO level rule (same convention as engine.test.cjs). Run directly:
//   node scripts/access-matrix/policy.test.cjs
// Builds throw-away workbooks in the OS temp directory; nothing in the repo is read or written.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const XLSX = require('xlsx')
const { parseWorkbook, validateActionGrants, TEAMS, PAGES, SHEET, OPPORTUNITY_TEAM_SUBSECTIONS } = require('./policy.cjs')

const DENIED = 'L0:H | L1:H | L2:H | L3:H | L4:H | L5:H'
const HEADER = ['Area', 'Section/Page', 'Field / Data Element', 'Category', 'Sensitivity', ...TEAMS, 'Notes']
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-policy-test-'))
let n = 0

/** Parse a one-field-per-page workbook where `over` replaces named teams' level tokens on the first page's field. */
function errorsFor(over) {
  const rows = PAGES.map((page, i) => [page, 'Section', `Field ${i}`, 'Cat', 'Low', ...TEAMS.map((t) => (i === 0 && over[t]) || DENIED), ''])
  // the parser requires the Teams subsections to exist under Opportunity
  OPPORTUNITY_TEAM_SUBSECTIONS.forEach((s) => rows.push(['Opportunity', s, `${s} field`, 'Cat', 'Low', ...TEAMS.map(() => DENIED), '']))
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SHEET)
  const file = path.join(dir, `w${n++}.xlsx`)
  XLSX.writeFile(wb, file)
  return parseWorkbook(file).errors
}
const levels = (l, token) => [0, 1, 2, 3, 4, 5].map((i) => (i === l ? `L${i}:${token}` : `L${i}:H`)).join(' | ')

try {
  // the throw-away workbook is itself valid
  assert.deepStrictEqual(errorsFor({}), [], 'an all-Denied workbook has no errors')

  // CXO at L0 and L1 may be Read or Edit
  assert.deepStrictEqual(errorsFor({ CXO: 'L0:RW@C | L1:RW@C | L2:H | L3:H | L4:H | L5:H' }), [])
  assert.deepStrictEqual(errorsFor({ CXO: 'L0:R@C | L1:R@C | L2:H | L3:H | L4:H | L5:H' }), [])

  // CXO at each of L2, L3, L4, L5 must fail validation for Read and for Edit
  for (const l of [2, 3, 4, 5]) {
    for (const [word, token] of [['Read', 'R@C'], ['Edit', 'RW@C']]) {
      const errs = errorsFor({ CXO: levels(l, token) })
      const hit = errs.filter((e) => e.code === 'cxo-level-restricted')
      assert.strictEqual(hit.length, 1, `CXO L${l} ${word} must raise exactly one cxo-level-restricted error, got ${JSON.stringify(errs)}`)
      assert.ok(/CXO/.test(hit[0].ctx) && hit[0].ctx.includes(`L${l}`), 'the error names the team and the level')
      assert.strictEqual(errs.length, 1, `CXO L${l} ${word} raises no other error`)
    }
  }
  // every prohibited level at once is reported cell by cell
  assert.strictEqual(errorsFor({ CXO: 'L0:R@C | L1:R@C | L2:R@BU | L3:R@DEP | L4:R@MGR | L5:R@OWN/ASG' }).filter((e) => e.code === 'cxo-level-restricted').length, 4)

  // CXO Denied at L2-L5 passes; every other team keeps full L0-L5 freedom
  assert.deepStrictEqual(errorsFor({ CXO: 'L0:R@C | L1:RW@C | L2:H | L3:H | L4:H | L5:H' }), [])
  for (const t of TEAMS.filter((x) => x !== 'CXO')) {
    assert.deepStrictEqual(errorsFor({ [t]: 'L0:RW@C | L1:RW@C | L2:RW@BU | L3:RW@DEP | L4:RW@MGR | L5:RW@OWN/ASG' }), [], `${t} may hold any level`)
  }

  // action grants: the same rule
  const grant = (Team, Level) => ({ Team, Level, Action: 'Approve BOQ' })
  for (const l of [0, 1]) assert.deepStrictEqual(validateActionGrants([grant('CXO', `L${l}`)]), [], `CXO action at L${l} is valid`)
  for (const l of [2, 3, 4, 5]) {
    const errs = validateActionGrants([grant('CXO', `L${l}`)])
    assert.deepStrictEqual(errs.map((e) => e.code), ['cxo-level-restricted'], `CXO action at L${l} is rejected, not reassigned`)
    assert.deepStrictEqual(validateActionGrants([grant('CXO', l)]).map((e) => e.code), ['cxo-level-restricted'], `a numeric level ${l} is rejected too`)
  }
  assert.deepStrictEqual(validateActionGrants([grant('Sales', 'L2'), grant('Pre-sales', 'L5'), grant('Bid', 'L3')]), [], 'other teams may hold actions at L2-L5')
  assert.deepStrictEqual(validateActionGrants([grant('Nobody', 'L1')]).map((e) => e.code), ['invalid-team-token'])
  for (const bad of ['L6', 'L-1', 'X', 7, -1, 1.5, undefined, null]) {
    assert.deepStrictEqual(validateActionGrants([grant('CXO', bad)]).map((e) => e.code), ['invalid-level-token'], `level ${String(bad)} is not a level`)
  }
  assert.deepStrictEqual(validateActionGrants([]), [])
  assert.throws(() => validateActionGrants(null), /array/i, 'a non-array is a programming error, not a pass')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('access-matrix policy tests passed')
