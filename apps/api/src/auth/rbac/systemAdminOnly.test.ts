import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addOrgPerson, addTeamMember, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import { SYSTEM_ADMIN_ONLY, isSystemAdminCaller, requireSystemAdmin } from './systemAdminOnly.js'
import { clearUserFactsCache, loadUserFacts } from './userFacts.js'

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
type Mode = 'off' | 'shadow' | 'enforce'
const MODES: Mode[] = ['off', 'shadow', 'enforce']

function setMode(mode: Mode): void {
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
  if (mode === 'off') delete process.env.RBAC_MODE
  else process.env.RBAC_MODE = mode
}

beforeEach(async () => { await cleanupRbacFixtures(); makeSystemAdmin('root') })
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  await cleanupRbacFixtures()
})

const NOT_SA = /System Admin/
const procedures = Object.keys((appRouter as any)._def.procedures) as string[]

describe('SYSTEM_ADMIN_ONLY is an explicit rule list', () => {
  it('has unique ids, a human reason for each rule, and names real, registered procedures', () => {
    expect(new Set(SYSTEM_ADMIN_ONLY.map((r) => r.id)).size).toBe(SYSTEM_ADMIN_ONLY.length)
    for (const rule of SYSTEM_ADMIN_ONLY) {
      expect(rule.reason.trim().length, rule.id).toBeGreaterThan(10)
      expect(rule.actions.length, rule.id).toBeGreaterThan(0)
      const procedure = rule.target.split('#')[0]
      expect(procedures, rule.id).toContain(procedure)
      expect(PROCEDURE_POLICY[procedure], rule.id).toBeDefined()
      if (rule.kind === 'procedure') expect(rule.target, rule.id).not.toContain('#')
      else expect(rule.target, rule.id).toMatch(/^[\w.]+#\w+$/)
    }
  })
  it('lists exactly the override writers and the four email bindings the owner named', () => {
    expect(SYSTEM_ADMIN_ONLY.map((r) => `${r.kind}:${r.target}`).sort()).toEqual([
      'field:deliveryTeams.create#email', 'field:deliveryTeams.update#email', 'field:orgPeople.create#email', 'field:orgPeople.update#email',
      'procedure:access.removeOverride', 'procedure:access.setOverride',
    ])
  })
  it("declares each rule's module consistently with the registry requirement of the same procedure", async () => {
    const stub = { email: '', roles: [], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } } as any
    for (const rule of SYSTEM_ADMIN_ONLY) {
      const check = await PROCEDURE_POLICY[rule.target.split('#')[0]].requirements[0]({}, stub)
      expect(check?.module, rule.id).toBe(rule.module)
    }
  })
  it('keeps the registry entries (the guard is in addition to the matrix, which is unchanged)', () => {
    for (const p of ['access.listOverrides', 'access.readiness', 'access.setOverride', 'access.removeOverride']) expect(PROCEDURE_POLICY[p]).toBeDefined()
  })
})

describe('isSystemAdminCaller / requireSystemAdmin', () => {
  it('reads System Admin from the env allow-list only (case-insensitive) and treats a missing identity as not an admin', () => {
    expect(isSystemAdminCaller({ user: { email: rbacEmail('root') } })).toBe(true)
    expect(isSystemAdminCaller({ user: { email: rbacEmail('ROOT') } })).toBe(true)
    expect(isSystemAdminCaller({ user: { email: rbacEmail('other') } })).toBe(false)
    expect(isSystemAdminCaller({})).toBe(false)
  })
  it('is a no-op when auth is not enforced (no identity exists), exactly like adminProcedure / accessProcedure', () => {
    expect(() => requireSystemAdmin({}, 'x')).not.toThrow()
    expect(() => requireSystemAdmin({ user: { email: rbacEmail('other') } }, 'x')).not.toThrow()
  })
  it('throws FORBIDDEN, flagged as an RBAC denial so the browser shows a permission message and not the sign-in prompt', () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    let err: any
    try { requireSystemAdmin({ user: { email: rbacEmail('other') } }, 'Only a System Admin can do this.') } catch (e) { err = e }
    expect(err).toMatchObject({ code: 'FORBIDDEN', message: 'Only a System Admin can do this.' })
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(() => requireSystemAdmin({}, 'x')).toThrow(/x/)
    expect(() => requireSystemAdmin({ user: { email: rbacEmail('root') } }, 'x')).not.toThrow()
  })
})

describe.each(MODES)('override management with RBAC %s: System Admin only', (mode) => {
  beforeEach(async () => {
    setMode(mode)
    await setRole('it', 'it'); await setRole('cxo', 'cxo')
  })
  const payload = { email: rbacEmail('target'), role: 'finance' as const, effect: 'grant' as const, reason: 'test' }
  const rows = async () => (await pool.query(`SELECT * FROM user_role_overrides WHERE email=$1`, [rbacEmail('target')])).rows

  it('refuses an IT user (setOverride and removeOverride) and changes nothing', async () => {
    const created = await as('root').access.setOverride(payload)
    const setErr = await as('it').access.setOverride({ ...payload, role: 'legal' }).catch((e) => e)
    expect(setErr.code).toBe('FORBIDDEN')
    const removeErr = await as('it').access.removeOverride({ id: created.id }).catch((e) => e)
    expect(removeErr.code).toBe('FORBIDDEN')
    if (mode !== 'off') { // in `off` the older accessProcedure gate (allow-list only) refuses first; otherwise the System Admin guard does
      expect(setErr.message).toMatch(NOT_SA); expect(removeErr.message).toMatch(NOT_SA)
      expect(setErr.cause).toBeInstanceOf(RbacDenial)
    }
    expect((await rows()).map((r) => r.role)).toEqual(['finance'])
  })
  it('refuses a CXO user (read-only on Role & Access) and changes nothing', async () => {
    await expect(as('cxo').access.setOverride(payload)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await rows()).toEqual([])
    const created = await as('root').access.setOverride(payload)
    await expect(as('cxo').access.removeOverride({ id: created.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await rows()).toHaveLength(1)
  })
  it('lets the allow-listed System Admin create and remove an ordinary functional-role override', async () => {
    const created = await as('root').access.setOverride(payload)
    expect(created).toMatchObject({ email: rbacEmail('target'), role: 'finance', effect: 'grant' })
    expect((await loadUserFacts(rbacEmail('target'))).roles).toEqual(['finance'])
    await as('root').access.removeOverride({ id: created.id })
    expect(await rows()).toEqual([])
    expect((await loadUserFacts(rbacEmail('target'))).roles).toEqual([])
  })
  if (mode !== 'off') {
    it('IT and CXO can still READ overrides and readiness (CXO read-only, IT read)', async () => {
      for (const who of ['it', 'cxo']) {
        await expect(as(who).access.listOverrides()).resolves.toEqual(expect.any(Array))
        await expect(as(who).access.readiness()).resolves.toEqual(expect.any(Array))
      }
    })
  }
  it('still refuses a System Admin target / role, even from a System Admin', async () => {
    await expect(as('root').access.setOverride({ ...payload, role: 'system_admin' as any })).rejects.toMatchObject({ code: 'BAD_REQUEST' }) // zod: system_admin is not a role the API accepts
    await expect(as('root').access.setOverride({ ...payload, email: rbacEmail('root'), role: 'it', effect: 'revoke' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await rows()).toEqual([])
  })
})

describe('every procedure rule in SYSTEM_ADMIN_ONLY refuses a non-System-Admin who holds the matrix permission', () => {
  const INPUT: Record<string, () => unknown> = {
    'access.setOverride': () => ({ email: rbacEmail('target'), role: 'finance', effect: 'grant', reason: 'r' }),
    'access.removeOverride': () => ({ id: randomUUID() }),
  }
  const procedureRules = SYSTEM_ADMIN_ONLY.filter((r) => r.kind === 'procedure')
  const call = (who: string, path: string, input: unknown) =>
    path.split('.').reduce<any>((node, part) => node[part], as(who))(input)

  it('has an input fixture for every procedure rule (a new rule without one fails here)', () => {
    expect(procedureRules.map((r) => r.target).sort()).toEqual(Object.keys(INPUT).sort())
  })
  it.each(procedureRules.map((r) => [r.target, r] as const))('%s: IT, with the matrix permission, is refused by the System Admin rule; a System Admin is not', async (target) => {
    setMode('enforce')
    await setRole('it', 'it')
    const refused = await call('it', target, INPUT[target]()).catch((e: any) => e)
    expect(refused).toMatchObject({ code: 'FORBIDDEN' })
    expect(refused.message).toMatch(NOT_SA)
    await call('root', target, INPUT[target]()) // a rejection here would fail the test: the System Admin must not be refused
  })
})

describe.each(MODES)('email bindings with RBAC %s: only a System Admin may change them (server-enforced)', (mode) => {
  beforeEach(async () => { setMode(mode); await setRole('cxo', 'cxo') })

  const person = async (label: string, email = rbacEmail(label)) => addOrgPerson(label, [], { email })
  const emailOf = async (table: 'org_people' | 'delivery_team_members', id: string) =>
    (await pool.query(`SELECT email FROM ${table} WHERE id=$1`, [id])).rows[0]?.email as string | undefined

  describe('org people', () => {
    it('lets a CXO (W on team.org) change a NON-email field', async () => {
      const id = await person('worker')
      await expect(as('cxo').orgPeople.update({ id, patch: { designation: 'Senior Manager' } })).resolves.toMatchObject({ designation: 'Senior Manager' })
    })
    it('refuses a CXO changing the email and leaves the stored value alone', async () => {
      const id = await person('worker')
      const err = await as('cxo').orgPeople.update({ id, patch: { email: rbacEmail('newaddr') } }).catch((e) => e)
      expect(err).toMatchObject({ code: 'FORBIDDEN' })
      expect(err.message).toMatch(NOT_SA)
      expect(err.cause).toBeInstanceOf(RbacDenial)
      expect(await emailOf('org_people', id)).toBe(rbacEmail('worker'))
    })
    it('refuses clearing or setting an email on someone who has none, but lets an unchanged empty email through', async () => {
      const bound = await person('bound')
      await expect(as('cxo').orgPeople.update({ id: bound, patch: { email: '' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await emailOf('org_people', bound)).toBe(rbacEmail('bound'))
      const bare = await person('bare', '')
      await expect(as('cxo').orgPeople.update({ id: bare, patch: { email: rbacEmail('fresh') } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(as('cxo').orgPeople.update({ id: bare, patch: { email: '', designation: 'D' } })).resolves.toMatchObject({ designation: 'D', email: '' })
    })
    it('lets a re-save of the SAME email pass (trimmed, case-insensitive) so existing forms keep working', async () => {
      const id = await person('worker')
      await expect(as('cxo').orgPeople.update({ id, patch: { email: ` ${rbacEmail('WORKER')} `, designation: 'Lead' } })).resolves.toMatchObject({ designation: 'Lead' })
    })
    it('lets the System Admin change it', async () => {
      const id = await person('worker')
      await expect(as('root').orgPeople.update({ id, patch: { email: rbacEmail('moved') } })).resolves.toMatchObject({ email: rbacEmail('moved') })
      expect(await emailOf('org_people', id)).toBe(rbacEmail('moved'))
    })
    it('create: a non-empty email needs a System Admin; no email (or an empty one) does not', async () => {
      const err = await as('cxo').orgPeople.create({ name: 'RBAC created1', level: 4, email: rbacEmail('created1') }).catch((e) => e)
      expect(err).toMatchObject({ code: 'FORBIDDEN' })
      expect(err.message).toMatch(NOT_SA)
      expect((await pool.query(`SELECT 1 FROM org_people WHERE name='RBAC created1'`)).rowCount).toBe(0)
      await expect(as('cxo').orgPeople.create({ name: 'RBAC created2', level: 4 })).resolves.toMatchObject({ email: '' })
      await expect(as('cxo').orgPeople.create({ name: 'RBAC created3', level: 4, email: '' })).resolves.toMatchObject({ email: '' })
      await expect(as('root').orgPeople.create({ name: 'RBAC created4', level: 4, email: rbacEmail('created4') })).resolves.toMatchObject({ email: rbacEmail('created4') })
    })
  })

  describe('delivery team members', () => {
    it('lets a CXO change a NON-email field, and refuses an email change', async () => {
      const id = await addTeamMember('legal', 'member')
      await expect(as('cxo').deliveryTeams.update({ id, patch: { designation: 'Counsel' } })).resolves.toMatchObject({ designation: 'Counsel' })
      const err = await as('cxo').deliveryTeams.update({ id, patch: { email: rbacEmail('elsewhere'), designation: 'Partner' } }).catch((e) => e)
      expect(err).toMatchObject({ code: 'FORBIDDEN' })
      expect(err.message).toMatch(NOT_SA)
      expect(err.cause).toBeInstanceOf(RbacDenial)
      expect(await emailOf('delivery_team_members', id)).toBe(rbacEmail('member'))
      expect((await pool.query(`SELECT designation FROM delivery_team_members WHERE id=$1`, [id])).rows[0].designation).toBe('Counsel') // nothing was half-applied
    })
    it('lets a re-save of the same email pass and the System Admin change it', async () => {
      const id = await addTeamMember('bid', 'member')
      await expect(as('cxo').deliveryTeams.update({ id, patch: { email: rbacEmail('MEMBER'), designation: 'Analyst' } })).resolves.toMatchObject({ designation: 'Analyst' })
      await expect(as('root').deliveryTeams.update({ id, patch: { email: rbacEmail('renamed') } })).resolves.toMatchObject({ email: rbacEmail('renamed') })
    })
    it('create: a non-empty email needs a System Admin', async () => {
      await expect(as('cxo').deliveryTeams.create({ team: 'preSales', name: 'RBAC tm1', email: rbacEmail('tm1') })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect((await pool.query(`SELECT 1 FROM delivery_team_members WHERE name='RBAC tm1'`)).rowCount).toBe(0)
      await expect(as('cxo').deliveryTeams.create({ team: 'preSales', name: 'RBAC tm2' })).resolves.toMatchObject({ email: '' })
      await expect(as('root').deliveryTeams.create({ team: 'preSales', name: 'RBAC tm3', email: rbacEmail('tm3') })).resolves.toMatchObject({ email: rbacEmail('tm3') })
    })
  })

  it('has a case for every field rule in SYSTEM_ADMIN_ONLY', () => {
    expect(SYSTEM_ADMIN_ONLY.filter((r) => r.kind === 'field').map((r) => r.target).sort()).toEqual([
      'deliveryTeams.create#email', 'deliveryTeams.update#email', 'orgPeople.create#email', 'orgPeople.update#email',
    ])
  })
})

describe.each(MODES)('the org sync cannot rebind a team member email for a non-System-Admin (RBAC %s)', (mode) => {
  beforeEach(async () => { setMode(mode); await setRole('cxo', 'cxo') })

  const member = async (id: string) => (await pool.query(`SELECT email, org_person_id, name FROM delivery_team_members WHERE id=$1`, [id])).rows[0]
  const personName = async (id: string) => (await pool.query(`SELECT name, departments FROM org_people WHERE id=$1`, [id])).rows[0]

  it('a rename onto the name of an unlinked member is refused (FORBIDDEN, RBAC denial) and rolls EVERYTHING back', async () => {
    const alice = await addTeamMember('legal', 'alice', rbacEmail('alice-own'))
    const bob = await addOrgPerson('bob', ['Legal'], { email: rbacEmail('bob-org') })
    const err = await as('cxo').orgPeople.update({ id: bob, patch: { name: 'RBAC alice', designation: 'Counsel' } }).catch((e) => e)
    expect(err).toMatchObject({ code: 'FORBIDDEN' })
    expect(err.message).toMatch(NOT_SA)
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(await member(alice)).toMatchObject({ email: rbacEmail('alice-own'), org_person_id: null, name: 'RBAC alice' })
    expect(await personName(bob)).toMatchObject({ name: 'RBAC bob' }) // the rename itself did not stick
    expect((await pool.query(`SELECT designation FROM org_people WHERE id=$1`, [bob])).rows[0].designation).toBe('') // nor the other fields
    expect((await pool.query(`SELECT 1 FROM delivery_team_members WHERE org_person_id=$1`, [bob])).rowCount).toBe(0) // no mirrored row survived
  })
  it('adding the matching department to a namesake who has an email is refused the same way', async () => {
    const alice = await addTeamMember('bid', 'alice', rbacEmail('alice-own'))
    const namesake = await addOrgPerson('alice', ['Finance'], { email: rbacEmail('alice-org') })
    await expect(as('cxo').orgPeople.update({ id: namesake, patch: { departments: ['Finance', 'Bid Management'] } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await member(alice)).toMatchObject({ email: rbacEmail('alice-own'), org_person_id: null })
    expect((await personName(namesake)).departments).toEqual(['Finance'])
  })
  it('creating a person who collides with an unlinked member is fine: create cannot carry an email for a non-System-Admin', async () => {
    const alice = await addTeamMember('legal', 'alice', rbacEmail('alice-own'))
    const created = await as('cxo').orgPeople.create({ name: 'RBAC alice', level: 4, departments: ['Legal'] })
    expect(await member(alice)).toMatchObject({ email: rbacEmail('alice-own'), org_person_id: created.id }) // the designed name mirroring, email kept
  })
  it('the SAME operation as a System Admin succeeds and syncs (the member now mirrors the person, email included)', async () => {
    const alice = await addTeamMember('legal', 'alice', rbacEmail('alice-own'))
    const bob = await addOrgPerson('bob', ['Legal'], { email: rbacEmail('bob-org') })
    await expect(as('root').orgPeople.update({ id: bob, patch: { name: 'RBAC alice' } })).resolves.toMatchObject({ name: 'RBAC alice' })
    expect(await member(alice)).toMatchObject({ email: rbacEmail('bob-org'), org_person_id: bob })
  })
  it('an ordinary rename / department edit by a non-System-Admin still works and leaves existing member emails alone', async () => {
    const alice = await addTeamMember('legal', 'alice', rbacEmail('alice-own'))
    const bob = await addOrgPerson('bob', [], { email: rbacEmail('bob-org') })
    await expect(as('cxo').orgPeople.update({ id: bob, patch: { name: 'RBAC bobby', departments: ['Legal'] } })).resolves.toMatchObject({ name: 'RBAC bobby' })
    expect(await member(alice)).toMatchObject({ email: rbacEmail('alice-own'), org_person_id: null })
    expect((await pool.query(`SELECT email FROM delivery_team_members WHERE org_person_id=$1 AND team='legal'`, [bob])).rows).toEqual([{ email: rbacEmail('bob-org') }]) // a NEW row mirrors bobby
    await expect(as('cxo').orgPeople.update({ id: bob, patch: { designation: 'Head of Legal' } })).resolves.toMatchObject({ designation: 'Head of Legal' })
  })
  it('linking an unlinked namesake to a person WITHOUT an email is the designed mirroring: allowed, and the member keeps its email', async () => {
    const carol = await addTeamMember('legal', 'carol', rbacEmail('carol-own'))
    const person = await addOrgPerson('carolx', ['Legal'], { email: '' })
    await expect(as('cxo').orgPeople.update({ id: person, patch: { name: 'RBAC carol' } })).resolves.toMatchObject({ name: 'RBAC carol' })
    expect(await member(carol)).toMatchObject({ email: rbacEmail('carol-own'), org_person_id: person })
  })
})

describe('the org-sync email guard is a no-op when auth is not enforced (existing convention: no identity exists)', () => {
  it('lets the namesake rename through, exactly as before', async () => {
    const alice = await addTeamMember('legal', 'alice', rbacEmail('alice-own'))
    const bob = await addOrgPerson('bob', ['Legal'], { email: rbacEmail('bob-org') })
    const caller = appRouter.createCaller({ user: { email: 'tester@amnex.com' } } as any)
    await expect(caller.orgPeople.update({ id: bob, patch: { name: 'RBAC alice' } })).resolves.toMatchObject({ name: 'RBAC alice' })
    expect((await pool.query(`SELECT email FROM delivery_team_members WHERE id=$1`, [alice])).rows[0].email).toBe(rbacEmail('bob-org'))
  })
})

describe.each(MODES)('an email that is "unchanged" is persisted as STORED, never as the caller typed it (RBAC %s)', (mode) => {
  beforeEach(async () => { setMode(mode); await setRole('cxo', 'cxo') })
  const KELVIN = 'rbac-Kelvin@amnex.com' // U+212A KELVIN SIGN lowercases to ASCII "k" in JS, so it "equals" rbac-kelvin@amnex.com
  const stored = async (table: 'org_people' | 'delivery_team_members', id: string) =>
    (await pool.query(`SELECT email FROM ${table} WHERE id=$1`, [id])).rows[0].email as string
  const VARIANTS = [
    ['the Kelvin sign look-alike', KELVIN, 'rbac-kelvin@amnex.com'],
    ['another letter case', 'RBAC-Kelvin@AMNEX.com', 'rbac-kelvin@amnex.com'],
    ['a lower-case rewrite of a stored mixed-case address', 'rbac-mixed@amnex.com', 'Rbac-Mixed@amnex.com'],
  ]

  it('the look-alike really compares equal (so this is the case that needs the guard)', () => {
    expect(KELVIN.toLowerCase()).toBe('rbac-kelvin@amnex.com')
    expect(KELVIN).not.toBe('rbac-kelvin@amnex.com')
  })
  it.each(VARIANTS)('org people: %s is stored byte-for-byte as it was', async (_label, typed, storedValue) => {
    const id = await addOrgPerson('kelv', [], { email: storedValue })
    await expect(as('cxo').orgPeople.update({ id, patch: { email: typed, designation: 'D' } })).resolves.toMatchObject({ designation: 'D', email: storedValue })
    expect(await stored('org_people', id)).toBe(storedValue)
  })
  it.each(VARIANTS)('team members: %s is stored byte-for-byte as it was', async (_label, typed, storedValue) => {
    const id = await addTeamMember('legal', 'kelv', storedValue)
    await expect(as('cxo').deliveryTeams.update({ id, patch: { email: typed, designation: 'D' } })).resolves.toMatchObject({ designation: 'D', email: storedValue })
    expect(await stored('delivery_team_members', id)).toBe(storedValue)
  })
  it('a real change by the System Admin is still stored exactly as typed', async () => {
    const id = await addOrgPerson('kelv', [], { email: 'rbac-kelvin@amnex.com' })
    await as('root').orgPeople.update({ id, patch: { email: 'rbac-Changed@amnex.com' } })
    expect(await stored('org_people', id)).toBe('rbac-Changed@amnex.com')
    const member = await addTeamMember('bid', 'kelv', 'rbac-kelvin@amnex.com')
    await as('root').deliveryTeams.update({ id: member, patch: { email: 'rbac-Changed@amnex.com' } })
    expect(await stored('delivery_team_members', member)).toBe('rbac-Changed@amnex.com')
  })
})

describe('deliveryTeams.update reads, checks and writes the email under one row lock', () => {
  beforeEach(async () => { setMode('enforce'); await setRole('cxo', 'cxo') })

  it('a non-System-Admin "unchanged" re-save cannot revert a System Admin change that commits while it waits', async () => {
    const id = await addTeamMember('legal', 'racer', rbacEmail('before'))
    const admin = await pool.connect()
    try {
      await admin.query('BEGIN')
      await admin.query(`UPDATE delivery_team_members SET email=$2 WHERE id=$1`, [id, rbacEmail('after')]) // the System Admin's change, not yet committed
      const resave = as('cxo').deliveryTeams.update({ id, patch: { email: rbacEmail('before'), designation: 'Late' } }).catch((e) => e)
      for (let i = 0; i < 100; i++) { // wait until the re-save is really blocked on the row lock
        const waiting = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%delivery_team_members%' AND pid <> pg_backend_pid()`)
        if (waiting.rowCount) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await admin.query('COMMIT')
      const outcome = await resave
      expect(outcome).toMatchObject({ code: 'FORBIDDEN' }) // against the committed value the "same" email is now a change
    } finally {
      admin.release()
    }
    expect((await pool.query(`SELECT email, designation FROM delivery_team_members WHERE id=$1`, [id])).rows[0]).toMatchObject({ email: rbacEmail('after'), designation: '' })
  })
  it('keeps the existing behaviour for a missing member, a no-op patch and a manager change', async () => {
    await expect(as('cxo').deliveryTeams.update({ id: randomUUID(), patch: { designation: 'x' } })).resolves.toBeNull()
    const a = await addTeamMember('legal', 'lead'), b = await addTeamMember('legal', 'report')
    await expect(as('cxo').deliveryTeams.update({ id: a, patch: {} })).resolves.toMatchObject({ id: a })
    await expect(as('cxo').deliveryTeams.update({ id: b, patch: { managerId: a } })).resolves.toMatchObject({ managerId: a })
    await expect(as('cxo').deliveryTeams.update({ id: a, patch: { managerId: b } })).rejects.toMatchObject({ code: 'BAD_REQUEST' }) // circular
    await expect(as('cxo').deliveryTeams.update({ id: randomUUID(), patch: { managerId: a } })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(as('cxo').deliveryTeams.update({ id: b, patch: { name: 'RBAC lead' } })).rejects.toMatchObject({ code: 'CONFLICT' }) // same name on the team
  })
})

describe('the email rule is a no-op when auth is not enforced (existing convention: no identity exists)', () => {
  it('lets an unauthenticated-mode caller change an email, exactly as before', async () => {
    const id = await addOrgPerson('legacy', [])
    const caller = appRouter.createCaller({ user: { email: 'tester@amnex.com' } } as any)
    await expect(caller.orgPeople.update({ id, patch: { email: rbacEmail('legacy2') } })).resolves.toMatchObject({ email: rbacEmail('legacy2') })
  })
})

describe('System Admin can never be created through override or email management', () => {
  beforeEach(async () => { setMode('enforce'); await setRole('cxo', 'cxo') })

  it('an org person pointed at a NEW address does not make that address a System Admin', async () => {
    const id = await addOrgPerson('promo', ['Leadership'])
    await as('root').orgPeople.update({ id, patch: { email: rbacEmail('newaddr') } })
    clearUserFactsCache()
    const facts = await loadUserFacts(rbacEmail('newaddr'))
    expect(facts.roles).toEqual(['cxo']) // derived from Leadership, nothing more
    expect(facts.roles).not.toContain('system_admin')
    expect(isSystemAdminCaller({ user: { email: rbacEmail('newaddr') } })).toBe(false)
  })
  it('pointing a person at an allow-listed address changes nobody\'s System Admin status: it still comes only from the env', async () => {
    const before = process.env.ADMIN_ALLOWED_EMAILS
    const id = await addOrgPerson('hijack', ['Legal'])
    await as('root').orgPeople.update({ id, patch: { email: rbacEmail('root') } })
    clearUserFactsCache()
    expect(process.env.ADMIN_ALLOWED_EMAILS).toBe(before)
    expect((await loadUserFacts(rbacEmail('root'))).roles).toEqual(['legal', 'system_admin']) // derived Legal + the env's System Admin
    await as('root').orgPeople.update({ id, patch: { email: rbacEmail('elsewhere') } })
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('root'))).roles).toEqual(['system_admin'])
    expect((await loadUserFacts(rbacEmail('elsewhere'))).roles).toEqual(['legal'])
    expect(process.env.ADMIN_ALLOWED_EMAILS).toBe(before)
  })
  it('a team member re-pointed at an allow-listed address does not alter who is a System Admin either', async () => {
    const before = process.env.ADMIN_ALLOWED_EMAILS
    const id = await addTeamMember('legal', 'tmhijack')
    await as('root').deliveryTeams.update({ id, patch: { email: rbacEmail('root') } })
    clearUserFactsCache()
    expect((await loadUserFacts(rbacEmail('root'))).roles).toEqual(['system_admin'])
    expect(process.env.ADMIN_ALLOWED_EMAILS).toBe(before)
    expect((await loadUserFacts(rbacEmail('tmhijack'))).roles).toEqual([])
  })
  it('setOverride still refuses system_admin as a role and an allow-listed account as a target, for the System Admin too', async () => {
    await expect(as('root').access.setOverride({ email: rbacEmail('x'), role: 'system_admin' as any, effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(as('root').access.setOverride({ email: rbacEmail('root'), role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await setRole('root', 'delivery') // a row that predates the allow-list entry
    const [row] = (await pool.query(`SELECT id FROM user_role_overrides WHERE email=$1`, [rbacEmail('root')])).rows
    await expect(as('root').access.removeOverride({ id: row.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
