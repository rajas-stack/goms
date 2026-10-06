import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '../../db.js'
import { addOrgPerson, addSalesPerson, addTeamMember, cleanupRbacFixtures, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { clearUserFactsCache, loadUserFacts, normalizeEmail } from './userFacts.js'

beforeEach(cleanupRbacFixtures)
afterEach(async () => { delete process.env.ADMIN_ALLOWED_EMAILS; vi.restoreAllMocks(); await cleanupRbacFixtures() })

describe('derived roles', () => {
  it.each([
    ['Pre-Sales', 'presales'], ['Bid Management', 'bid'], ['Legal', 'legal'], ['Leadership', 'cxo'],
  ])('%s -> %s', async (department, role) => {
    await addOrgPerson('p', [department])
    expect((await loadUserFacts(rbacEmail('p'))).roles).toEqual([role])
  })

  it('does NOT derive anything from Business Units, Technology or Finance (decisions 2 and 7)', async () => {
    await addOrgPerson('bu', ['Business Units'])
    await addOrgPerson('tech', ['Technology'])
    await addOrgPerson('fin', ['Finance'])
    for (const label of ['bu', 'tech', 'fin']) expect((await loadUserFacts(rbacEmail(label))).roles).toEqual([])
  })

  it('a person in several departments gets several roles (the CFO: Finance + Legal -> legal until overridden)', async () => {
    await addOrgPerson('cfo', ['Finance', 'Legal'])
    expect((await loadUserFacts(rbacEmail('cfo'))).roles).toEqual(['legal'])
    await setRole('cfo', 'cxo')
    await setRole('cfo', 'finance')
    expect((await loadUserFacts(rbacEmail('cfo'))).roles).toEqual(['legal', 'cxo', 'finance'])
  })

  it('ignores inactive org people and people with no email', async () => {
    await addOrgPerson('gone', ['Legal'], { status: 'inactive' })
    await addOrgPerson('noemail', ['Legal'], { email: '' })
    expect((await loadUserFacts(rbacEmail('gone'))).roles).toEqual([])
    expect((await loadUserFacts('')).roles).toEqual([])
  })

  it('matches emails regardless of case and surrounding whitespace (Review Focus 1)', async () => {
    await addOrgPerson('mixed', ['Pre-Sales'], { email: '  RBAC-Mixed@Amnex.com ' })
    expect((await loadUserFacts('rbac-mixed@amnex.com')).roles).toEqual(['presales'])
    expect((await loadUserFacts('  RBAC-MIXED@AMNEX.COM')).roles).toEqual(['presales'])
    expect(normalizeEmail('  A@B.com ')).toBe('a@b.com')
  })
})

describe('Sales role', () => {
  it('comes from the Sales roster, not org_people, and records the roster id', async () => {
    const id = await addSalesPerson('s')
    const facts = await loadUserFacts(rbacEmail('s'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBe(id)
  })
  it('derives Sales only for active and onLeave roster entries; resigned and inactive do not (plan gap A6)', async () => {
    await addSalesPerson('active', 'active')
    await addSalesPerson('onleave', 'onLeave')
    await addSalesPerson('inactive', 'inactive')
    await addSalesPerson('resigned', 'resigned')
    expect((await loadUserFacts(rbacEmail('active'))).roles).toEqual(['sales'])
    expect((await loadUserFacts(rbacEmail('onleave'))).roles).toEqual(['sales'])
    expect((await loadUserFacts(rbacEmail('inactive'))).roles).toEqual([])
    expect((await loadUserFacts(rbacEmail('resigned'))).roles).toEqual([])
    expect((await loadUserFacts(rbacEmail('resigned'))).salesPersonId).toBeNull()
  })
  it('a resigned salesperson can still be granted Sales explicitly by an override', async () => {
    await addSalesPerson('rg', 'resigned')
    await setRole('rg', 'sales')
    expect((await loadUserFacts(rbacEmail('rg'))).roles).toEqual(['sales'])
  })
  it('an override-granted Sales role without a roster row has no salesPersonId (Review Focus 3)', async () => {
    await setRole('norow', 'sales')
    const facts = await loadUserFacts(rbacEmail('norow'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBeNull()
  })
})

describe('overrides', () => {
  it('grant adds a role and revoke removes a derived one', async () => {
    await addOrgPerson('o', ['Legal'])
    await setRole('o', 'legal', 'revoke')
    await setRole('o', 'delivery')
    expect((await loadUserFacts(rbacEmail('o'))).roles).toEqual(['delivery'])
  })
  it('Finance, IT and Delivery exist only through overrides', async () => {
    for (const role of ['finance', 'it', 'delivery'] as const) await setRole(role, role)
    for (const role of ['finance', 'it', 'delivery'] as const) expect((await loadUserFacts(rbacEmail(role))).roles).toEqual([role])
  })
  it('ADMIN_ALLOWED_EMAILS members always hold IT, even if an override revokes it', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = `${rbacEmail('boss')}, other@amnex.com`
    await setRole('boss', 'it', 'revoke')
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['it'])
  })
})

describe('team membership facts', () => {
  it('links a login to roster rows by the roster email, or through the org-person link', async () => {
    const direct = await addTeamMember('preSales', 'direct')
    const orgId = await addOrgPerson('linked', ['Pre-Sales'])
    const { rows } = await pool.query(
      `INSERT INTO delivery_team_members (team, name, email, org_person_id) VALUES ('legal', 'RBAC linkedmember', '', $1) RETURNING id`, [orgId],
    )
    const d = await loadUserFacts(rbacEmail('direct'))
    expect(d.teamMemberIds).toEqual({ presales: [direct], legal: [], bid: [] })
    const l = await loadUserFacts(rbacEmail('linked'))
    expect(l.teamMemberIds.legal).toEqual([rows[0].id])
  })
  it('ignores inactive roster members', async () => {
    const id = await addTeamMember('bid', 'idle')
    await pool.query(`UPDATE delivery_team_members SET status='inactive' WHERE id=$1`, [id])
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('idle'))).teamMemberIds.bid).toEqual([])
  })
})

describe('cache', () => {
  it('serves repeat lookups from memory until cleared', async () => {
    await addOrgPerson('c', ['Legal'])
    await loadUserFacts(rbacEmail('c'))
    const spy = vi.spyOn(pool, 'query')
    await loadUserFacts(rbacEmail('c'))
    expect(spy).not.toHaveBeenCalled()
    clearUserFactsCache()
    await loadUserFacts(rbacEmail('c'))
    expect(spy).toHaveBeenCalled()
  })
})
