import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addOrgPerson, addSalesPerson, addTeamMember, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { combineRoles, loadUserFacts } from './userFacts.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))

beforeEach(async () => { await cleanupRbacFixtures(); await pool.query(`DELETE FROM rbac_seen_users WHERE email LIKE 'rbac-%'`) })
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  await pool.query(`DELETE FROM rbac_seen_users WHERE email LIKE 'rbac-%'`)
  await cleanupRbacFixtures()
})

describe('combineRoles', () => {
  it('derived ∪ grants − revokes, then System Admin for allow-listed accounts, in ROLES order', () => {
    expect(combineRoles(['legal'], [{ role: 'cxo', effect: 'grant' }, { role: 'legal', effect: 'revoke' }], false)).toEqual(['cxo'])
    expect(combineRoles([], [{ role: 'it', effect: 'revoke' }], true)).toEqual(['system_admin'])
    expect(combineRoles(['legal'], [], true)).toEqual(['legal', 'system_admin'])
    expect(combineRoles(['presales', 'sales'], [], false)).toEqual(['sales', 'presales'])
  })
})

describe('access.* with RBAC off: only ADMIN_ALLOWED_EMAILS may use it', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('admin') })

  it('lets an allow-listed admin manage overrides, and a role override applies at once', async () => {
    await as('admin').access.setOverride({ email: ' RBAC-Boss@Amnex.com ', role: 'cxo', effect: 'grant', reason: 'CEO' })
    const stored = await as('admin').access.listOverrides()
    expect(stored).toEqual([expect.objectContaining({ email: 'rbac-boss@amnex.com', role: 'cxo', effect: 'grant', reason: 'CEO' })])
    expect((await loadUserFacts(rbacEmail('boss'))).roles).toEqual(['cxo']) // cache cleared by the write
  })
  it('refuses everyone else with an ordinary FORBIDDEN, even a user who would hold IT', async () => {
    await setRole('somebody', 'it')
    const err = await as('somebody').access.listOverrides().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('validates input: unknown role, empty reason, malformed email', async () => {
    const admin = as('admin')
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'admin' as any, effect: 'grant', reason: 'r' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'cxo', effect: 'grant', reason: '  ' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: 'not-an-email', role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toThrow()
  })
  it('re-setting the same (email, role) updates it instead of failing, and remove deletes it', async () => {
    const admin = as('admin')
    await admin.access.setOverride({ email: rbacEmail('p'), role: 'delivery', effect: 'grant', reason: 'one' })
    await admin.access.setOverride({ email: rbacEmail('p'), role: 'delivery', effect: 'revoke', reason: 'two' })
    const [row] = await admin.access.listOverrides()
    expect(row).toMatchObject({ effect: 'revoke', reason: 'two' })
    await admin.access.removeOverride({ id: row.id })
    expect(await admin.access.listOverrides()).toEqual([])
  })
  it('never lets System Admin be granted or revoked: not as a role, and not on an allow-listed account (Review Focus 6)', async () => {
    const admin = as('admin')
    await expect(admin.access.setOverride({ email: 'x@amnex.com', role: 'system_admin' as any, effect: 'grant', reason: 'r' })).rejects.toThrow()
    await expect(admin.access.setOverride({ email: rbacEmail('admin'), role: 'it', effect: 'revoke', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(admin.access.setOverride({ email: ` ${rbacEmail('ADMIN')} `, role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await setRole('admin', 'delivery') // an override row that predates the allow-list entry
    const [row] = await admin.access.listOverrides()
    await expect(admin.access.removeOverride({ id: row.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await loadUserFacts(rbacEmail('admin'))).roles).toEqual(['delivery', 'system_admin'])
  })
})

describe('access.* in shadow: the generic gate only logs, but this API must still refuse (overrides go live at enforce)', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow' })
  it('refuses an ordinary signed-in user — they cannot give themselves a role', async () => {
    await addSalesPerson('sales')
    const err = await as('sales').access.setOverride({ email: rbacEmail('sales'), role: 'cxo', effect: 'grant', reason: 'x' }).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(await pool.query(`SELECT 1 FROM user_role_overrides WHERE email=$1`, [rbacEmail('sales')])).toMatchObject({ rowCount: 0 })
    await expect(as('sales').access.listOverrides()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(as('sales').access.readiness()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('still lets IT and a System Admin manage overrides', async () => {
    await setRole('it', 'it'); makeSystemAdmin('root')
    await expect(as('it').access.listOverrides()).resolves.toEqual(expect.any(Array))
    await expect(as('root').access.setOverride({ email: rbacEmail('z'), role: 'delivery', effect: 'grant', reason: 'r' })).resolves.toBeDefined()
  })
})

describe('access.* once RBAC is on: IT manages it, other roles cannot', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce' })
  it('IT and System Admin can; Sales cannot, and CXO may only read', async () => {
    await setRole('it', 'it'); await setRole('cxo', 'cxo'); await addSalesPerson('sales'); makeSystemAdmin('root')
    await expect(as('it').access.listOverrides()).resolves.toEqual(expect.any(Array)) // setRole above wrote override rows, so not empty
    await expect(as('root').access.listOverrides()).resolves.toEqual(expect.any(Array))
    await expect(as('root').access.setOverride({ email: rbacEmail('z'), role: 'delivery', effect: 'grant', reason: 'r' })).resolves.toBeDefined()
    await expect(as('it').access.setOverride({ email: rbacEmail('x'), role: 'finance', effect: 'grant', reason: 'r' })).resolves.toBeDefined()
    const refused = await as('sales').access.listOverrides().catch((e) => e)
    expect(refused.cause).toBeInstanceOf(RbacDenial)
    await expect(as('cxo').access.listOverrides()).resolves.toBeDefined()
    const cxoWrite = await as('cxo').access.setOverride({ email: rbacEmail('y'), role: 'finance', effect: 'grant', reason: 'r' }).catch((e) => e)
    expect(cxoWrite.cause).toBeInstanceOf(RbacDenial)
  })
})

describe('access.readiness', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.ADMIN_ALLOWED_EMAILS = rbacEmail('admin') })

  it('lists org people and the Sales roster with derived and effective roles and warns about missing emails', async () => {
    await addOrgPerson('lawyer', ['Legal'])
    await addOrgPerson('ghost', ['Pre-Sales'], { email: '' })
    await addSalesPerson('seller')
    await setRole('lawyer', 'cxo')
    const rows = await as('admin').access.readiness()
    const lawyer = rows.find((r) => r.name === 'RBAC lawyer')!
    expect(lawyer).toMatchObject({ kind: 'org', email: rbacEmail('lawyer'), derivedRoles: ['legal'], effectiveRoles: ['legal', 'cxo'], warnings: [] })
    expect(lawyer.overrides).toEqual([expect.objectContaining({ role: 'cxo', effect: 'grant' })])
    expect(rows.find((r) => r.name === 'RBAC ghost')!.warnings).toContain('no-email')
    expect(rows.find((r) => r.name === 'RBAC seller')).toMatchObject({ kind: 'sales', derivedRoles: ['sales'], effectiveRoles: ['sales'] })
  })
  it('flags a person with no role at all', async () => {
    await addOrgPerson('nobody', ['Business Units'])
    const row = (await as('admin').access.readiness()).find((r) => r.name === 'RBAC nobody')!
    expect(row.effectiveRoles).toEqual([])
    expect(row.warnings).toContain('no-role')
  })
  it('flags two people sharing one email', async () => {
    await addOrgPerson('twin1', ['Legal'], { email: rbacEmail('twin') })
    await addOrgPerson('twin2', ['Bid Management'], { email: rbacEmail('twin') })
    const rows = (await as('admin').access.readiness()).filter((r) => r.name.startsWith('RBAC twin'))
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.warnings).toContain('duplicate-email')
  })
  it('flags two roster rows sharing one email and shows neither as Sales — the server derives no role for an ambiguous address', async () => {
    await addSalesPerson('rtwin1', 'active', rbacEmail('rtwin'))
    await addSalesPerson('rtwin2', 'active', ` ${rbacEmail('rtwin').toUpperCase()}`)
    const rows = (await as('admin').access.readiness()).filter((r) => r.name.startsWith('RBAC rtwin'))
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r).toMatchObject({ derivedRoles: [], effectiveRoles: [] })
    for (const r of rows) expect(r.warnings).toEqual(expect.arrayContaining(['duplicate-email', 'no-role']))
  })
  it('shows two active org people sharing one email as ambiguous: no derived role for either', async () => {
    await addOrgPerson('otwin1', ['Legal'], { email: rbacEmail('otwin') })
    await addOrgPerson('otwin2', ['Leadership'], { email: ` ${rbacEmail('otwin').toUpperCase()}` })
    const rows = (await as('admin').access.readiness()).filter((r) => r.name.startsWith('RBAC otwin'))
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r).toMatchObject({ derivedRoles: [], effectiveRoles: [] })
      expect(r.warnings).toEqual(expect.arrayContaining(['duplicate-email', 'no-role']))
    }
  })
  it('flags an email shared by two members of one delivery team on the person who has it, and lists it when nobody else does', async () => {
    await addOrgPerson('tmperson', ['Pre-Sales'], { email: rbacEmail('tmdup') })
    await addTeamMember('preSales', 'tmx1', rbacEmail('tmdup'))
    await addTeamMember('preSales', 'tmx2', rbacEmail('tmdup').toUpperCase())
    await addTeamMember('legal', 'tmy1', rbacEmail('tmorphan'))
    await addTeamMember('legal', 'tmy2', ` ${rbacEmail('tmorphan')}`)
    await addTeamMember('bid', 'tmz', rbacEmail('tmfine'))
    const rows = await as('admin').access.readiness()
    expect(rows.find((r) => r.name === 'RBAC tmperson')!.warnings).toContain('ambiguous-team-member')
    expect(rows.find((r) => r.email === rbacEmail('tmorphan'))).toMatchObject({ kind: 'team', warnings: expect.arrayContaining(['ambiguous-team-member']) })
    expect(rows.find((r) => r.email === rbacEmail('tmfine'))).toBeUndefined() // a clean team member needs no row
  })
  it('shows System Admin accounts as protected rows, even when they are in neither the org chart nor the roster', async () => {
    makeSystemAdmin('founder')
    const rows = await as('admin').access.readiness()
    expect(rows.find((r) => r.email === rbacEmail('founder'))).toMatchObject({
      kind: 'admin', systemAdmin: true, effectiveRoles: ['system_admin'], derivedRoles: [], warnings: [],
    })
    expect(rows.find((r) => r.email === rbacEmail('admin'))).toMatchObject({ systemAdmin: true })
  })
  it('marks an org person who is also allow-listed as a System Admin without listing them twice', async () => {
    await addOrgPerson('both', ['Legal'])
    makeSystemAdmin('both')
    const rows = (await as('admin').access.readiness()).filter((r) => r.email === rbacEmail('both'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'org', systemAdmin: true, derivedRoles: ['legal'], effectiveRoles: ['legal', 'system_admin'] })
  })
  it('includes users who signed in and resolved to no role (from auth.me), with when they were last seen', async () => {
    process.env.RBAC_MODE = 'shadow'
    await as('stranger').auth.me()
    const row = (await as('admin').access.readiness()).find((r) => r.email === rbacEmail('stranger'))!
    expect(row).toMatchObject({ kind: 'seen', effectiveRoles: [] })
    expect(row.warnings).toContain('no-role')
    expect(row.lastSeenAt).not.toBeNull()
  })
})

describe('auth.me', () => {
  it('with RBAC off reports mode off and no facts', async () => {
    await expect(appRouter.createCaller({}).auth.me()).resolves.toEqual({ mode: 'off', email: null, roles: [], facts: null })
  })
  it('with RBAC on returns the caller\'s roles and roster facts', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    const salesId = await addSalesPerson('s')
    await setRole('s', 'bid')
    await expect(as('s').auth.me()).resolves.toEqual({
      mode: 'enforce', email: rbacEmail('s'), roles: ['sales', 'bid'],
      facts: { salesPersonId: salesId, teamMemberIds: { presales: [], legal: [], bid: [] } },
    })
  })
  it('reports System Admin for an allow-listed account', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    makeSystemAdmin('root')
    await expect(as('root').auth.me()).resolves.toMatchObject({ mode: 'enforce', email: rbacEmail('root'), roles: ['system_admin'] })
  })
  it('rejects a signed-out caller with UNAUTHORIZED at enforce', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
    await expect(appRouter.createCaller({}).auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('in shadow a signed-out caller is NOT prompted to sign in: shadow changes nothing for the browser (review finding 2)', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'shadow'
    await expect(appRouter.createCaller({}).auth.me()).resolves.toEqual({ mode: 'off', email: null, roles: [], facts: null })
  })
})
