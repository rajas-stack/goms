import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PoolClient } from 'pg'
import { DEPARTMENT_NAME_MAX, SYSTEM_DEPARTMENT_LOCKED, normalizeDepartmentName, type AmnexDepartment } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { writeAuditLog } from '../lib/auditLog.js'

// Settings > Masters > Employee Master > Amnex Departments. org_people.departments stores names, so a rename or delete of a
// custom department rewrites them in the same transaction (org edits are serialised by the org_people lock, like
// routers/orgPeople.ts). System departments (system_key set) derive roles and rosters: never renamed or deleted.

function toDepartment(row: any): AmnexDepartment {
  return {
    id: String(row.id), name: row.name, systemKey: row.system_key ?? null, sortOrder: Number(row.sort_order),
    employeeCount: Number(row.employee_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }
}

const SELECT = `SELECT d.*, (SELECT count(*) FROM org_people p WHERE lower(btrim(d.name)) IN (SELECT lower(btrim(x)) FROM unnest(p.departments) x)) AS employee_count
  FROM amnex_departments d`

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })
const duplicate = (name: string) => new TRPCError({ code: 'CONFLICT', message: `"${name}" is already a department.` })
const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'That department no longer exists.' })

function cleanName(raw: string): string {
  try { return normalizeDepartmentName(raw) } catch (error) { throw bad((error as Error).message) }
}

async function audit(entityId: string, action: string, oldValue: string, newValue: string, changedBy?: string | null) {
  await writeAuditLog(pool, { entityType: 'amnex_department', entityId, field: 'name', oldValue, newValue, reason: '', action, changedBy })
    .catch(() => { console.error(JSON.stringify({ event: 'amnex_department_audit_failed', entityId, action })) })
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE org_people IN SHARE ROW EXCLUSIVE MODE')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function lockedRow(client: PoolClient, id: string) {
  const row = (await client.query('SELECT * FROM amnex_departments WHERE id=$1 FOR UPDATE', [id])).rows[0]
  if (!row) throw notFound()
  if (row.system_key) throw bad(SYSTEM_DEPARTMENT_LOCKED)
  return row
}

const loadOne = async (client: PoolClient | typeof pool, id: string) => toDepartment((await client.query(`${SELECT} WHERE d.id=$1`, [id])).rows[0])
const nameInput = z.string().max(DEPARTMENT_NAME_MAX * 2)

export const amnexDepartmentsRouter = router({
  list: protectedReadProcedure.query(async () =>
    (await pool.query(`${SELECT} ORDER BY d.sort_order, lower(d.name)`)).rows.map(toDepartment)),

  create: protectedProcedure.input(z.object({ name: nameInput })).mutation(async ({ input, ctx }) => {
    const name = cleanName(input.name)
    try {
      const row = (await pool.query(
        `INSERT INTO amnex_departments (name, sort_order, created_by)
         VALUES ($1, COALESCE((SELECT max(sort_order) + 1 FROM amnex_departments), 0), $2) RETURNING id`,
        [name, ctx.user?.email ?? null],
      )).rows[0]
      await audit(row.id, 'create', '', name, ctx.user?.email)
      return loadOne(pool, row.id)
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate(name)
      throw error
    }
  }),

  rename: protectedProcedure.input(z.object({ id: z.string().uuid(), name: nameInput })).mutation(async ({ input, ctx }) => {
    const name = cleanName(input.name)
    try {
      const result = await inTransaction(async (client) => {
        const row = await lockedRow(client, input.id)
        if (row.name === name) return { department: await loadOne(client, input.id), old: row.name as string }
        await client.query('UPDATE amnex_departments SET name=$2, updated_at=now() WHERE id=$1', [input.id, name])
        await client.query(
          // Replace the old name in place (order kept), dropping any later duplicate of the new name.
          `UPDATE org_people SET departments = ARRAY(
             SELECT v FROM (
               SELECT v, ord, row_number() OVER (PARTITION BY lower(btrim(v)) ORDER BY ord) AS n
               FROM unnest(departments) WITH ORDINALITY AS u(x, ord),
                    LATERAL (SELECT CASE WHEN lower(btrim(x)) = lower(btrim($1)) THEN $2 ELSE x END AS v) r
             ) s WHERE n = 1 ORDER BY ord), updated_at=now()
           WHERE lower(btrim($1)) IN (SELECT lower(btrim(x)) FROM unnest(departments) x)`,
          [row.name, name],
        )
        return { department: await loadOne(client, input.id), old: row.name as string }
      })
      if (result.old !== name) await audit(input.id, 'rename', result.old, name, ctx.user?.email)
      return result.department
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate(name)
      throw error
    }
  }),

  reorder: protectedProcedure.input(z.object({ ids: z.array(z.string().uuid()).max(500) })).mutation(async ({ input }) => {
    await pool.query(
      `UPDATE amnex_departments d SET sort_order = o.ord - 1, updated_at = now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord) WHERE d.id = o.id AND d.sort_order <> o.ord - 1`,
      [input.ids],
    )
    return (await pool.query(`${SELECT} ORDER BY d.sort_order, lower(d.name)`)).rows.map(toDepartment)
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const removed = await inTransaction(async (client) => {
      const row = await lockedRow(client, input.id)
      const updated = await client.query(
        `UPDATE org_people SET departments = ARRAY(SELECT x FROM unnest(departments) x WHERE lower(btrim(x)) <> lower(btrim($1))), updated_at=now()
         WHERE lower(btrim($1)) IN (SELECT lower(btrim(x)) FROM unnest(departments) x)`,
        [row.name],
      )
      await client.query('DELETE FROM amnex_departments WHERE id=$1', [input.id])
      return { name: row.name as string, employees: updated.rowCount ?? 0 }
    })
    await audit(input.id, 'delete', removed.name, '', ctx.user?.email)
    return { removedFromEmployees: removed.employees }
  }),
})
