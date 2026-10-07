import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../../index.js'
import { pool } from '../../db.js'
import { writeAuditLog } from '../../lib/auditLog.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addOrgPerson, addSalesPerson, addTeamMember, cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'

// The audit sink is the real one; it is wrapped only so one test can make it fail and prove the write is atomic with the change.
vi.mock('../../lib/auditLog.js', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/auditLog.js')>()
  return { ...actual, writeAuditLog: vi.fn(actual.writeAuditLog) }
})

const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) // TIMESTAMPTZ(3): keep separate events in separate milliseconds
const TARGET = rbacEmail('target')
const entityId = (role: string, email = TARGET) => `${email}|${role}`

const auditRows = async (id?: string) =>
  (await pool.query(
    `SELECT * FROM commercial_audit_logs WHERE entity_type='role_override' AND entity_id LIKE 'rbac-%' AND ($1::text IS NULL OR entity_id=$1) ORDER BY changed_at, field`, [id ?? null],
  )).rows
const overrideRows = async (email = TARGET) => (await pool.query(`SELECT * FROM user_role_overrides WHERE email=$1 ORDER BY role`, [email])).rows

beforeEach(async () => {
  await cleanupRbacFixtures()
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
  makeSystemAdmin('root')
  await setRole('it', 'it'); await setRole('cxo', 'cxo'); await addSalesPerson('sales')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  await pool.query(`DELETE FROM rbac_seen_users WHERE email LIKE 'rbac-%'`)
  await cleanupRbacFixtures()
})

describe('access.setOverride writes an audit trail', () => {
  it('create: exactly one `effect` row with actor, reason and the new value', async () => {
    await as('root').access.setOverride({ email: ` ${TARGET.toUpperCase()} `, role: 'finance', effect: 'grant', reason: 'Joined finance' })
    const rows = await auditRows(entityId('finance'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entity_type: 'role_override', entity_id: entityId('finance'), field: 'effect', old_value: '', new_value: 'grant',
      reason: 'Joined finance', action: 'create', changed_by: rbacEmail('root'),
    })
    expect(rows[0].changed_at).toBeInstanceOf(Date)
  })
  it('update with a different effect: an `update` effect row carrying old and new (and a `reason` row when the reason changed too)', async () => {
    await as('root').access.setOverride({ email: TARGET, role: 'delivery', effect: 'grant', reason: 'one' })
    await sleep(5)
    await as('root').access.setOverride({ email: TARGET, role: 'delivery', effect: 'revoke', reason: 'two' })
    const rows = (await auditRows(entityId('delivery'))).filter((r) => r.action === 'update')
    expect(rows.map((r) => r.field).sort()).toEqual(['effect', 'reason'])
    expect(rows.find((r) => r.field === 'effect')).toMatchObject({ old_value: 'grant', new_value: 'revoke', reason: 'two', changed_by: rbacEmail('root') })
    expect(rows.find((r) => r.field === 'reason')).toMatchObject({ old_value: 'one', new_value: 'two', reason: 'two' })
    expect((await auditRows(entityId('delivery'))).filter((r) => r.action === 'create')).toHaveLength(1)
  })
  it('update with only a new reason: exactly one `reason` row and no `effect` row', async () => {
    await as('root').access.setOverride({ email: TARGET, role: 'it', effect: 'grant', reason: 'first reason' })
    await sleep(5)
    await as('root').access.setOverride({ email: TARGET, role: 'it', effect: 'grant', reason: 'better reason' })
    const updates = (await auditRows(entityId('it'))).filter((r) => r.action === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ field: 'reason', old_value: 'first reason', new_value: 'better reason', reason: 'better reason' })
  })
  it('re-setting an identical override changes nothing and logs nothing (the original author stays on the row)', async () => {
    const first = await as('root').access.setOverride({ email: TARGET, role: 'legal', effect: 'grant', reason: 'same' })
    await sleep(5)
    const again = await as('root').access.setOverride({ email: TARGET, role: 'legal', effect: 'grant', reason: 'same' })
    expect(again).toMatchObject({ id: first.id, effect: 'grant', reason: 'same' })
    expect(await auditRows(entityId('legal'))).toHaveLength(1)
  })
  it('a different System Admin changing it is recorded as the actor, and the row now shows them', async () => {
    makeSystemAdmin('root2')
    await as('root').access.setOverride({ email: TARGET, role: 'cxo', effect: 'grant', reason: 'a' })
    await sleep(5)
    const changed = await as('root2').access.setOverride({ email: TARGET, role: 'cxo', effect: 'revoke', reason: 'b' })
    expect(changed.createdBy).toBe(rbacEmail('root2'))
    expect((await auditRows(entityId('cxo'))).filter((r) => r.action === 'update').every((r) => r.changed_by === rbacEmail('root2'))).toBe(true)
  })
})

describe('access.removeOverride writes an audit trail', () => {
  it('writes one `remove` row: the old effect becomes empty and the old reason is kept', async () => {
    const created = await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'Was finance' })
    makeSystemAdmin('root2')
    await sleep(5)
    await as('root2').access.removeOverride({ id: created.id })
    expect(await overrideRows()).toEqual([])
    const removes = (await auditRows(entityId('finance'))).filter((r) => r.action === 'remove')
    expect(removes).toHaveLength(1)
    expect(removes[0]).toMatchObject({ entity_id: entityId('finance'), field: 'effect', old_value: 'grant', new_value: '', reason: 'Was finance', changed_by: rbacEmail('root2') })
  })
  it('removing a non-existent id writes nothing and does not fail', async () => {
    await expect(as('root').access.removeOverride({ id: randomUUID() })).resolves.toBeUndefined()
    expect(await auditRows()).toEqual([])
  })
})

describe('access.overrideHistory', () => {
  it('survives removal and lists every event, newest first', async () => {
    const created = await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'start' })
    await sleep(5)
    await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'revoke', reason: 'start' })
    await sleep(5)
    await as('root').access.removeOverride({ id: created.id })
    const history = await as('it').access.overrideHistory({ email: TARGET, role: 'finance' })
    expect(history.map((h) => `${h.action}:${h.field}:${h.oldValue}>${h.newValue}`)).toEqual(['remove:effect:revoke>', 'update:effect:grant>revoke', 'create:effect:>grant'])
    expect(history[0]).toMatchObject({ changedBy: rbacEmail('root'), reason: 'start', email: TARGET, role: 'finance' })
    expect(typeof history[0].changedAt).toBe('string')
    expect(new Date(history[0].changedAt).getTime()).toBeGreaterThanOrEqual(new Date(history[2].changedAt).getTime())
    expect(await overrideRows()).toEqual([]) // the override is gone; its history is not
  })
  it('filters by email, by role, by both, and returns everything with no filter', async () => {
    const other = rbacEmail('other')
    await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })
    await as('root').access.setOverride({ email: TARGET, role: 'legal', effect: 'grant', reason: 'r' })
    await as('root').access.setOverride({ email: other, role: 'finance', effect: 'revoke', reason: 'r' })
    const ids = async (input: { email?: string; role?: string }) =>
      (await as('cxo').access.overrideHistory(input)).map((h) => h.entityId).filter((id) => id.startsWith('rbac-')).sort()
    expect(await ids({ email: TARGET })).toEqual([entityId('finance'), entityId('legal')].sort())
    expect(await ids({ email: ` ${other.toUpperCase()} ` })).toEqual([entityId('finance', other)])
    expect(await ids({ role: 'finance' })).toEqual(expect.arrayContaining([entityId('finance'), entityId('finance', other)]))
    expect(await ids({ role: 'finance' })).not.toContain(entityId('legal'))
    expect(await ids({ email: TARGET, role: 'legal' })).toEqual([entityId('legal')])
    expect(await ids({})).toEqual(expect.arrayContaining([entityId('finance'), entityId('legal'), entityId('finance', other)]))
    expect(await as('cxo').access.overrideHistory({ email: rbacEmail('nobody') })).toEqual([])
  })
  it('does not treat `_` or `%` in an email as a wildcard', async () => {
    await as('root').access.setOverride({ email: 'rbac-a_c@amnex.com', role: 'finance', effect: 'grant', reason: 'r' })
    await as('root').access.setOverride({ email: 'rbac-abc@amnex.com', role: 'finance', effect: 'grant', reason: 'r' })
    expect((await as('cxo').access.overrideHistory({ email: 'rbac-a_c@amnex.com' })).map((h) => h.entityId)).toEqual(['rbac-a_c@amnex.com|finance'])
  })
})

describe('refused attempts write no audit row', () => {
  it('a System Admin target or the system_admin role', async () => {
    await expect(as('root').access.setOverride({ email: rbacEmail('root'), role: 'cxo', effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(as('root').access.setOverride({ email: TARGET, role: 'system_admin' as any, effect: 'grant', reason: 'r' })).rejects.toThrow()
    await setRole('root', 'delivery') // an override row that predates the allow-list entry
    const [row] = await overrideRows(rbacEmail('root'))
    await expect(as('root').access.removeOverride({ id: row.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await overrideRows(rbacEmail('root'))).toHaveLength(1)
    expect(await auditRows()).toEqual([])
  })
  it('a caller who is not a System Admin (IT, CXO, Sales)', async () => {
    const created = await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })
    const before = (await auditRows()).length
    for (const who of ['it', 'cxo', 'sales']) {
      await expect(as(who).access.setOverride({ email: TARGET, role: 'legal', effect: 'grant', reason: 'r' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(as(who).access.removeOverride({ id: created.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect((await auditRows()).length).toBe(before)
    expect(await overrideRows()).toHaveLength(1)
  })
})

describe('the change and its audit rows are one transaction', () => {
  it('a failing audit write rolls back a create', async () => {
    vi.mocked(writeAuditLog).mockImplementationOnce(async () => { throw new Error('audit sink down') })
    await expect(as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })).rejects.toThrow()
    expect(await overrideRows()).toEqual([])
    expect(await auditRows()).toEqual([])
  })
  it('a failing audit write rolls back an update and a removal', async () => {
    const created = await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })
    vi.mocked(writeAuditLog).mockImplementationOnce(async () => { throw new Error('audit sink down') })
    await expect(as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'revoke', reason: 'r' })).rejects.toThrow()
    expect(await overrideRows()).toMatchObject([{ effect: 'grant' }])
    vi.mocked(writeAuditLog).mockImplementationOnce(async () => { throw new Error('audit sink down') })
    await expect(as('root').access.removeOverride({ id: created.id })).rejects.toThrow()
    expect(await overrideRows()).toHaveLength(1)
    expect(await auditRows()).toHaveLength(1) // just the create
  })
  it('the live roles still change at once (cache cleared after the commit)', async () => {
    const { loadUserFacts } = await import('./userFacts.js')
    expect((await loadUserFacts(TARGET)).roles).toEqual([])
    const created = await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })
    expect((await loadUserFacts(TARGET)).roles).toEqual(['finance'])
    await as('root').access.removeOverride({ id: created.id })
    expect((await loadUserFacts(TARGET)).roles).toEqual([])
  })
})

describe('readiness override chips', () => {
  it('carry who set the override and when (createdBy / createdAt), additively', async () => {
    await addOrgPerson('lawyer', ['Legal'])
    await as('root').access.setOverride({ email: rbacEmail('lawyer'), role: 'cxo', effect: 'grant', reason: 'Board' })
    const row = (await as('root').access.readiness()).find((r) => r.name === 'RBAC lawyer')!
    expect(row.overrides).toEqual([expect.objectContaining({ role: 'cxo', effect: 'grant', reason: 'Board', createdBy: rbacEmail('root') })])
    expect(new Date(row.overrides[0].createdAt).toISOString()).toBe(row.overrides[0].createdAt)
    expect(row).toMatchObject({ derivedRoles: ['legal'], effectiveRoles: ['legal', 'cxo'] }) // array shape and existing fields unchanged
  })
})

describe('access.unmatchedOverrides', () => {
  const unmatchedFor = async (email: string, who = 'root') => (await as(who).access.unmatchedOverrides()).filter((o) => o.email === email)

  it('lists an override whose email is in no org / roster / seen / admin row, with who set it, when, role, effect and reason', async () => {
    await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'revoke', reason: 'Left the company' })
    const [o] = await unmatchedFor(TARGET)
    expect(o).toMatchObject({ email: TARGET, role: 'finance', effect: 'revoke', reason: 'Left the company', createdBy: rbacEmail('root') })
    expect(o.id).toEqual(expect.any(String))
    expect(new Date(o.createdAt).toISOString()).toBe(o.createdAt)
    expect(Object.keys(o).sort()).toEqual(['createdAt', 'createdBy', 'effect', 'email', 'id', 'reason', 'role'])
  })
  it('a System Admin can remove it by its id; the removal is audited', async () => {
    await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'stray' })
    const [o] = await unmatchedFor(TARGET)
    await as('root').access.removeOverride({ id: o.id })
    expect(await unmatchedFor(TARGET)).toEqual([])
    expect((await auditRows(entityId('finance'))).map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'remove']))
  })
  it('does NOT list an override for a person who has a readiness row (org, roster, seen, admin), however the email is cased or spaced', async () => {
    await addOrgPerson('orgp', ['Legal'], { email: ` ${rbacEmail('ORGP')} ` })
    await addSalesPerson('seller')
    await pool.query(`INSERT INTO rbac_seen_users (email, role_count, last_seen_at) VALUES ($1, 0, now()) ON CONFLICT (email) DO NOTHING`, [rbacEmail('seenp')])
    makeSystemAdmin('boss')
    for (const label of ['orgp', 'seller', 'seenp']) await as('root').access.setOverride({ email: rbacEmail(label), role: 'finance', effect: 'grant', reason: 'r' })
    await setRole('boss', 'delivery') // an override that predates the allow-list entry (the API refuses to create one)
    const unmatched = (await as('root').access.unmatchedOverrides()).map((o) => o.email)
    for (const label of ['orgp', 'seller', 'seenp', 'boss']) expect(unmatched).not.toContain(rbacEmail(label))
    // the same four really are shown against a person in readiness
    const readiness = await as('root').access.readiness()
    for (const label of ['orgp', 'seller', 'seenp', 'boss']) expect(readiness.find((r) => r.email === rbacEmail(label))?.overrides.length, label).toBeGreaterThan(0)
  })
  it('uses the exact matching readiness uses: a clean delivery-team-only member has no readiness row, so their override is unmatched', async () => {
    await addTeamMember('legal', 'teamonly')
    await as('root').access.setOverride({ email: rbacEmail('teamonly'), role: 'finance', effect: 'grant', reason: 'r' })
    expect((await as('root').access.readiness()).find((r) => r.email === rbacEmail('teamonly'))).toBeUndefined()
    expect(await unmatchedFor(rbacEmail('teamonly'))).toHaveLength(1)
  })
  it('stops being unmatched once the email is bound to a person', async () => {
    await as('root').access.setOverride({ email: rbacEmail('later'), role: 'finance', effect: 'grant', reason: 'r' })
    expect(await unmatchedFor(rbacEmail('later'))).toHaveLength(1)
    await addOrgPerson('later', ['Legal'])
    expect(await unmatchedFor(rbacEmail('later'))).toEqual([])
  })
})

describe('who may read the new queries', () => {
  it('CXO and IT can read unmatchedOverrides and overrideHistory; a Sales caller is refused by RBAC; a signed-out caller is UNAUTHORIZED', async () => {
    await as('root').access.setOverride({ email: TARGET, role: 'finance', effect: 'grant', reason: 'r' })
    for (const who of ['cxo', 'it', 'root']) {
      await expect(as(who).access.unmatchedOverrides()).resolves.toEqual(expect.any(Array))
      await expect(as(who).access.overrideHistory({})).resolves.toEqual(expect.any(Array))
    }
    for (const call of [(c: any) => c.access.unmatchedOverrides(), (c: any) => c.access.overrideHistory({})]) {
      const refused = await call(as('sales')).catch((e: any) => e)
      expect(refused.code).toBe('FORBIDDEN')
      expect(refused.cause).toBeInstanceOf(RbacDenial)
      await expect(call(appRouter.createCaller({}))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }
  })
  it('with RBAC off only an allow-listed System Admin can read them, like every other access.* query', async () => {
    delete process.env.RBAC_MODE
    for (const call of [(c: any) => c.access.unmatchedOverrides(), (c: any) => c.access.overrideHistory({})]) {
      await expect(call(as('root'))).resolves.toEqual(expect.any(Array))
      await expect(call(as('it'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })
  it('both are registered under read(admin.access)', async () => {
    for (const path of ['access.unmatchedOverrides', 'access.overrideHistory']) {
      const entry = PROCEDURE_POLICY[path]
      expect(entry.requirements).toHaveLength(1)
      expect(await entry.requirements[0]({}, {} as any)).toMatchObject({ module: 'admin.access', action: 'read' })
    }
  })
})
