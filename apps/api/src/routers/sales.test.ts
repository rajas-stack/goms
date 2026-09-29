import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

describe('sales router', () => {
  beforeEach(async () => {
    // commercial_boqs.sales_person_id FKs (RESTRICT) into sales_persons —
    // clear dependents first so this file's cleanup doesn't conflict with
    // rows left behind by commercial-boq.test.ts (Phase 6). commercial_masters
    // and hierarchy_nodes (2026-08-26 hardening pass, this file's own BOQ
    // reference test) are cleared for the same cross-file-leftover reason.
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    // employees.org_node_id and opportunities.department_id also RESTRICT
    // into hierarchy_nodes — clear them first, same reasoning as
    // hierarchy.test.ts's own beforeEach.
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
  })

  async function makePerson(overrides: Partial<{ name: string; officialEmail: string; tierKey: string; designation: string; managerId: string | null }> = {}) {
    const caller = appRouter.createCaller({})
    return caller.sales.create({
      name: overrides.name ?? 'Alex Sales', officialEmail: overrides.officialEmail ?? `alex-${Math.random()}@example.com`,
      designation: overrides.designation ?? 'Account Manager', tierKey: overrides.tierKey ?? 'accountManager',
      managerId: overrides.managerId,
    })
  }

  it('creates a sales person with an initial posting', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson({ name: 'Alex Sales' })
    expect(person.name).toBe('Alex Sales')
    expect(person.status).toBe('active')
    const postings = await caller.sales.listPostings({ salesPersonId: person.id })
    expect(postings).toHaveLength(1)
    expect(postings[0].changeType).toBe('initial')
    expect(postings[0].endDate).toBeNull()
  })

  it('rejects a duplicate officialEmail', async () => {
    await makePerson({ officialEmail: 'dup@example.com' })
    await expect(makePerson({ officialEmail: 'dup@example.com' })).rejects.toThrow('already exists')
  })

  it('gets a person by id, and null for a missing one', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    expect((await caller.sales.getPerson({ id: person.id }))?.name).toBe('Alex Sales')
    expect(await caller.sales.getPerson({ id: '00000000-0000-0000-0000-000000000000' })).toBeNull()
  })

  it('derives changeType as promotion when moving to a lower-rank (more senior) tier', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson({ tierKey: 'accountManager' })
    const posting = await caller.sales.transfer({
      salesPersonId: person.id, designation: 'Regional Manager', tierKey: 'rm', effectiveDate: '2099-01-01',
    })
    expect(posting.changeType).toBe('promotion')
  })

  it('derives changeType as demotion when moving to a higher-rank (less senior) tier', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson({ tierKey: 'rm' })
    const posting = await caller.sales.transfer({
      salesPersonId: person.id, designation: 'Account Manager', tierKey: 'accountManager', effectiveDate: '2099-01-01',
    })
    expect(posting.changeType).toBe('demotion')
  })

  it('closes the prior posting and keeps exactly one current posting', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson({ tierKey: 'accountManager' })
    const [initial] = await caller.sales.listPostings({ salesPersonId: person.id })
    await caller.sales.transfer({ salesPersonId: person.id, designation: 'RM', tierKey: 'rm', effectiveDate: '2099-01-01' })
    const postings = await caller.sales.listPostings({ salesPersonId: person.id })
    expect(postings).toHaveLength(2)
    const closed = postings.find((p) => p.id === initial.id)
    expect(closed?.endDate).toBe('2099-01-01')
    expect(postings.filter((p) => p.endDate === null)).toHaveLength(1)
  })

  it('rejects a transfer effective on or before the current posting\'s own start date', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson({ tierKey: 'accountManager' })
    const [initial] = await caller.sales.listPostings({ salesPersonId: person.id })
    await expect(caller.sales.transfer({
      salesPersonId: person.id, designation: 'RM', tierKey: 'rm', effectiveDate: initial.startDate,
    })).rejects.toThrow()
  })

  it('reports currentPostings keyed by salesPersonId, one row per person', async () => {
    const caller = appRouter.createCaller({})
    const a = await makePerson({ name: 'A' })
    const b = await makePerson({ name: 'B' })
    const current = await caller.sales.currentPostings()
    expect(current[a.id]).toBeDefined()
    expect(current[b.id]).toBeDefined()
  })

  it('updates a sales person', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    const updated = await caller.sales.update({ id: person.id, patch: { notes: 'VIP account' } })
    expect(updated!.notes).toBe('VIP account')
  })

  it('creates a sales person with a photoUrl and defaults to null when omitted', async () => {
    const caller = appRouter.createCaller({})
    const withPhoto = await caller.sales.create({
      name: 'Priya Photo', officialEmail: `priya-${Math.random()}@example.com`,
      designation: 'Account Manager', tierKey: 'accountManager', photoUrl: 'data:image/png;base64,AAA=',
    })
    expect(withPhoto.photoUrl).toBe('data:image/png;base64,AAA=')
    const withoutPhoto = await makePerson({ name: 'No Photo' })
    expect(withoutPhoto.photoUrl).toBeNull()
  })

  it('sets and clears a photoUrl via update', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    const withPhoto = await caller.sales.update({ id: person.id, patch: { photoUrl: 'data:image/png;base64,BBB=' } })
    expect(withPhoto!.photoUrl).toBe('data:image/png;base64,BBB=')
    const cleared = await caller.sales.update({ id: person.id, patch: { photoUrl: null } })
    expect(cleared!.photoUrl).toBeNull()
  })

  it('sets status without touching postings', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    await caller.sales.setStatus({ id: person.id, status: 'resigned' })
    expect((await caller.sales.getPerson({ id: person.id }))?.status).toBe('resigned')
  })

  it('deletes a sales person and its postings', async () => {
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    await caller.sales.delete({ id: person.id })
    expect(await caller.sales.getPerson({ id: person.id })).toBeNull()
    expect(await caller.sales.listPostings({ salesPersonId: person.id })).toHaveLength(0)
  })

  it('nulls out manager_id on postings that pointed at a deleted manager', async () => {
    const caller = appRouter.createCaller({})
    const manager = await makePerson({ name: 'Manager' })
    const report = await makePerson({ name: 'Report', managerId: manager.id })
    await caller.sales.delete({ id: manager.id })
    const [posting] = await caller.sales.listPostings({ salesPersonId: report.id })
    expect(posting.managerId).toBeNull()
  })

  // 2026-08-26 backend hardening pass.
  it('gives a friendly CONFLICT (not a raw error) when deleting a sales person still referenced by a BOQ', async () => {
    // commercial_boqs.sales_person_id is ON DELETE RESTRICT — unlike
    // sales_postings/ownership_assignments (both CASCADE), this isn't
    // pre-checked before the DELETE, so it previously surfaced as a raw,
    // unhandled 23503 instead of a friendly message.
    const caller = appRouter.createCaller({})
    const person = await makePerson()
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    // Randomized code — this file's beforeEach doesn't clear commercial_masters
    // (it's not otherwise this file's concern), so a fixed code risks
    // colliding with rows left behind by another test file in the same run.
    const vertical = await caller.commercial.masters.create({ key: 'verticals', input: { code: `GOV-${Math.random()}`, name: 'Government', description: '' } })
    await caller.commercial.boq.create({
      opportunityName: `Deal ${Math.random()}`, departmentId: dept.id, customerName: 'Acme', customerOrganization: '',
      customerAddress: '', customerContact: '', verticalId: vertical.id,
      budgetAmount: '', budgetUnit: '', budgetKnown: 'yes', emdAmount: '', emdUnit: '',
      salesPersonId: person.id, buSalesPersonId: null, preSalesId: null, currency: 'INR',
    })
    await expect(caller.sales.delete({ id: person.id })).rejects.toThrow(/still referenced by at least one boq/i)
  })

  describe('updatePostingManager', () => {
    it('updates manager_id on the open posting, leaving other fields untouched', async () => {
      const caller = appRouter.createCaller({})
      const manager = await makePerson({ name: 'Manager' })
      const newManager = await makePerson({ name: 'New Manager' })
      const person = await makePerson({ name: 'Report', managerId: manager.id, tierKey: 'accountManager', designation: 'Account Manager' })
      const [before] = await caller.sales.listPostings({ salesPersonId: person.id })
      const updated = await caller.sales.updatePostingManager({ personId: person.id, managerId: newManager.id })
      expect(updated.managerId).toBe(newManager.id)
      expect(updated.id).toBe(before.id)
      expect(updated.startDate).toBe(before.startDate)
      expect(updated.endDate).toBeNull()
      expect(updated.designation).toBe(before.designation)
      expect(updated.tierKey).toBe(before.tierKey)
      expect(updated.changeType).toBe(before.changeType)
    })

    it('accepts managerId: null to remove a manager', async () => {
      const caller = appRouter.createCaller({})
      const manager = await makePerson({ name: 'Manager' })
      const person = await makePerson({ name: 'Report', managerId: manager.id })
      const updated = await caller.sales.updatePostingManager({ personId: person.id, managerId: null })
      expect(updated.managerId).toBeNull()
    })

    it('throws BAD_REQUEST when the person has no open posting', async () => {
      const caller = appRouter.createCaller({})
      const person = await makePerson()
      await caller.sales.delete({ id: person.id }) // deletes the person and cascades its postings
      await expect(caller.sales.updatePostingManager({ personId: person.id, managerId: null })).rejects.toThrow(/no open posting/i)
    })

    // Item 1: gmOverrideId is independently settable — a change to one field
    // must never disturb the other on the same open posting.
    it('sets gm_override_id without touching manager_id when only gmOverrideId is passed', async () => {
      const caller = appRouter.createCaller({})
      const manager = await makePerson({ name: 'Manager' })
      const gm = await makePerson({ name: 'GM' })
      const person = await makePerson({ name: 'Report', managerId: manager.id })
      const updated = await caller.sales.updatePostingManager({ personId: person.id, gmOverrideId: gm.id })
      expect(updated.gmOverrideId).toBe(gm.id)
      expect(updated.managerId).toBe(manager.id)
    })

    it('accepts gmOverrideId: null to revert to auto-derivation', async () => {
      const caller = appRouter.createCaller({})
      const gm = await makePerson({ name: 'GM' })
      const person = await makePerson({ name: 'Report' })
      await caller.sales.updatePostingManager({ personId: person.id, gmOverrideId: gm.id })
      const updated = await caller.sales.updatePostingManager({ personId: person.id, gmOverrideId: null })
      expect(updated.gmOverrideId).toBeNull()
    })

    it('throws BAD_REQUEST when neither managerId nor gmOverrideId is provided', async () => {
      const caller = appRouter.createCaller({})
      const person = await makePerson()
      await expect(caller.sales.updatePostingManager({ personId: person.id })).rejects.toThrow(/nothing to update/i)
    })
  })

  describe('auth enforcement', () => {
    afterEach(() => {
      delete process.env.AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated caller when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.sales.create({
        name: 'Alex Sales', officialEmail: `alex-${Math.random()}@example.com`,
        designation: 'Account Manager', tierKey: 'accountManager',
      })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated mutation once enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.sales.create({
        name: 'Alex Sales', officialEmail: `alex-${Math.random()}@example.com`,
        designation: 'Account Manager', tierKey: 'accountManager',
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('still allows reads with no auth even when enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.sales.listPersons()).resolves.toBeDefined()
    })

    it('allows the same mutation once enforcement is on, for a verified @amnex.com caller', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.sales.create({
        name: 'Alex Sales', officialEmail: `alex-${Math.random()}@example.com`,
        designation: 'Account Manager', tierKey: 'accountManager',
      })).resolves.toBeDefined()
    })
  })

  describe('read protection (READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    afterEach(() => {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated read when the flag is unset (deliberate no-op default)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.sales.listPersons()).resolves.toBeDefined()
    })

    it('rejects an unauthenticated read once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.sales.listPersons()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a non-Amnex identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@gmail.com'))
      await expect(caller.sales.listPersons()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a verified @amnex.com identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.sales.listPersons()).resolves.toBeDefined()
    })
  })
})
