import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'

const shape = z.object({
  name: z.string().trim().min(1).max(200), level: z.number().int().min(0).max(7),
  designation: z.string().trim().max(200).default(''), departments: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  managerId: z.string().max(200).nullable().default(null), email: z.string().trim().max(254).default(''),
})
const idShape = z.string().min(1).max(200)
function person(row: any) {
  return { id: String(row.id), name: String(row.name), designation: String(row.designation), level: Number(row.level),
    departments: row.departments as string[], managerId: row.manager_id as string | null, email: String(row.email),
    status: row.status as 'active' | 'inactive', createdAt: new Date(row.created_at).toISOString() }
}

/** Retain team-member IDs so existing opportunity assignments keep resolving. */
async function syncTeams(client: import('pg').PoolClient) {
  await client.query(`UPDATE delivery_team_members m SET name=p.name, email=p.email, designation=p.designation,
    status=CASE WHEN p.status='active' AND CASE m.team WHEN 'preSales' THEN 'Pre-Sales'
      WHEN 'bid' THEN 'Bid Management' WHEN 'legal' THEN 'Legal' END=ANY(p.departments)
      THEN 'active' ELSE 'inactive' END, updated_at=now()
    FROM org_people p WHERE m.org_person_id=p.id`)
  await client.query(`INSERT INTO delivery_team_members (team, name, email, designation, org_person_id)
    SELECT teams.team, p.name, p.email, p.designation, p.id FROM org_people p
    JOIN (VALUES ('preSales','Pre-Sales'),('bid','Bid Management'),('legal','Legal')) AS teams(team, department)
      ON teams.department=ANY(p.departments) WHERE p.status='active'
    ON CONFLICT (team, name) DO UPDATE SET email=EXCLUDED.email, designation=EXCLUDED.designation,
      org_person_id=EXCLUDED.org_person_id, status='active', updated_at=now()`)
  await client.query(`UPDATE delivery_team_members m SET manager_id=(
    SELECT boss.id FROM delivery_team_members boss WHERE boss.team=m.team
      AND boss.org_person_id=p.manager_id AND boss.status='active'
    ), updated_at=now() FROM org_people p WHERE m.org_person_id=p.id`)
}

async function editDirectory<T>(edit: (client: import('pg').PoolClient, people: ReturnType<typeof person>[]) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('goms-org-directory'))")
    const result = await client.query('SELECT * FROM org_people FOR UPDATE')
    const value = await edit(client, result.rows.map(person))
    await syncTeams(client)
    await client.query('COMMIT')
    return value
  } catch (cause) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(cause)) throw new TRPCError({ code: 'CONFLICT', message: 'Someone with this name is already in the org.' })
    throw cause
  } finally { client.release() }
}

function validateReporting(next: { id: string; level: number; managerId: string | null }, people: ReturnType<typeof person>[]) {
  const manager = people.find(p => p.id === next.managerId)
  if (next.managerId && (!manager || manager.level >= next.level || manager.id === next.id)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Select a manager above L${next.level}.` })
  }
  if (people.some(p => p.managerId === next.id && p.level <= next.level)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Move direct reports to a higher manager before changing this level.' })
  }
}

export const orgPeopleRouter = router({
  list: protectedReadProcedure.query(async () => (await pool.query('SELECT * FROM org_people ORDER BY level, lower(name)')).rows.map(person)),
  create: protectedProcedure.input(shape).mutation(({ input }) => editDirectory(async (client, people) => {
    validateReporting({ id: '', level: input.level, managerId: input.managerId }, people)
    const result = await client.query(`INSERT INTO org_people (name, level, designation, departments, manager_id, email)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [input.name, input.level, input.designation, [...new Set(input.departments)], input.managerId, input.email])
    return person(result.rows[0])
  })),
  update: protectedProcedure.input(z.object({ id: idShape, patch: shape.partial().extend({ status: z.enum(['active', 'inactive']).optional() }) }))
    .mutation(({ input }) => editDirectory(async (client, people) => {
      const current = people.find(p => p.id === input.id)
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'This person is no longer in the org.' })
      const next = { ...current, ...input.patch }
      validateReporting(next, people)
      const result = await client.query(`UPDATE org_people SET name=$1, level=$2, designation=$3, departments=$4,
        manager_id=$5, email=$6, status=$7 WHERE id=$8 RETURNING *`,
      [next.name, next.level, next.designation, [...new Set(next.departments)], next.managerId, next.email, next.status, input.id])
      return person(result.rows[0])
    })),
  delete: protectedProcedure.input(z.object({ id: idShape })).mutation(({ input }) => editDirectory(async (client, people) => {
    const current = people.find(p => p.id === input.id)
    if (!current) return
    await client.query('UPDATE org_people SET manager_id=$1 WHERE manager_id=$2', [current.managerId, input.id])
    await client.query('UPDATE tender_websites SET dsc_employee_id=NULL WHERE dsc_employee_id=$1', [input.id])
    await client.query("UPDATE delivery_team_members SET status='inactive', manager_id=NULL WHERE org_person_id=$1", [input.id])
    await client.query('DELETE FROM org_people WHERE id=$1', [input.id])
  })),
})
