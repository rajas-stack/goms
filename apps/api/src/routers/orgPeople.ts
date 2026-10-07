import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PoolClient } from 'pg'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

// Org Structure: the company chart. Pre-Sales / Bid / Legal rosters are mirrored from it by the
// sync_delivery_teams_from_org() SQL function, which every mutation runs in the same transaction.
// The Sales team (sales_persons) is a separate roster and is never read or written here.
// The reporting rules mirror src/data/org-structure.ts (managerProblem / reportsBrokenByLevel).

interface OrgRow { id: string; name: string; level: number; manager_id: string | null }

const levelLabel = (level: number) => `L${level}`
const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })

function toPerson(row: any) {
  return {
    id: row.id as string,
    name: row.name as string,
    designation: row.designation as string,
    level: row.level as number,
    departments: (row.departments ?? []) as string[],
    managerId: (row.manager_id ?? null) as string | null,
    email: row.email as string,
    status: row.status as 'active' | 'inactive',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/** Everyone under `id` (any depth), including `id` itself. */
function descendantsOf(id: string, people: OrgRow[]): Set<string> {
  const found = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of people) {
      if (p.manager_id && found.has(p.manager_id) && !found.has(p.id)) { found.add(p.id); grew = true }
    }
  }
  return found
}

/** Why `managerId` can't be `person`'s manager, or null when it can. */
function managerProblem(person: { id: string; level: number }, managerId: string | null, people: OrgRow[]): string | null {
  if (!managerId) return null
  const manager = people.find((p) => p.id === managerId)
  if (!manager) return 'That manager no longer exists.'
  if (manager.level >= person.level) return `A ${levelLabel(person.level)} can only report to someone above ${levelLabel(person.level)}.`
  if (descendantsOf(person.id, people).has(managerId)) return 'That would make the reporting line circular.'
  return null
}

/** Runs `fn` in a transaction with org edits serialised, then re-mirrors the three team rosters. */
async function inOrgTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE org_people IN SHARE ROW EXCLUSIVE MODE')
    const result = await fn(client)
    await client.query('SELECT sync_delivery_teams_from_org()')
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const loadPeople = async (client: PoolClient): Promise<OrgRow[]> =>
  (await client.query('SELECT id, name, level, manager_id FROM org_people')).rows
const nameTaken = async (client: PoolClient, name: string, exceptId: string | null) =>
  (await client.query('SELECT 1 FROM org_people WHERE lower(btrim(name))=lower(btrim($1)) AND ($2::uuid IS NULL OR id<>$2)', [name, exceptId])).rowCount! > 0

const name = z.string().trim().min(1, 'Enter the employee name.').max(200)
const departments = z.array(z.string().trim().min(1).max(80)).max(12)

export const orgPeopleRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM org_people ORDER BY level, lower(name)')
    return result.rows.map(toPerson)
  }),

  create: protectedProcedure.input(z.object({
    name,
    designation: z.string().trim().max(200).optional(),
    level: z.number().int().min(0).max(7),
    departments: departments.optional(),
    managerId: z.string().uuid().nullable().optional(),
    email: z.string().trim().max(254).optional(),
  })).mutation(({ input }) => inOrgTransaction(async (client) => {
    if (await nameTaken(client, input.name, null)) throw new TRPCError({ code: 'CONFLICT', message: 'Someone with this name is already in the org.' })
    const people = await loadPeople(client)
    const problem = managerProblem({ id: '', level: input.level }, input.managerId ?? null, people)
    if (problem) throw bad(problem)
    const result = await client.query(
      `INSERT INTO org_people (name, designation, level, departments, manager_id, email)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.name, input.designation ?? '', input.level, [...new Set(input.departments ?? [])], input.managerId ?? null, input.email ?? ''],
    )
    return toPerson(result.rows[0])
  })),

  update: protectedProcedure.input(z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: name.optional(),
      designation: z.string().trim().max(200).optional(),
      email: z.string().trim().max(254).optional(),
      level: z.number().int().min(0).max(7).optional(),
      departments: departments.optional(),
      managerId: z.string().uuid().nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }),
  })).mutation(({ input }) => inOrgTransaction(async (client) => {
    const current = (await client.query('SELECT * FROM org_people WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'This person is no longer in the org.' })
    const p = input.patch
    const next = {
      name: p.name ?? current.name,
      designation: p.designation ?? current.designation,
      email: p.email ?? current.email,
      level: p.level ?? current.level,
      departments: p.departments !== undefined ? [...new Set(p.departments)] : current.departments,
      managerId: p.managerId !== undefined ? p.managerId : current.manager_id,
      status: p.status ?? current.status,
    }
    if (await nameTaken(client, next.name, input.id)) throw new TRPCError({ code: 'CONFLICT', message: 'Someone with this name is already in the org.' })
    const people = (await loadPeople(client)).map((o) => (o.id === input.id ? { ...o, level: next.level, manager_id: next.managerId } : o))
    const problem = managerProblem({ id: input.id, level: next.level }, next.managerId, people)
    if (problem) throw bad(problem)
    const broken = people.filter((o) => o.manager_id === input.id && o.level <= next.level)
    if (broken.length) throw bad(`${broken.map((o) => o.name).join(', ')} would report to someone at their own level or below — move them first.`)
    const result = await client.query(
      `UPDATE org_people SET name=$2, designation=$3, email=$4, level=$5, departments=$6, manager_id=$7, status=$8, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [input.id, next.name, next.designation, next.email, next.level, next.departments, next.managerId, next.status],
    )
    return toPerson(result.rows[0])
  })),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => inOrgTransaction(async (client) => {
    const person = (await client.query('SELECT id, manager_id FROM org_people WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
    if (!person) return
    // their reports move up to their manager; their roster entries go inactive rather than disappearing
    await client.query('UPDATE org_people SET manager_id=$2, updated_at=now() WHERE manager_id=$1', [input.id, person.manager_id])
    await client.query(`UPDATE delivery_team_members SET status='inactive', manager_id=NULL, updated_at=now() WHERE org_person_id=$1`, [input.id])
    await client.query('DELETE FROM org_people WHERE id=$1', [input.id])
  })),
})
