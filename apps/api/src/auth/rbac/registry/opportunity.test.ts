import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { pool } from '../../../db.js'
import {
  addSalesPerson, addTeamMember, assignOwner, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail, setRole,
} from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { opportunityPolicy } from './opportunity.js'

/** True when RBAC would refuse `path` for `label`. */
async function denied(label: string, path: string, raw?: unknown): Promise<boolean> {
  return (await decide(path, raw, await loadUserFacts(rbacEmail(label)))).denial !== null
}
async function why(label: string, path: string, raw?: unknown): Promise<string | undefined> {
  return (await decide(path, raw, await loadUserFacts(rbacEmail(label)))).denial?.message
}

let salesId: string, rivalId: string
let own: { bidId: string | null; opportunityId: string }      // Bid Tracker, owned by `sales`, assigned to `pre` and `legal`
let pipe: { bidId: string | null; opportunityId: string }     // Pipeline, owned by `sales`
let other: { bidId: string | null; opportunityId: string }    // Bid Tracker, owned by someone else

beforeEach(async () => {
  await cleanupRbacFixtures()
  salesId = await addSalesPerson('sales')       // derives Sales from the roster
  rivalId = await addSalesPerson('rival')
  for (const role of ['bid', 'cxo', 'delivery', 'it', 'finance'] as const) await setRole(role, role)
  const pre = await addTeamMember('preSales', 'pre'); await setRole('pre', 'presales')
  const legal = await addTeamMember('legal', 'legal'); await setRole('legal', 'legal')
  await setRole('prefree', 'presales')           // Pre-sales with no roster slot: never "assigned"
  own = await makeBid({ geoSalesPersonId: salesId, preSalesPersonId: pre, legalPersonId: legal })
  pipe = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: salesId })
  other = await makeBid({ geoSalesPersonId: rivalId })
})
afterEach(cleanupRbacFixtures)

describe('registry coverage for this area', () => {
  it('registers exactly the 63 opportunity / bid procedures', () => {
    expect(Object.keys(opportunityPolicy).sort()).toEqual([
      'bidCorrigenda.create', 'bidCorrigenda.listForBid', 'bidCorrigenda.reviewChange',
      'bidCustomFields.archive', 'bidCustomFields.create', 'bidCustomFields.delete', 'bidCustomFields.list', 'bidCustomFields.reorder',
      'bidCustomFields.setValue', 'bidCustomFields.unarchive', 'bidCustomFields.update', 'bidCustomFields.valuesForBid',
      'bidMilestones.create', 'bidMilestones.delete', 'bidMilestones.listAll', 'bidMilestones.listForBid', 'bidMilestones.update',
      'bidSavedViews.create', 'bidSavedViews.delete', 'bidSavedViews.get', 'bidSavedViews.list', 'bidSavedViews.update',
      'bids.actionQueue.list', 'bids.archive', 'bids.create', 'bids.delete', 'bids.get', 'bids.getForOpportunity', 'bids.listForGrid',
      'bids.markVerified', 'bids.unarchive', 'bids.update',
      'documents.citations.create', 'documents.citations.delete', 'documents.citations.list', 'documents.confirmUpload', 'documents.delete',
      'documents.getDownloadUrl', 'documents.listFor', 'documents.requestUploadUrl',
      'followUps.create', 'followUps.delete', 'followUps.listForEntity', 'followUps.listOpen', 'followUps.setStatus',
      'opportunities.create', 'opportunities.delete', 'opportunities.get', 'opportunities.list', 'opportunities.listByDepartment',
      'opportunities.listStageChanges', 'opportunities.update',
      'ownership.assign', 'ownership.end', 'ownership.listAssignments', 'ownership.listFor', 'ownership.listOwnedBy',
      'ownership.resolveOwner', 'ownership.resolveOwners', 'ownership.transferBookOfBusiness',
      'protectedValues.freeze', 'protectedValues.listFor', 'protectedValues.unfreeze',
    ].sort())
  })
})

describe('reads', () => {
  it('every role with a role can read rows; a user with no role cannot', async () => {
    for (const label of ['sales', 'bid', 'cxo', 'delivery', 'it', 'finance', 'pre', 'legal']) expect(await denied(label, 'bids.listForGrid')).toBe(false)
    expect(await denied('nobody', 'bids.listForGrid')).toBe(true)
    expect(await denied('nobody', 'opportunities.list')).toBe(true)
  })
})

describe('bids.update — field level, scope and sheet moves', () => {
  it('Sales (S1) may not change stage or decision, even on an own row', async () => {
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(true)
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { decision: 'go' } })).toBe(true)
  })
  it('Bid (W) may change the stage; CXO may record only the Go/No-Go decision', async () => {
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(false)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { decision: 'no_go' } })).toBe(false)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification' } })).toBe(true)
    expect(await denied('cxo', 'bids.update', { id: own.bidId, patch: { decision: 'no_go', stageKey: 'qualification' } })).toBe(true)
  })
  it('denies a patch that carries a key with no atom instead of ignoring it (Review Focus 2)', async () => {
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { stageKey: 'qualification', typo: 1 } })).toBe(true)
    expect(await why('bid', 'bids.update', { id: own.bidId, patch: { typo: 1 } })).toMatch(/cannot be edited/)
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: 'nonsense' })).toBe(true)
  })
  it('moving a row needs write on BOTH sheets, so a single role cannot move between Bid Tracker and Pipeline', async () => {
    // Sales: W·own on Pipeline and Campaign (own row) — a Pipeline → Campaign move is fine
    expect(await denied('sales', 'bids.update', { id: pipe.bidId, patch: { sheet: 'campaign' } })).toBe(false)
    // …but Bid Tracker is only Partial for Sales, so the source side refuses a move out of it
    expect(await denied('sales', 'bids.update', { id: own.bidId, patch: { sheet: 'pipeline-funnel' } })).toBe(true)
    // Bid is W on Bid Tracker only; the destination refuses
    expect(await denied('bid', 'bids.update', { id: own.bidId, patch: { sheet: 'campaign' } })).toBe(true)
  })
  it('a user holding BOTH Sales and Bid roles can move their own Pipeline row into Bid Tracker', async () => {
    const dual = await addSalesPerson('dual'); await setRole('dual', 'bid')
    const row = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: dual })
    expect(await denied('dual', 'bids.update', { id: row.bidId, patch: { sheet: 'bidTracker' } })).toBe(false)
  })
})

describe('opportunities.update — scope', () => {
  it('Sales is full-write on its own Pipeline rows only', async () => {
    expect(await denied('sales', 'opportunities.update', { id: pipe.opportunityId, patch: { valueAmount: '5', vertical: 'IT' } })).toBe(false)
    const rivalPipe = await makeBid({ sheet: 'pipeline-funnel', geoSalesPersonId: rivalId })
    expect(await denied('sales', 'opportunities.update', { id: rivalPipe.opportunityId, patch: { valueAmount: '5' } })).toBe(true)
  })
  it('on Bid Tracker rows Sales gets S1 only: client/value yes, identity and Tender ID no', async () => {
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { city: 'Pune', valueAmount: '9' } })).toBe(false)
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { opportunityName: 'x' } })).toBe(true)
    expect(await denied('sales', 'opportunities.update', { id: own.opportunityId, patch: { gemTenderId: 'x' } })).toBe(true)
    expect(await denied('sales', 'opportunities.update', { id: other.opportunityId, patch: { city: 'Pune' } })).toBe(true)
  })
  it('assigned Pre-sales and Legal cannot edit opportunity data (P1 / L1 hold only the next action and custom fields)', async () => {
    expect(await denied('pre', 'opportunities.update', { id: own.opportunityId, patch: { valueAmount: '1' } })).toBe(true)
    expect(await denied('legal', 'opportunities.update', { id: own.opportunityId, patch: { city: 'x' } })).toBe(true)
  })
  it('ignores the echoed opportunityCode', async () => {
    expect(await denied('bid', 'opportunities.update', { id: own.opportunityId, patch: { opportunityCode: 'OPP-1', city: 'Pune' } })).toBe(false)
  })
  it('a Sales role with no roster row is read-only everywhere, with a clear message (Review Focus 3)', async () => {
    await setRole('norow', 'sales')
    expect(await denied('norow', 'bids.listForGrid')).toBe(false)
    expect(await why('norow', 'opportunities.update', { id: pipe.opportunityId, patch: { valueAmount: '5' } })).toMatch(/permission to edit Pipeline rows/)
  })
  it('a creator is "own" (gap A1)', async () => {
    await setRole('maker', 'sales')
    const made = await makeBid({ sheet: 'pipeline-funnel', createdBy: rbacEmail('maker') })
    expect(await denied('maker', 'opportunities.update', { id: made.opportunityId, patch: { valueAmount: '5' } })).toBe(false)
  })
})

describe('create / delete', () => {
  it('Sales and Bid may create bids; Legal may not', async () => {
    const raw = { newOpportunity: { opportunityName: 'x' }, department: { mode: 'existing', departmentId: randomUUID() } }
    expect(await denied('sales', 'bids.create', raw)).toBe(false)
    expect(await denied('bid', 'bids.create', raw)).toBe(false)
    expect(await denied('legal', 'bids.create', raw)).toBe(true)
  })
  it('creating a bid that also creates a department needs create on Customer Departments too (cross-module)', async () => {
    const raw = { newOpportunity: { opportunityName: 'x' }, department: { mode: 'create', name: 'D', parent: { mode: 'create', name: 'P', stateCode: 24 } } }
    expect(await denied('bid', 'bids.create', raw)).toBe(true)
    expect(await denied('sales', 'bids.create', raw)).toBe(false)
  })
  it('creating onto the Campaign sheet is judged on Campaign', async () => {
    expect(await denied('sales', 'bids.create', { newOpportunity: { opportunityName: 'x' }, sheet: 'campaign', department: { mode: 'existing', departmentId: randomUUID() } })).toBe(false)
    expect(await denied('bid', 'bids.create', { sheet: 'campaign', opportunityId: randomUUID() })).toBe(true)
  })
  it('only Bid may delete a bid or an opportunity', async () => {
    expect(await denied('bid', 'bids.delete', { id: other.bidId })).toBe(false)
    expect(await denied('sales', 'bids.delete', { id: own.bidId })).toBe(true)
    expect(await denied('sales', 'opportunities.delete', { id: own.opportunityId })).toBe(true)
  })
  it('archive, unarchive and verify are W-only atoms', async () => {
    expect(await denied('bid', 'bids.archive', { id: own.bidId })).toBe(false)
    expect(await denied('sales', 'bids.archive', { id: own.bidId })).toBe(true)
    expect(await denied('sales', 'bids.markVerified', { id: own.bidId })).toBe(true)
    expect(await denied('bid', 'bids.markVerified', { id: own.bidId })).toBe(false)
  })
})

describe('milestones and corrigenda (cross-module)', () => {
  async function submissionMilestone(bidId: string) {
    return (await pool.query(
      `INSERT INTO bid_milestones (bid_id, milestone_type, key, label, source) VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline','manual') RETURNING id`, [bidId],
    )).rows[0].id as string
  }
  it('only Bid edits milestones', async () => {
    const id = await submissionMilestone(own.bidId!)
    expect(await denied('bid', 'bidMilestones.update', { id, patch: { label: 'x' } })).toBe(false)
    expect(await denied('sales', 'bidMilestones.update', { id, patch: { label: 'x' } })).toBe(true)
  })
  it('moving the Submission Deadline of a bid on another sheet also needs opp.dates there', async () => {
    const onTracker = await submissionMilestone(own.bidId!)
    const onPipeline = await submissionMilestone(pipe.bidId!)
    expect(await denied('bid', 'bidMilestones.update', { id: onTracker, patch: { dueAt: '2030-01-01' } })).toBe(false)
    expect(await denied('bid', 'bidMilestones.update', { id: onPipeline, patch: { dueAt: '2030-01-01' } })).toBe(true) // Bid is only R on Pipeline
    expect(await denied('bid', 'bidMilestones.update', { id: onPipeline, patch: { label: 'x' } })).toBe(false)        // a label edit touches no opportunity field
  })
  it('Legal can reject a corrigendum change but cannot accept one that rewrites the tender link', async () => {
    const off = appRouter.createCaller({}) // RBAC is off in tests unless a test turns it on
    await off.bidCorrigenda.create({ bidId: own.bidId!, corrigendumNumber: 1, changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://example.com' }] })
    const changeId = (await off.bidCorrigenda.listForBid({ bidId: own.bidId! }))[0].changes[0].id
    expect(await denied('legal', 'bidCorrigenda.reviewChange', { changeId, decision: 'rejected' })).toBe(false)
    expect(await denied('legal', 'bidCorrigenda.reviewChange', { changeId, decision: 'accepted' })).toBe(true)
    expect(await denied('bid', 'bidCorrigenda.reviewChange', { changeId, decision: 'accepted' })).toBe(false)
    expect(await denied('sales', 'bidCorrigenda.reviewChange', { changeId, decision: 'rejected' })).toBe(true)
  })
})

describe('ownership', () => {
  const assign = (entityType: string, entityId: string | null, role?: string) =>
    ({ entityType, entityId, salesPersonId: randomUUID(), role, startDate: '2026-01-01' })

  it('Solution Lead is read-only for EVERY ordinary role, including W roles — only System Admin can write it', async () => {
    for (const label of ['cxo', 'sales', 'bid', 'it', 'finance', 'delivery', 'pre', 'legal']) {
      expect(await denied(label, 'ownership.assign', assign('bid', own.bidId, 'solutionLead'))).toBe(true)
    }
    await assignOwner('bid', own.bidId!, salesId, 'solutionLead')
    const { id } = (await pool.query(`SELECT id FROM ownership_assignments WHERE entity_id=$1 AND role='solutionLead'`, [own.bidId])).rows[0]
    expect(await denied('cxo', 'ownership.end', { id, endDate: '2026-06-01' })).toBe(true)
    makeSystemAdmin('root')
    expect(await denied('root', 'ownership.assign', assign('bid', own.bidId, 'solutionLead'))).toBe(false)
    expect(await denied('root', 'ownership.assign', assign('bid', other.bidId, 'solutionLead'))).toBe(false)
    expect(await denied('root', 'ownership.end', { id, endDate: '2026-06-01' })).toBe(false)
  })
  it('Bid may assign the bid-level owner, but not an opportunity owner and not a delegate', async () => {
    expect(await denied('bid', 'ownership.assign', assign('bid', own.bidId))).toBe(false)
    expect(await denied('bid', 'ownership.assign', assign('opportunity', own.opportunityId))).toBe(true)
    expect(await denied('bid', 'ownership.assign', assign('bid', own.bidId, 'delegate'))).toBe(true)
  })
  it('Sales may reassign only entities it owns; CXO any', async () => {
    expect(await denied('sales', 'ownership.assign', assign('bid', own.bidId))).toBe(false)
    expect(await denied('sales', 'ownership.assign', assign('bid', other.bidId))).toBe(true)
    expect(await denied('cxo', 'ownership.assign', assign('bid', other.bidId))).toBe(false)
  })
  it('a book-of-business transfer is Sales-only from oneself; CXO from anyone', async () => {
    const t = (from: string) => ({ fromSalesPersonId: from, toSalesPersonId: randomUUID(), effectiveDate: '2026-06-01' })
    expect(await denied('sales', 'ownership.transferBookOfBusiness', t(salesId))).toBe(false)
    expect(await denied('sales', 'ownership.transferBookOfBusiness', t(rivalId))).toBe(true)
    expect(await denied('cxo', 'ownership.transferBookOfBusiness', t(rivalId))).toBe(false)
  })
  it('resolved owners are readable by anyone who can read rows, contacts or departments (gap A4)', async () => {
    expect(await denied('legal', 'ownership.resolveOwners', {})).toBe(false)  // Legal is N on the ownership module itself
    expect(await denied('legal', 'ownership.listAssignments')).toBe(true)
  })
})

describe('follow-ups, documents, protected values, columns, saved views', () => {
  it('bid next actions follow the row: assigned Pre-sales and Legal may, an unassigned Pre-sales may not', async () => {
    const raw = { entityType: 'bid', entityId: own.bidId, dueDate: '2030-01-01' }
    expect(await denied('pre', 'followUps.create', raw)).toBe(false)
    expect(await denied('legal', 'followUps.create', raw)).toBe(false)
    expect(await denied('prefree', 'followUps.create', raw)).toBe(true)
    expect(await denied('delivery', 'followUps.create', raw)).toBe(true)
    expect(await denied('bid', 'followUps.create', raw)).toBe(false)
  })
  it('contact follow-ups belong to Account Mapping: Sales may create, Legal may not', async () => {
    const raw = { entityType: 'contact', entityId: randomUUID(), dueDate: '2030-01-01' }
    expect(await denied('sales', 'followUps.create', raw)).toBe(false)
    expect(await denied('legal', 'followUps.create', raw)).toBe(true)
  })
  it('documents attach to bids only, and Pre-sales/Legal may upload only to rows they are assigned to', async () => {
    const upload = (entityType: string) => ({ entityType, entityId: own.bidId, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 })
    expect(await denied('bid', 'documents.requestUploadUrl', upload('widget'))).toBe(true)
    expect(await why('bid', 'documents.requestUploadUrl', upload('widget'))).toMatch(/bids/)
    expect(await denied('pre', 'documents.requestUploadUrl', upload('bid'))).toBe(false)
    expect(await denied('legal', 'documents.requestUploadUrl', upload('bid'))).toBe(false)
    expect(await denied('prefree', 'documents.requestUploadUrl', upload('bid'))).toBe(true)
    expect(await denied('it', 'documents.requestUploadUrl', upload('bid'))).toBe(true)
    expect(await denied('it', 'documents.listFor', { entityType: 'bid', entityId: own.bidId })).toBe(true) // IT is None on Tender documents
    expect(await denied('confirm-unknown', 'documents.confirmUpload', { uploadId: 'nope' })).toBe(true)
  })
  it('protected values: Bid freezes and unfreezes, everyone else reads; only bids have them', async () => {
    expect(await denied('bid', 'protectedValues.freeze', { entityType: 'bid', entityId: own.bidId, fieldKey: 'x' })).toBe(false)
    expect(await denied('sales', 'protectedValues.freeze', { entityType: 'bid', entityId: own.bidId, fieldKey: 'x' })).toBe(true)
    expect(await denied('bid', 'protectedValues.unfreeze', { entityType: 'opportunity', entityId: own.opportunityId, fieldKey: 'x', reason: 'r' })).toBe(true)
    expect(await denied('delivery', 'protectedValues.listFor', { entityType: 'bid', entityId: own.bidId })).toBe(false)
  })
  it('custom columns: Bid and IT manage the schema; values ride on the row (S1 / P1 / L1 hold bid.custom)', async () => {
    expect(await denied('bid', 'bidCustomFields.create', {})).toBe(false)
    expect(await denied('it', 'bidCustomFields.create', {})).toBe(false)
    expect(await denied('sales', 'bidCustomFields.create', {})).toBe(true)
    const v = (bidId: string | null) => ({ bidId, fieldId: randomUUID(), value: 'x' })
    expect(await denied('sales', 'bidCustomFields.setValue', v(own.bidId))).toBe(false)
    expect(await denied('sales', 'bidCustomFields.setValue', v(other.bidId))).toBe(true)
    expect(await denied('pre', 'bidCustomFields.setValue', v(own.bidId))).toBe(false)
    expect(await denied('cxo', 'bidCustomFields.setValue', v(own.bidId))).toBe(true)
  })
  it('saved views: personal for anyone who can read rows, global only for those who manage columns (gap A3)', async () => {
    expect(await denied('legal', 'bidSavedViews.create', { name: 'v', scope: 'personal' })).toBe(false)
    expect(await denied('legal', 'bidSavedViews.create', { name: 'v', scope: 'global' })).toBe(true)
    expect(await denied('bid', 'bidSavedViews.create', { name: 'v', scope: 'global' })).toBe(false)
    expect(await denied('legal', 'bidSavedViews.update', { id: 'allBids', patch: { name: 'x' } })).toBe(false) // system views: the handler refuses
    expect(await denied('legal', 'bidSavedViews.update', { id: randomUUID(), patch: { scope: 'global' } })).toBe(true)
  })
})
