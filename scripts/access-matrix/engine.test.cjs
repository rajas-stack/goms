// Plain node:assert tests (same convention as scripts/geo-simplify-lib.test.cjs). Run directly:
//   node scripts/access-matrix/engine.test.cjs
const assert = require('assert')
const { amDecodeCell, amEffective, amAccessForScope, amScopeLabel, amLabelToScopes } = require('./engine.cjs')
const { parseCell } = require('./policy.cjs')

const TEAMS = ['Sales', 'Pre-sales', 'Bid', 'Legal', 'Delivery', 'Finance', 'CXO', 'IT']
const denied = '0,0,0,0,0,0'
const field = (over) => {
  const p = TEAMS.map(() => denied)
  Object.entries(over).forEach(([t, v]) => { p[TEAMS.indexOf(t)] = v })
  return { n: 'f', s: 's', k: 'Low', p }
}

// decode
assert.deepStrictEqual(amDecodeCell('0'), { state: 0, scopes: [] })
assert.deepStrictEqual(amDecodeCell('1OA'), { state: 1, scopes: ['OWN', 'ASG'] })
assert.deepStrictEqual(amDecodeCell('2M'), { state: 2, scopes: ['MGR'] })
assert.strictEqual(amDecodeCell('1').state, 0, 'a grant without a scope is not a grant')
assert.strictEqual(amDecodeCell(undefined).state, 0)

// OWN and ASG stay separate; only the label joins them
assert.strictEqual(amScopeLabel(['OWN', 'ASG']), 'Own / Assigned')
assert.strictEqual(amScopeLabel(['OWN']), 'Own')
assert.strictEqual(amScopeLabel(['ASG']), 'Assigned')
assert.deepStrictEqual(amLabelToScopes('Own / Assigned'), ['OWN', 'ASG'])
assert.deepStrictEqual(amLabelToScopes('Own'), ['OWN'])

// default deny + a level never unlocks anything by itself
const f = field({ Sales: '1C,1C,1B,1D,0,0', Finance: '0,0,0,0,0,2O' })
assert.strictEqual(amEffective(f, ['Sales'], 4, TEAMS).state, 0, 'L4 has no cell, so no access even though L3 and above do')
assert.strictEqual(amEffective(f, ['Sales'], 3, TEAMS).state, 1)
assert.strictEqual(amEffective(f, ['Nobody'], 0, TEAMS).state, 0, 'unknown team is denied')
assert.strictEqual(amEffective(f, ['Sales'], 9, TEAMS).state, 0, 'invalid level is denied')
assert.strictEqual(amEffective(null, ['Sales'], 0, TEAMS).state, 0, 'unknown field is denied')
assert.strictEqual(amEffective(f, [], 0, TEAMS).state, 0, 'no teams is denied')

// additive multi-team: union of explicit grants, never widened scope
const g = field({ Sales: '1C,1C,1B,1D,1M,1OA', Finance: '0,0,0,0,0,2M' })
const one = amEffective(g, ['Sales'], 5, TEAMS)
assert.strictEqual(one.state, 1)
const both = amEffective(g, ['Sales', 'Finance'], 5, TEAMS)
assert.strictEqual(both.state, 2, 'Edit from one team plus Read from another is Edit')
assert.deepStrictEqual([...both.readScopes].sort(), ['ASG', 'MGR', 'OWN'])
assert.deepStrictEqual(both.editScopes, ['MGR'])
assert.strictEqual(amAccessForScope(both, 'MGR'), 2)
assert.strictEqual(amAccessForScope(both, 'OWN'), 1, 'Edit granted only on managed-team records does not extend to own records')
assert.strictEqual(amAccessForScope(both, 'DEP'), 0, 'a record outside every granting scope stays denied')
assert.strictEqual(amEffective(g, ['Finance', 'Sales'], 5, TEAMS).state, 2, 'order of teams does not matter')
assert.strictEqual(amEffective(g, ['Sales', 'Sales'], 5, TEAMS).state, 1, 'repeating a team changes nothing')
assert.deepStrictEqual([...amEffective(g, ['Sales', 'IT'], 5, TEAMS).readScopes].sort(), ['ASG', 'OWN'], 'a Denied team adds nothing')

// strict parser reports what the contract does not define
const codes = (s) => { const e = []; parseCell(s, 'x', e); return e.map((x) => x.code) }
const ok = 'L0:R@C | L1:R@C | L2:R@BU | L3:R@DEP | L4:R@MGR | L5:R@OWN/ASG'
assert.deepStrictEqual(codes(ok), [])
assert.ok(codes(ok.replace('L4:R@MGR', 'L4:R@business-scope')).includes('undefined-scope'))
assert.ok(codes(ok.replace('L0:R@C', 'L0:H@C')).includes('hidden-with-scope'))
assert.ok(codes(ok.replace('L1:R@C', 'L1:W@C')).includes('edit-without-read'))
assert.ok(codes(ok.replace('L2:R@BU', 'L3:R@BU')).includes('invalid-level-token'))
assert.ok(codes('L0:R@C | L1:R@C').includes('invalid-level-token'))
assert.ok(codes(ok.replace('L5:R@OWN/ASG', 'L5:R')).includes('missing-scope'))

// CXO level restriction: CXO may only ever hold L0 and L1. The engine denies CXO at L2-L5 even if a cell says otherwise
// (default-deny backstop behind the validator), and no other team is affected.
const { amLevelAllowed, AM_ALLOWED_LEVELS } = require('./engine.cjs')
assert.deepStrictEqual(AM_ALLOWED_LEVELS, { CXO: [0, 1] })
for (const l of [0, 1]) assert.strictEqual(amLevelAllowed('CXO', l), true, `CXO L${l} is allowed`)
for (const l of [2, 3, 4, 5]) assert.strictEqual(amLevelAllowed('CXO', l), false, `CXO L${l} is not allowed`)
for (const t of TEAMS.filter((x) => x !== 'CXO')) for (let l = 0; l < 6; l++) assert.strictEqual(amLevelAllowed(t, l), true, `${t} L${l} stays allowed`)
for (const odd of ['constructor', '__proto__', 'toString']) assert.strictEqual(amLevelAllowed(odd, 3), true, 'an inherited property name is not a restriction')
{
  const cxoEdit = field({ CXO: '2C,2C,2B,2D,2M,2OA' }) // a tampered cell: CXO Edit at every level
  for (const l of [0, 1]) assert.strictEqual(amEffective(cxoEdit, ['CXO'], l, TEAMS).state, 2, `CXO L${l} Edit is honoured`)
  for (const l of [2, 3, 4, 5]) {
    const e = amEffective(cxoEdit, ['CXO'], l, TEAMS)
    assert.strictEqual(e.state, 0, `CXO L${l} is Denied by default-deny even when the cell grants Edit`)
    assert.deepStrictEqual(e.readScopes, [])
    assert.deepStrictEqual(e.grantedBy, [])
  }
  const cxoRead = field({ CXO: '1C,1C,1B,1D,1M,1OA' })
  for (const l of [2, 3, 4, 5]) assert.strictEqual(amEffective(cxoRead, ['CXO'], l, TEAMS).state, 0, `CXO L${l} Read is Denied`)
  // another team's grant at the same level is not removed by the CXO rule, and CXO adds nothing to it
  const mixed = field({ CXO: '2C,2C,2B,2D,2M,2OA', Sales: '1C,1C,1B,1D,1M,1OA' })
  const m = amEffective(mixed, ['CXO', 'Sales'], 3, TEAMS)
  assert.strictEqual(m.state, 1)
  assert.deepStrictEqual(m.grantedBy, ['Sales'])
  const salesEdit = field({ Sales: '2C,2C,2B,2D,2M,2OA' })
  for (let l = 0; l < 6; l++) assert.strictEqual(amEffective(salesEdit, ['Sales'], l, TEAMS).state, 2, `Sales L${l} is unaffected`)
}

console.log('access-matrix engine tests passed')
