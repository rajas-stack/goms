import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

const asUser = () => appRouter.createCaller({ user: { email: 'tester@amnex.com' } } as any)
const MIGRATION = new URL('../../migrations/1790700000000_org-people.sql', import.meta.url)

/** Wipes org + the three mirrored team rosters, then replays the migration's own seed + sync SQL verbatim. */
async function reseedFromMigration() {
  const up = readFileSync(MIGRATION, 'utf8').split('-- Down Migration')[0]
  const seedSql = up.slice(up.indexOf('CREATE TEMP TABLE org_seed'))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM delivery_team_members')
    await client.query('DELETE FROM org_people')
    await client.query(seedSql)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

const team = async (key: string) => (await pool.query('SELECT * FROM delivery_team_members WHERE team=$1', [key])).rows
const person = async (name: string) => (await pool.query('SELECT * FROM org_people WHERE lower(name)=lower($1)', [name])).rows[0]
const nameOf = async (id: string | null) => (id ? (await pool.query('SELECT name FROM delivery_team_members WHERE id=$1', [id])).rows[0]?.name : null)

describe('org chart seed (the migration\'s own SQL)', () => {
  beforeEach(reseedFromMigration)

  it('seeds the whole company chart: 50 people, one chairman at the top', async () => {
    const people = await appRouter.createCaller({}).orgPeople.list()
    expect(people).toHaveLength(50)
    expect(people[0]).toMatchObject({ name: 'Aditya Shah', designation: 'Chairman', level: 0, managerId: null, status: 'active' })
    const byLevel = people.reduce<Record<number, number>>((m, p: any) => ({ ...m, [p.level]: (m[p.level] ?? 0) + 1 }), {})
    expect(byLevel).toEqual({ 0: 1, 1: 4, 2: 5, 3: 17, 4: 17, 5: 6 })
    // the list is ordered level-first, then by name
    const sorted = [...people].sort((a: any, b: any) => a.level - b.level || a.name.localeCompare(b.name))
    expect(people.map((p: any) => p.id)).toEqual(sorted.map((p: any) => p.id))
  })

  it('every reports-to is a strictly higher level, and only the chairman has none', async () => {
    const people = (await appRouter.createCaller({}).orgPeople.list()) as any[]
    const byId = new Map(people.map((p) => [p.id, p]))
    for (const p of people) {
      if (p.managerId === null) { expect(p.name).toBe('Aditya Shah'); continue }
      expect(byId.get(p.managerId).level).toBeLessThan(p.level)
    }
  })

  it('carries the designations from the supplied sheet', async () => {
    const get = async (n: string) => (await person(n)).designation
    expect(await get('Rajas Saji')).toBe('Associate Developer')
    expect(await get('Utkarsh Raval')).toBe('Lead Analyst')
    expect(await get('Kampan Vyas')).toBe('Deputy Manager')
    expect(await get('Milap Shah')).toBe('Senior Analyst')
    expect(await get('Denish')).toBe('CFO – Finance & Legal')
    expect(await get('Shamik Joshi')).toBe('Head – Bid & Pre-Sales; Chief of Strategy')
  })

  it('mirrors Pre-Sales (23), Bid (6) and Legal (7) with the right reporting lines', async () => {
    expect(await team('preSales')).toHaveLength(23)
    expect(await team('bid')).toHaveLength(6)
    expect(await team('legal')).toHaveLength(7)
    const legal = await team('legal')
    const boss = async (n: string) => nameOf(legal.find((m: any) => m.name === n).manager_id)
    expect(await boss('Utpal Gandhi')).toBeNull() // the chairman is not on the Legal team
    expect(await boss('Denish')).toBe('Utpal Gandhi')
    expect(await boss('Karan Shah')).toBe('Denish')
    expect(await boss('Sharon Itagi')).toBe('Karan Shah')
    const bid = await team('bid')
    expect(await nameOf(bid.find((m: any) => m.name === 'Dharmesh Dhamecha').manager_id)).toBe('Shamik Joshi')
    // Shamik heads both orgs, so he is on both rosters; nobody outside the three departments is mirrored
    expect((await team('preSales')).some((m: any) => m.name === 'Shamik Joshi')).toBe(true)
    expect(bid.some((m: any) => m.name === 'Shamik Joshi')).toBe(true)
    expect((await pool.query("SELECT 1 FROM delivery_team_members WHERE name='Damodaran C'")).rowCount).toBe(0)
  })

  it('is idempotent: running the sync again changes nothing', async () => {
    const snap = async () => JSON.stringify((await pool.query('SELECT id, team, name, designation, status, manager_id, org_person_id, updated_at FROM delivery_team_members ORDER BY id')).rows)
    const before = await snap()
    await pool.query('SELECT sync_delivery_teams_from_org()')
    expect(await snap()).toBe(before)
  })

  it('keeps existing member ids and fills in designations when the roster was seeded earlier by name', async () => {
    await pool.query('DELETE FROM delivery_team_members')
    await pool.query("DELETE FROM org_people")
    // an older roster row, no org link, wrong title
    const old = await pool.query("INSERT INTO delivery_team_members (team, name, designation) VALUES ('preSales','Rajas Saji','') RETURNING id")
    const up = readFileSync(MIGRATION, 'utf8').split('-- Down Migration')[0]
    const client = await pool.connect()
    try { await client.query('BEGIN'); await client.query(up.slice(up.indexOf('CREATE TEMP TABLE org_seed'))); await client.query('COMMIT') } finally { client.release() }
    const row = (await pool.query("SELECT * FROM delivery_team_members WHERE team='preSales' AND name='Rajas Saji'")).rows
    expect(row).toHaveLength(1)
    expect(row[0].id).toBe(old.rows[0].id)
    expect(row[0].designation).toBe('Associate Developer')
    expect(row[0].org_person_id).not.toBeNull()
  })
})

describe('orgPeople router', () => {
  beforeEach(reseedFromMigration)

  it('create adds a person, mirrors them into their team and reports to the nearest ancestor on that team', async () => {
    const denish = await person('Denish')
    const created = await asUser().orgPeople.create({ name: 'Test Lawyer', designation: 'Associate', level: 4, departments: ['Legal'], managerId: denish.id })
    expect(created).toMatchObject({ name: 'Test Lawyer', level: 4, departments: ['Legal'], managerId: denish.id, status: 'active' })
    const member = (await team('legal')).find((m: any) => m.name === 'Test Lawyer')
    expect(member).toBeTruthy()
    expect(member.org_person_id).toBe(created.id)
    expect(member.designation).toBe('Associate')
    expect(await nameOf(member.manager_id)).toBe('Denish')
  })

  it('create rejects a duplicate name (any case), an unknown manager, and a manager at the same or a lower level', async () => {
    const denish = await person('Denish') // L2
    await expect(asUser().orgPeople.create({ name: 'denish', level: 3, departments: [] })).rejects.toThrow(/already in the org/i)
    await expect(asUser().orgPeople.create({ name: 'X One', level: 3, departments: [], managerId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/no longer exists/i)
    await expect(asUser().orgPeople.create({ name: 'X Two', level: 2, departments: [], managerId: denish.id })).rejects.toThrow(/L2 can only report to someone above L2/)
    expect(await person('X Two')).toBeUndefined()
  })

  it('update flows a new designation and department into the team roster and keeps the member id', async () => {
    const karan = await person('Karan Shah')
    const memberBefore = (await team('legal')).find((m: any) => m.name === 'Karan Shah')
    await asUser().orgPeople.update({ id: karan.id, patch: { designation: 'Senior Manager' } })
    const memberAfter = (await team('legal')).find((m: any) => m.name === 'Karan Shah')
    expect(memberAfter.id).toBe(memberBefore.id)
    expect(memberAfter.designation).toBe('Senior Manager')
    // moving him out of Legal turns his roster entry inactive instead of deleting it
    await asUser().orgPeople.update({ id: karan.id, patch: { departments: ['Finance'] } })
    const moved = (await team('legal')).find((m: any) => m.name === 'Karan Shah')
    expect(moved.id).toBe(memberBefore.id)
    expect(moved.status).toBe('inactive')
    expect(moved.manager_id).toBeNull()
    // his report now reports to the nearest Legal ancestor above him
    const sharon = (await team('legal')).find((m: any) => m.name === 'Sharon Itagi')
    expect(await nameOf(sharon.manager_id)).toBe('Denish')
  })

  it('update refuses a circular reporting line and a level change that breaks a report', async () => {
    const denish = await person('Denish'), karan = await person('Karan Shah')
    await expect(asUser().orgPeople.update({ id: denish.id, patch: { managerId: karan.id } })).rejects.toThrow(/above L2|circular/i)
    // Karan (L3) has Sharon (L4) reporting to him: he cannot drop to L4
    await expect(asUser().orgPeople.update({ id: karan.id, patch: { level: 4 } })).rejects.toThrow(/Sharon Itagi/)
    expect((await person('Karan Shah')).level).toBe(3)
  })

  it('update refuses renaming onto an existing person', async () => {
    const karan = await person('Karan Shah')
    await expect(asUser().orgPeople.update({ id: karan.id, patch: { name: 'DENISH' } })).rejects.toThrow(/already in the org/i)
  })

  it('delete reparents their reports to their manager and deactivates their roster entry', async () => {
    const karan = await person('Karan Shah'), denish = await person('Denish')
    await asUser().orgPeople.delete({ id: karan.id })
    expect(await person('Karan Shah')).toBeUndefined()
    expect((await person('Sharon Itagi')).manager_id).toBe(denish.id)
    const legal = await team('legal')
    expect(legal.find((m: any) => m.name === 'Karan Shah').status).toBe('inactive')
    expect(await nameOf(legal.find((m: any) => m.name === 'Sharon Itagi').manager_id)).toBe('Denish')
  })

  it('requires sign-in for reads and writes when auth enforcement is on (as in production)', async () => {
    const was = { w: process.env.AUTH_ENFORCEMENT_ENABLED, r: process.env.READ_AUTH_ENFORCEMENT_ENABLED }
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    try {
      const anon = appRouter.createCaller({})
      await expect(anon.orgPeople.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      await expect(anon.orgPeople.create({ name: 'Nobody', level: 3, departments: [] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      const person0 = await person('Karan Shah')
      await expect(anon.orgPeople.update({ id: person0.id, patch: { designation: 'Hacked' } })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      await expect(anon.orgPeople.delete({ id: person0.id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(await person('Nobody')).toBeUndefined()
      expect((await person('Karan Shah')).designation).toBe('Assistant Manager')
    } finally {
      if (was.w === undefined) delete process.env.AUTH_ENFORCEMENT_ENABLED; else process.env.AUTH_ENFORCEMENT_ENABLED = was.w
      if (was.r === undefined) delete process.env.READ_AUTH_ENFORCEMENT_ENABLED; else process.env.READ_AUTH_ENFORCEMENT_ENABLED = was.r
    }
  })

  it('never touches the Sales team: sales_persons and postings are byte-identical after org edits', async () => {
    const snap = async () => JSON.stringify([
      (await pool.query('SELECT * FROM sales_persons ORDER BY id')).rows,
      (await pool.query('SELECT * FROM sales_postings ORDER BY id')).rows,
    ])
    const before = await snap()
    const jp = await person('JP')
    await asUser().orgPeople.update({ id: jp.id, patch: { designation: 'Head of Sales' } })
    await asUser().orgPeople.create({ name: 'Sales Newbie', level: 3, departments: ['Sales'], managerId: jp.id })
    await asUser().orgPeople.delete({ id: (await person('Sales Newbie')).id })
    expect(await snap()).toBe(before)
    // 'Sales' is an org department only: it never becomes a mirrored delivery team
    expect((await pool.query("SELECT DISTINCT team FROM delivery_team_members ORDER BY 1")).rows.map((r: any) => r.team)).toEqual(['bid', 'legal', 'preSales'])
  })
})
