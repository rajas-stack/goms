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

/** The unique index on sales_persons.official_email is exact-match, so case / whitespace variants of one address can coexist. */
describe('duplicate roster emails are ambiguous, never silently resolved', () => {
  it('two eligible roster rows with one email (any case / spacing) give NO Sales role and NO salesPersonId', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await addSalesPerson('dup1', 'active', rbacEmail('twin'))
    await addSalesPerson('dup2', 'onLeave', `  ${rbacEmail('twin').toUpperCase()} `)
    const facts = await loadUserFacts(rbacEmail('twin'))
    expect(facts.roles).toEqual([])
    expect(facts.salesPersonId).toBeNull()
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('rbac.ambiguous_identity') && l.includes('sales_persons'))).toBe(true)
  })
  it('does not pick a row by insertion order: either order gives the same refusal', async () => {
    const a = await addSalesPerson('o1', 'active', rbacEmail('twin2'))
    const b = await addSalesPerson('o2', 'active', rbacEmail('twin2').toUpperCase())
    expect([a, b]).not.toContain((await loadUserFacts(rbacEmail('twin2'))).salesPersonId)
  })
  it('an explicit Sales override still grants the role, but still binds no roster row', async () => {
    await addSalesPerson('dup3', 'active', rbacEmail('twin3'))
    await addSalesPerson('dup4', 'active', ` ${rbacEmail('twin3')}`)
    await setRole('twin3', 'sales')
    const facts = await loadUserFacts(rbacEmail('twin3'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBeNull()
  })
  it('a resigned duplicate does not make an active person ambiguous', async () => {
    const live = await addSalesPerson('live', 'active', rbacEmail('twin4'))
    await addSalesPerson('old', 'resigned', rbacEmail('twin4').toUpperCase())
    const facts = await loadUserFacts(rbacEmail('twin4'))
    expect(facts.roles).toEqual(['sales'])
    expect(facts.salesPersonId).toBe(live)
  })
})

describe('duplicate org-chart and team-member emails are ambiguous too (fail closed)', () => {
  const ambiguityLogs = (warn: ReturnType<typeof vi.spyOn>, source: string) =>
    warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('rbac.ambiguous_identity') && l.includes(source))

  it('two active org people sharing an email (any case / spacing) derive NO role for that login, and it is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await addOrgPerson('og1', ['Legal'], { email: rbacEmail('orgtwin') })
    await addOrgPerson('og2', ['Leadership'], { email: `  ${rbacEmail('orgtwin').toUpperCase()} ` })
    expect((await loadUserFacts(rbacEmail('orgtwin'))).roles).toEqual([])
    expect(ambiguityLogs(warn, 'org_people')).toHaveLength(1)
  })
  it('an explicit override still grants a role on an ambiguous org email', async () => {
    await addOrgPerson('og3', ['Legal'], { email: rbacEmail('orgtwin2') })
    await addOrgPerson('og4', ['Leadership'], { email: rbacEmail('orgtwin2').toUpperCase() })
    await setRole('orgtwin2', 'finance')
    expect((await loadUserFacts(rbacEmail('orgtwin2'))).roles).toEqual(['finance'])
  })
  it('an inactive duplicate does not make an active org person ambiguous', async () => {
    await addOrgPerson('og5', ['Legal'], { email: rbacEmail('orgtwin3') })
    await addOrgPerson('og6', ['Leadership'], { email: rbacEmail('orgtwin3').toUpperCase(), status: 'inactive' })
    expect((await loadUserFacts(rbacEmail('orgtwin3'))).roles).toEqual(['legal'])
  })

  it('two active members of the SAME team with one email bind no id for that team, and it is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await addTeamMember('preSales', 'tm1', rbacEmail('tmtwin'))
    await addTeamMember('preSales', 'tm2', ` ${rbacEmail('tmtwin').toUpperCase()}`)
    expect((await loadUserFacts(rbacEmail('tmtwin'))).teamMemberIds).toEqual({ presales: [], legal: [], bid: [] })
    expect(ambiguityLogs(warn, 'delivery_team_members')).toHaveLength(1)
  })
  it('one person on two DIFFERENT teams is not ambiguous: each team binds its own id', async () => {
    const pre = await addTeamMember('preSales', 'tm3', rbacEmail('tmboth'))
    const bid = await addTeamMember('bid', 'tm4', rbacEmail('tmboth').toUpperCase())
    expect((await loadUserFacts(rbacEmail('tmboth'))).teamMemberIds).toEqual({ presales: [pre], legal: [], bid: [bid] })
  })
  it('only the ambiguous team loses its binding; another team with a single row keeps it', async () => {
    await addTeamMember('legal', 'tm5', rbacEmail('tmmix'))
    await addTeamMember('legal', 'tm6', rbacEmail('tmmix').toUpperCase())
    const bid = await addTeamMember('bid', 'tm7', rbacEmail('tmmix'))
    expect((await loadUserFacts(rbacEmail('tmmix'))).teamMemberIds).toEqual({ presales: [], legal: [], bid: [bid] })
  })
  it('a direct row and a different row linked through an org person, same team and email, are ambiguous', async () => {
    const orgId = await addOrgPerson('tmlink', ['Pre-Sales'], { email: rbacEmail('tmlinked') })
    await addTeamMember('preSales', 'tm8', rbacEmail('tmlinked'))
    await pool.query(`INSERT INTO delivery_team_members (team, name, email, org_person_id) VALUES ('preSales', 'RBAC tm9', '', $1)`, [orgId])
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('tmlinked'))).teamMemberIds.presales).toEqual([])
  })
  it('one row matching BOTH directly and through its org person is a single identity, not a duplicate', async () => {
    const orgId = await addOrgPerson('tmself', ['Pre-Sales'], { email: rbacEmail('tmself') })
    const { rows } = await pool.query(
      `INSERT INTO delivery_team_members (team, name, email, org_person_id) VALUES ('preSales', 'RBAC tm10', $1, $2) RETURNING id`, [rbacEmail('tmself'), orgId],
    )
    expect((await loadUserFacts(rbacEmail('tmself'))).teamMemberIds.presales).toEqual([rows[0].id])
  })
  it('when the org identity is ambiguous, team rows reached only through the org link are not bound; direct rows still are', async () => {
    const a = await addOrgPerson('tmo1', ['Pre-Sales'], { email: rbacEmail('tmorg') })
    await addOrgPerson('tmo2', ['Legal'], { email: rbacEmail('tmorg').toUpperCase() })
    await pool.query(`INSERT INTO delivery_team_members (team, name, email, org_person_id) VALUES ('preSales', 'RBAC tm11', '', $1)`, [a])
    const direct = await addTeamMember('bid', 'tm12', rbacEmail('tmorg'))
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('tmorg'))).teamMemberIds).toEqual({ presales: [], legal: [], bid: [direct] })
  })
  it('an explicit override grants the role on an ambiguous team email but binds no member id', async () => {
    await addTeamMember('preSales', 'tm13', rbacEmail('tmov'))
    await addTeamMember('preSales', 'tm14', rbacEmail('tmov').toUpperCase())
    await setRole('tmov', 'presales')
    const facts = await loadUserFacts(rbacEmail('tmov'))
    expect(facts.roles).toEqual(['presales'])
    expect(facts.teamMemberIds.presales).toEqual([])
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
  it('ADMIN_ALLOWED_EMAILS members are System Admins (not IT), even if an override revokes IT', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = `${rbacEmail('boss')}, other@amnex.com`
    await setRole('boss', 'it', 'revoke')
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['system_admin'])
  })
  it('System Admin is allow-list-only: nothing else produces it', async () => {
    await addOrgPerson('lead', ['Leadership'])
    await setRole('techie', 'it')
    expect((await loadUserFacts(rbacEmail('lead'))).roles).toEqual(['cxo'])
    expect((await loadUserFacts(rbacEmail('techie'))).roles).toEqual(['it'])
    expect((await loadUserFacts(rbacEmail('stranger'))).roles).toEqual([])
  })
  it('matches the allow-list regardless of case and whitespace, and never for an empty login (Review Focus 6)', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = `  ${rbacEmail('boss').toUpperCase()} , `
    expect((await loadUserFacts('  RBAC-BOSS@amnex.com ')).roles).toEqual(['system_admin'])
    expect((await loadUserFacts('')).roles).toEqual([])
  })
  it('adds System Admin to whatever the person already holds, last in ROLES order', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('boss')
    await addOrgPerson('boss', ['Legal'])
    await setRole('boss', 'finance')
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['legal', 'finance', 'system_admin'])
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
