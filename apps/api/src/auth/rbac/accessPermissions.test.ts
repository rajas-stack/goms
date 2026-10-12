import { FIELD_SETS, FUNCTIONAL_ROLES, GRANTS, MODULES, ROLE_LABELS, accessFor, grantFor, type PolicyModuleKey } from '@goms/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addOrgPerson, addSalesPerson, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import { SYSTEM_ADMIN_ONLY } from './systemAdminOnly.js'
import { loadUserFacts } from './userFacts.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
const POLICY_MODULES = Object.keys(GRANTS) as PolicyModuleKey[]

beforeEach(async () => {
  await cleanupRbacFixtures()
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
  makeSystemAdmin('root')
  await setRole('it', 'it'); await setRole('cxo', 'cxo'); await addSalesPerson('sales')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  await cleanupRbacFixtures()
})

describe('access.permissionMatrix', () => {
  it('lists the 8 functional roles then System Admin (flagged unrestricted), with the domain labels', async () => {
    const { roles } = await as('cxo').access.permissionMatrix()
    expect(roles.map((r) => r.key)).toEqual([...FUNCTIONAL_ROLES, 'system_admin'])
    for (const r of roles) expect(r).toMatchObject({ label: ROLE_LABELS[r.key], unrestricted: r.key === 'system_admin' })
  })
  it('lists every policy module (25: the derived Master Grid has no grants) in registry order, with label and group', async () => {
    const { modules } = await as('cxo').access.permissionMatrix()
    expect(modules).toHaveLength(25)
    expect(modules).toEqual(MODULES.filter((m) => m.key in GRANTS).map((m) => ({ key: m.key, label: m.label, group: m.group })))
    expect(modules.map((m) => m.key)).not.toContain('opp.master')
  })
  it('equals the domain GRANTS for every policy module x every role (derived, never hand-copied)', async () => {
    const { grants } = await as('cxo').access.permissionMatrix()
    expect(Object.keys(grants).sort()).toEqual([...POLICY_MODULES].sort())
    let cells = 0
    for (const module of POLICY_MODULES) {
      for (const role of [...FUNCTIONAL_ROLES, 'system_admin'] as const) {
        const g = grantFor(module, role)
        expect(grants[module][role], `${module}/${role}`).toEqual({ level: g.level, scope: g.scope, sets: [...g.sets], create: g.create, delete: g.delete })
        cells++
      }
    }
    expect(cells).toBe(25 * 9)
  })
  it('carries the field sets and the System Admin only restrictions', async () => {
    const m = await as('it').access.permissionMatrix()
    expect(m.fieldSets).toEqual(Object.fromEntries(Object.entries(FIELD_SETS).map(([k, v]) => [k, [...v]])))
    expect(m.restrictions).toEqual(SYSTEM_ADMIN_ONLY.map((r) => ({ id: r.id, kind: r.kind, target: r.target, module: r.module, actions: r.actions, reason: r.reason })))
    expect(m.restrictions.map((r) => r.target)).toEqual(expect.arrayContaining(['access.setOverride', 'access.removeOverride', 'orgPeople.update#email']))
  })
  it('hands out copies: changing a response cannot change the domain matrix', async () => {
    const first = await as('cxo').access.permissionMatrix()
    const before = JSON.stringify([GRANTS, FIELD_SETS])
    first.grants['admin.access'].it.level = 'N'
    first.grants['opp.bidTracker'].sales.sets.push('X')
    first.fieldSets.S1.push('x')
    expect(JSON.stringify([GRANTS, FIELD_SETS])).toBe(before)
  })
  it('does not leak the System Admin allow-list', async () => {
    makeSystemAdmin('secretadmin')
    const text = JSON.stringify(await as('cxo').access.permissionMatrix())
    expect(text).not.toContain('rbac-root'); expect(text).not.toContain('secretadmin')
  })
})

describe('access.effectivePermissions equals the server evaluator', () => {
  const FIXTURES: Record<string, () => Promise<string>> = {
    'a Sales person with a roster row (own scope)': async () => { await addSalesPerson('seller'); return rbacEmail('seller') },
    'a CXO + Legal multi-role person (max-merge)': async () => { await addOrgPerson('lawyer', ['Legal']); await setRole('lawyer', 'cxo'); return rbacEmail('lawyer') },
    'a person whose only role is an override grant': async () => { await setRole('financeonly', 'finance'); return rbacEmail('financeonly') },
    'a person whose derived role is revoked': async () => { await addOrgPerson('revoked', ['Legal']); await setRole('revoked', 'legal', 'revoke'); return rbacEmail('revoked') },
    'an allow-listed System Admin': async () => rbacEmail('root'),
    'an unknown email': async () => rbacEmail('stranger'),
    'a Sales + Pre-sales + Bid person': async () => { await addSalesPerson('multi'); await setRole('multi', 'presales'); await setRole('multi', 'bid'); return rbacEmail('multi') },
  }

  it.each(Object.entries(FIXTURES))('%s', async (_name, make) => {
    const email = await make()
    const user = await loadUserFacts(email)
    const result = await as('cxo').access.effectivePermissions({ email })
    expect(result.email).toBe(email)
    expect(result.roles).toEqual(user.roles)
    expect(result.systemAdmin).toBe(user.roles.includes('system_admin'))
    expect(result.modules.map((m) => m.module)).toEqual(MODULES.filter((m) => m.key in GRANTS).map((m) => m.key))
    for (const row of result.modules) {
      const access = accessFor(user, row.module)
      expect(row.level, row.module).toBe(access.level)
      expect(row.create, row.module).toBe(access.create)
      expect(row.delete, row.module).toBe(access.delete)
      const meta = MODULES.find((m) => m.key === row.module)!
      expect({ label: row.label, group: row.group }).toEqual({ label: meta.label, group: meta.group })
      // the named sets expand to exactly the atoms the evaluator grants (level P), and appear nowhere else
      if (access.level === 'P') expect(new Set(row.sets.flatMap((s) => FIELD_SETS[s])), row.module).toEqual(access.atoms)
      else expect(row.sets, row.module).toEqual([])
      // scoped grants are exactly the held, non-`all` P/W grants (they apply only to rows in the person's own / assigned scope)
      const expectedScoped = user.roles.filter((r) => r !== 'system_admin').map((r) => ({ role: r, g: grantFor(row.module, r) }))
        .filter(({ g }) => g.scope !== 'all' && (g.level === 'P' || g.level === 'W'))
        .map(({ role, g }) => ({ role, scope: g.scope, level: g.level, sets: [...g.sets], create: g.create, delete: g.delete }))
      expect(row.scoped, row.module).toEqual(expectedScoped)
    }
  })

  it('a System Admin gets the unrestricted result: write, create and delete everywhere, and no restrictions', async () => {
    const result = await as('cxo').access.effectivePermissions({ email: rbacEmail('root') })
    expect(result).toMatchObject({ systemAdmin: true, roles: ['system_admin'] })
    for (const m of result.modules) {
      expect(m, m.module).toMatchObject({ level: 'W', create: true, delete: true, sets: [], scoped: [], restrictions: [] })
      expect(m.restrictedTo, m.module).toBeUndefined()
    }
    expect(result.notes.join(' ')).toMatch(/System Admin/)
  })
  it('an unknown email gets baseline only: Geography read-only and everything else no access', async () => {
    const result = await as('cxo').access.effectivePermissions({ email: ` ${rbacEmail('NOBODY')} ` })
    expect(result).toMatchObject({ email: rbacEmail('nobody'), roles: [], systemAdmin: false })
    for (const m of result.modules) expect(m.level, m.module).toBe(m.module === 'am.geography' ? 'R' : 'N')
    expect(result.notes.join(' ')).toMatch(/no role/i)
  })

  it('Sales: scoped edit rights are described, not guessed — read-only without a row, plus the own-scope grant and a note', async () => {
    await addSalesPerson('seller')
    const result = await as('cxo').access.effectivePermissions({ email: rbacEmail('seller') })
    const pipeline = result.modules.find((m) => m.module === 'opp.pipeline')!
    expect(pipeline).toMatchObject({ level: 'R', create: true, delete: false, scoped: [{ role: 'sales', scope: 'own', level: 'W', sets: [], create: true, delete: false }] })
    const bidTracker = result.modules.find((m) => m.module === 'opp.bidTracker')!
    expect(bidTracker.scoped).toEqual([{ role: 'sales', scope: 'own', level: 'P', sets: ['S1'], create: true, delete: false }])
    expect(result.notes.join(' ')).toMatch(/own|assigned/i)
  })

  describe('restrictions (System Admin only)', () => {
    it('admin.access is restricted to System Admin for a non-System-Admin even when the matrix gives them write (IT)', async () => {
      const result = await as('cxo').access.effectivePermissions({ email: rbacEmail('it') })
      const access = result.modules.find((m) => m.module === 'admin.access')!
      expect(access).toMatchObject({ level: 'W', create: true, delete: true, restrictedTo: 'System Admin' })
      expect(access.restrictions.map((r) => r.target).sort()).toEqual(['access.removeOverride', 'access.setOverride'])
      for (const r of access.restrictions) expect(r.reason.length).toBeGreaterThan(10)
      for (const m of result.modules.filter((x) => x.module !== 'admin.access')) expect(m.restrictedTo, m.module).toBeUndefined()
    })
    it('the email fields are listed on team.org without restricting the whole module', async () => {
      await addOrgPerson('lawyer', ['Legal']); await setRole('lawyer', 'cxo')
      const org = (await as('it').access.effectivePermissions({ email: rbacEmail('lawyer') })).modules.find((m) => m.module === 'team.org')!
      expect(org).toMatchObject({ level: 'W', create: true, delete: true })
      expect(org.restrictedTo).toBeUndefined()
      expect(org.restrictions.map((r) => r.target).sort()).toEqual(['deliveryTeams.create#email', 'deliveryTeams.update#email', 'orgPeople.create#email', 'orgPeople.update#email'])
    })
    it('is present for a person with no access at all, absent for the System Admin', async () => {
      expect((await as('cxo').access.effectivePermissions({ email: rbacEmail('stranger') })).modules.find((m) => m.module === 'admin.access')!.restrictedTo).toBe('System Admin')
      expect((await as('cxo').access.effectivePermissions({ email: rbacEmail('root') })).modules.find((m) => m.module === 'admin.access')!.restrictedTo).toBeUndefined()
    })
  })

  it('returns only a boolean for the queried email — no part of ADMIN_ALLOWED_EMAILS leaks', async () => {
    makeSystemAdmin('secretadmin')
    const text = JSON.stringify(await as('cxo').access.effectivePermissions({ email: rbacEmail('sales') }))
    expect(text).not.toContain('rbac-root'); expect(text).not.toContain('secretadmin')
    expect((await as('cxo').access.effectivePermissions({ email: rbacEmail('secretadmin') })).systemAdmin).toBe(true)
  })
  it('validates its input like the other email inputs', async () => {
    await expect(as('cxo').access.effectivePermissions({ email: 'not-an-email' })).rejects.toThrow()
    await expect(as('cxo').access.effectivePermissions({ email: '' })).rejects.toThrow()
  })
})

describe('who may call the permission queries', () => {
  const calls: [string, (c: any) => Promise<unknown>][] = [
    ['permissionMatrix', (c) => c.access.permissionMatrix()],
    ['effectivePermissions', (c) => c.access.effectivePermissions({ email: rbacEmail('sales') })],
  ]
  it.each(calls)('%s: CXO, IT and System Admin can; Sales is refused by RBAC; a signed-out caller is UNAUTHORIZED', async (_name, call) => {
    for (const who of ['cxo', 'it', 'root']) await expect(call(as(who))).resolves.toBeDefined()
    const refused: any = await call(as('sales')).catch((e) => e)
    expect(refused.code).toBe('FORBIDDEN')
    expect(refused.cause).toBeInstanceOf(RbacDenial)
    await expect(call(appRouter.createCaller({}))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it.each(calls)('%s: with RBAC off only an allow-listed System Admin can, like every other access.* query', async (_name, call) => {
    delete process.env.RBAC_MODE
    await expect(call(as('root'))).resolves.toBeDefined()
    await expect(call(as('it'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('both are registered as read(admin.access)', async () => {
    for (const path of ['access.permissionMatrix', 'access.effectivePermissions']) {
      expect(PROCEDURE_POLICY[path].requirements).toHaveLength(1)
      expect(await PROCEDURE_POLICY[path].requirements[0]({}, {} as any)).toMatchObject({ module: 'admin.access', action: 'read' })
    }
  })
})
