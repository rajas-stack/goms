import { describe, expect, it } from 'vitest'
import { accessFor, allows, inScope } from './evaluate.js'
import type { Role, ScopeFacts, UserFacts } from './types.js'

const user = (roles: Role[], extra: Partial<UserFacts> = {}): UserFacts => ({
  email: 'u@amnex.com', roles, salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] }, ...extra,
})
const row = (extra: Partial<ScopeFacts> = {}): ScopeFacts => ({
  salesOwnerIds: [], createdBy: null, assigned: { presales: null, legal: null, bid: null }, ...extra,
})

describe('scopes', () => {
  it('own = effective owner / delegate / Geo-BU person, or the row creator', () => {
    const sales = user(['sales'], { salesPersonId: 'sp1' })
    expect(inScope('own', 'sales', sales, row({ salesOwnerIds: ['sp1', 'sp9'] }))).toBe(true)
    expect(inScope('own', 'sales', sales, row({ salesOwnerIds: ['sp9'] }))).toBe(false)
    expect(inScope('own', 'sales', sales, row({ createdBy: 'u@amnex.com' }))).toBe(true)
    expect(inScope('own', 'sales', user(['sales']), row({ createdBy: 'U@Amnex.com'.toLowerCase() }))).toBe(true)
  })
  it('a Sales user with no roster row never matches own by id, and a creator match needs their own email', () => {
    const noRoster = user(['sales'], { salesPersonId: null })
    expect(inScope('own', 'sales', noRoster, row({ salesOwnerIds: ['sp1'] }))).toBe(false)
    expect(inScope('own', 'sales', noRoster, row({ createdBy: 'someone@amnex.com' }))).toBe(false)
  })
  it('asg needs the slot that matches the role, and the slot must be one of the user\'s own ids', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: 'm1', legal: null, bid: null } }))).toBe(true)
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: 'm2', legal: null, bid: null } }))).toBe(false)
    expect(inScope('asg', 'presales', pre, row({ assigned: { presales: null, legal: 'm1', bid: null } }))).toBe(false)
  })
})

describe('accessFor — write scopes', () => {
  const sales = user(['sales'], { salesPersonId: 'sp1' })
  it('Sales is full-write on an own Pipeline row and read-only on someone else\'s', () => {
    const own = accessFor(sales, 'opp.pipeline', row({ salesOwnerIds: ['sp1'] }))
    expect(own.level).toBe('W')
    expect(allows(own, 'opp.value')).toBe(true)
    expect(allows(own, 'opp.stage')).toBe(true)
    const other = accessFor(sales, 'opp.pipeline', row({ salesOwnerIds: ['sp2'] }))
    expect(other.level).toBe('R')
    expect(allows(other, 'opp.value')).toBe(false)
  })
  it('Sales on Bid Tracker is Partial (S1) on own rows only', () => {
    const own = accessFor(sales, 'opp.bidTracker', row({ salesOwnerIds: ['sp1'] }))
    expect(own.level).toBe('P')
    expect([...own.atoms].sort()).toEqual(['bid.custom', 'bid.nextAction', 'opp.client', 'opp.emd', 'opp.teamSales', 'opp.value'])
    expect(allows(own, 'bid.stage')).toBe(false)
    expect(allows(own, 'opp.tenderId')).toBe(false)
  })
  it('with no row facts only scope-all grants count (an own-scoped grant gives read only)', () => {
    expect(accessFor(sales, 'opp.pipeline').level).toBe('R')
    expect(accessFor(user(['bid']), 'opp.bidTracker').level).toBe('W')
  })
  it('Pre-sales gets exactly P1 on an assigned row and nothing on others', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    const mine = accessFor(pre, 'opp.bidTracker', row({ assigned: { presales: 'm1', legal: null, bid: null } }))
    expect([...mine.atoms].sort()).toEqual(['bid.custom', 'bid.nextAction'])
    expect(accessFor(pre, 'opp.bidTracker', row()).level).toBe('R')
  })
  it('CXO may record the Go/No-Go decision on any bid but nothing else', () => {
    const cxo = accessFor(user(['cxo']), 'opp.bidTracker', row())
    expect(cxo.level).toBe('P')
    expect(allows(cxo, 'bid.decision')).toBe(true)
    expect(allows(cxo, 'bid.stage')).toBe(false)
  })
})

describe('accessFor — merging roles', () => {
  it('takes the max level and unions fields: the CFO is Legal + Finance + CXO and keeps all of them', () => {
    const cfo = user(['legal', 'finance', 'cxo'])
    const skus = accessFor(cfo, 'com.skus')
    expect(skus.level).toBe('P')
    expect(allows(skus, 'sku.costs')).toBe(true)
    const approval = accessFor(cfo, 'com.approvalMatrix')
    expect(approval.level).toBe('W') // CXO owns it; Finance is only R
    expect(accessFor(cfo, 'bid.corrigenda', row()).level).toBe('P') // Legal L2
  })
  it('any W grant means every non-exclusive atom', () => {
    const both = user(['sales', 'bid'], { salesPersonId: 'sp1' })
    const a = accessFor(both, 'opp.bidTracker', row({ salesOwnerIds: ['sp1'] }))
    expect(a.level).toBe('W')
    expect(allows(a, 'bid.stage')).toBe(true)
  })
})

describe('exclusive and frozen atoms', () => {
  it('Pre-sales is W on SKUs but cannot edit Finance-controlled fields; Finance can', () => {
    const pre = accessFor(user(['presales']), 'com.skus')
    expect(allows(pre, 'sku.other')).toBe(true)
    expect(allows(pre, 'sku.costs')).toBe(false)
    expect(allows(pre, 'sku.tax')).toBe(false)
    const fin = accessFor(user(['finance']), 'com.skus')
    expect(allows(fin, 'sku.costs')).toBe(true)
    expect(allows(fin, 'sku.other')).toBe(false)
  })
  it('Pre-sales is W on masters but not on tax classes / currencies; Finance edits only those', () => {
    expect(allows(accessFor(user(['presales']), 'com.masters'), 'master.other')).toBe(true)
    expect(allows(accessFor(user(['presales']), 'com.masters'), 'master.taxClasses')).toBe(false)
    expect(allows(accessFor(user(['finance']), 'com.masters'), 'master.currencies')).toBe(true)
    expect(allows(accessFor(user(['finance']), 'com.masters'), 'master.other')).toBe(false)
  })
  it('BOQ approve is CXO-only: Pre-sales W does not imply it', () => {
    expect(allows(accessFor(user(['presales']), 'com.boqs'), 'boq.lines')).toBe(true)
    expect(allows(accessFor(user(['presales']), 'com.boqs'), 'boq.approve')).toBe(false)
    expect(allows(accessFor(user(['cxo']), 'com.boqs'), 'boq.approve')).toBe(true)
    expect(allows(accessFor(user(['cxo']), 'com.boqs'), 'boq.lines')).toBe(false)
  })
  it('nobody — not even a W role — can write Solution Lead', () => {
    const cxo = accessFor(user(['cxo']), 'am.ownership', row())
    expect(cxo.level).toBe('W')
    expect(allows(cxo, 'ownership.assign')).toBe(true)
    expect(allows(cxo, 'ownership.solutionLead')).toBe(false)
  })
  it('Bid may assign the bid-level owner only', () => {
    const bid = accessFor(user(['bid']), 'am.ownership', row())
    expect(allows(bid, 'ownership.bidEntity')).toBe(true)
    expect(allows(bid, 'ownership.assign')).toBe(false)
  })
})

describe('create / delete', () => {
  it('create is not row-scoped without a parent row (Sales creating a Pipeline row)', () => {
    expect(accessFor(user(['sales']), 'opp.pipeline').create).toBe(true)
  })
  it('create under a parent row needs the parent in scope (Pre-sales uploading a tender document)', () => {
    const pre = user(['presales'], { teamMemberIds: { presales: ['m1'], legal: [], bid: [] } })
    expect(accessFor(pre, 'bid.documents').create).toBe(true)
    expect(accessFor(pre, 'bid.documents', row({ assigned: { presales: 'm1', legal: null, bid: null } })).create).toBe(true)
    expect(accessFor(pre, 'bid.documents', row({ assigned: { presales: 'm2', legal: null, bid: null } })).create).toBe(false)
  })
  it('a delete needs the row inside the grant scope (Sales deleting a meeting)', () => {
    const sales = user(['sales'], { salesPersonId: 'sp1' })
    expect(accessFor(sales, 'am.meetings', row({ salesOwnerIds: ['sp1'] })).delete).toBe(true)
    expect(accessFor(sales, 'am.meetings', row({ salesOwnerIds: ['sp2'] })).delete).toBe(false)
    expect(accessFor(sales, 'am.meetings').delete).toBe(false)
  })
})

describe('baseline and implied reads', () => {
  it('a user with no roles can read Geography and nothing else', () => {
    expect(accessFor(user([]), 'am.geography').level).toBe('R')
    expect(accessFor(user([]), 'am.contacts').level).toBe('N')
    expect(accessFor(user([]), 'opp.bidTracker').level).toBe('N')
  })
  it('reading BOQs implies read-only access to SKUs and reference masters (gap A2)', () => {
    const bid = user(['bid'])
    expect(accessFor(bid, 'com.skus').level).toBe('R') // matrix says N; implied by com.boqs R
    expect(accessFor(bid, 'com.masters').level).toBe('R')
    expect(accessFor(bid, 'com.approvalMatrix').level).toBe('N') // not implied
    expect(allows(accessFor(bid, 'com.skus'), 'sku.other')).toBe(false)
  })
  it('a role with no BOQ read gets no implied reads', () => {
    expect(accessFor(user(['legal']), 'com.skus').level).toBe('N')
  })
})
