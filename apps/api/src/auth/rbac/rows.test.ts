import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import {
  addSalesPerson, addTeamMember, assignOwner, cleanupRbacFixtures, makeBid,
} from '../../testHelpers/rbacFixtures.js'
import {
  domainOfNode, isUuid, rowForBid, rowForFollowUp, rowForOpportunity, rowForOwnedEntity, rowForSalesPerson, savedViewScope, sheetModule,
} from './rows.js'

beforeEach(cleanupRbacFixtures)
afterEach(cleanupRbacFixtures)

describe('sheet → module', () => {
  it('maps every owned sheet, defaulting an unknown or missing one to Bid Tracker', () => {
    expect(sheetModule('bidTracker')).toBe('opp.bidTracker')
    for (const s of ['pipeline-funnel', 'pipeline-backup', 'pipeline-commits']) expect(sheetModule(s)).toBe('opp.pipeline')
    expect(sheetModule('campaign')).toBe('opp.campaign')
    expect(sheetModule(undefined)).toBe('opp.bidTracker')
    expect(sheetModule('nonsense')).toBe('opp.bidTracker')
  })
})

describe('rowForBid', () => {
  it('returns null for garbage and for a missing id, without letting Postgres see a bad uuid', async () => {
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(await rowForBid('not-a-uuid')).toBeNull()
    expect(await rowForBid(undefined)).toBeNull()
    expect(await rowForBid('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
  it('reports the sheet module, the team slots and a lower-cased creator', async () => {
    const pre = await addTeamMember('preSales', 'a')
    const { bidId, opportunityId } = await makeBid({ sheet: 'pipeline-backup', createdBy: 'RBAC-Maker@Amnex.com', preSalesPersonId: pre })
    const row = (await rowForBid(bidId))!
    expect(row).toMatchObject({ module: 'opp.pipeline', bidId, opportunityId })
    expect(row.facts.createdBy).toBe('rbac-maker@amnex.com')
    expect(row.facts.assigned).toEqual({ presales: pre, legal: null, bid: null })
  })
  it('collects Geo/BU people, the bid-level owner and a solution lead as "own" — the opportunity owner is shadowed by a bid-level owner', async () => {
    const [geo, bu, bidOwner, oppOwner, lead] = await Promise.all(['geo', 'bu', 'bo', 'oo', 'sl'].map((l) => addSalesPerson(l)))
    const { bidId, opportunityId } = await makeBid({ geoSalesPersonId: geo, buSalesPersonId: bu })
    await assignOwner('bid', bidId!, bidOwner)
    await assignOwner('opportunity', opportunityId, oppOwner)
    await assignOwner('bid', bidId!, lead, 'solutionLead')
    const owners = (await rowForBid(bidId))!.facts.salesOwnerIds
    for (const id of [geo, bu, bidOwner, lead]) expect(owners).toContain(id)
    expect(owners).not.toContain(oppOwner)
  })
  it('inherits the opportunity owner when the bid has none of its own', async () => {
    const owner = await addSalesPerson('oo')
    const { bidId, opportunityId } = await makeBid()
    await assignOwner('opportunity', opportunityId, owner)
    expect((await rowForBid(bidId))!.facts.salesOwnerIds).toContain(owner)
  })
  it('counts an active delegate as own', async () => {
    const delegate = await addSalesPerson('dg')
    const { bidId } = await makeBid()
    await assignOwner('bid', bidId!, delegate, 'delegate')
    expect((await rowForBid(bidId))!.facts.salesOwnerIds).toContain(delegate)
  })
})

describe('rowForOpportunity', () => {
  it('treats a bid-less opportunity as the Bid Tracker sheet', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    expect(await rowForOpportunity(opportunityId)).toMatchObject({ module: 'opp.bidTracker', bidId: null })
  })
})

describe('other row kinds', () => {
  it('a Sales Team row is "own" for exactly that person', async () => {
    const id = await addSalesPerson('r')
    expect(await rowForSalesPerson(id)).toEqual({ salesOwnerIds: [id], createdBy: null, assigned: { presales: null, legal: null, bid: null } })
    expect(await rowForSalesPerson('nope')).toBeNull()
  })
  it('rowForOwnedEntity resolves bid and opportunity, and refuses unknown entity types', async () => {
    const { bidId, opportunityId } = await makeBid({ createdBy: 'rbac-x@amnex.com' })
    expect((await rowForOwnedEntity('bid', bidId))!.createdBy).toBe('rbac-x@amnex.com')
    expect((await rowForOwnedEntity('opportunity', opportunityId))!.createdBy).toBe('rbac-x@amnex.com')
    expect(await rowForOwnedEntity('widget', bidId)).toBeNull()
  })
  it('a contact follow-up with a creator carries only the creator; the assignee counts only on a legacy row (spec §9.1)', async () => {
    const assignee = await addSalesPerson('as')
    const emp = await pool.query(`SELECT id FROM employees LIMIT 1`)
    if (!emp.rows[0]) return // no seed data locally: nothing to attach a contact follow-up to
    const fu = await pool.query(
      `INSERT INTO follow_ups (entity_type, entity_id, assignee_id, due_date, status, note, created_by)
       VALUES ('contact', $1, $2, '2999-01-01', 'open', '', 'rbac-c@amnex.com') RETURNING id`, [emp.rows[0].id, assignee],
    )
    const row = (await rowForFollowUp(fu.rows[0].id))!
    expect(row.entityType).toBe('contact')
    expect(row.facts.createdBy).toBe('rbac-c@amnex.com')
    expect(row.facts.salesOwnerIds).not.toContain(assignee)
    await pool.query(`UPDATE follow_ups SET created_by = NULL WHERE id = $1`, [fu.rows[0].id])
    const legacy = (await rowForFollowUp(fu.rows[0].id))!
    expect(legacy.facts.createdBy).toBeNull()
    expect(legacy.facts.salesOwnerIds).toContain(assignee)
  })
})

describe('small lookups', () => {
  it('report null when the row is absent or the id is not a uuid', async () => {
    expect(await savedViewScope('00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await domainOfNode('00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await domainOfNode('garbage')).toBeNull()
  })
})
