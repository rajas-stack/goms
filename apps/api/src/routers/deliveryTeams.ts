import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

const teamSchema = z.enum(['preSales', 'legal', 'bid'])

function toMember(row: any) {
  return {
    id: row.id,
    team: row.team,
    name: row.name,
    email: row.email,
    status: row.status,
    managerId: row.manager_id ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

async function oneMember(id: string) {
  const result = await pool.query('SELECT * FROM delivery_team_members WHERE id=$1', [id])
  return result.rows[0] ? toMember(result.rows[0]) : null
}

/** Reports-to must be on the same team and must not loop back to `memberId`. */
async function assertValidManager(team: string, memberId: string | null, managerId: string | null) {
  if (!managerId) return
  const manager = await oneMember(managerId)
  if (!manager || manager.team !== team) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a manager from the same team.' })
  }
  if (!memberId) return
  const chain = await pool.query(
    `WITH RECURSIVE up(id, manager_id) AS (
       SELECT id, manager_id FROM delivery_team_members WHERE id=$1
       UNION
       SELECT m.id, m.manager_id FROM delivery_team_members m JOIN up ON m.id = up.manager_id
     )
     SELECT 1 FROM up WHERE id=$2 LIMIT 1`,
    [managerId, memberId],
  )
  if (chain.rowCount) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That would make the reporting line circular.' })
}

export const deliveryTeamsRouter = router({
  list: protectedReadProcedure.input(z.object({ team: teamSchema.optional(), includeInactive: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT * FROM delivery_team_members
         WHERE ($1::text IS NULL OR team=$1) AND ($2::boolean OR status='active')
         ORDER BY name`,
        [input?.team ?? null, input?.includeInactive ?? false],
      )
      return result.rows.map(toMember)
    }),
  create: protectedProcedure.input(z.object({
    team: teamSchema,
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().max(254).optional(),
    managerId: z.string().uuid().nullable().optional(),
  })).mutation(async ({ input }) => {
    await assertValidManager(input.team, null, input.managerId ?? null)
    try {
      const result = await pool.query(
        `INSERT INTO delivery_team_members (team, name, email, manager_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [input.team, input.name, input.email ?? '', input.managerId ?? null],
      )
      return toMember(result.rows[0])
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new TRPCError({ code: 'CONFLICT', message: 'A person with this name is already on the team.' })
      }
      throw error
    }
  }),
  update: protectedProcedure.input(z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().trim().min(1).max(200).optional(),
      email: z.string().trim().max(254).optional(),
      managerId: z.string().uuid().nullable().optional(),
    }),
  })).mutation(async ({ input }) => {
    const fields = Object.keys(input.patch)
    if (!fields.length) return oneMember(input.id)
    if (input.patch.managerId !== undefined) {
      const member = await oneMember(input.id)
      if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team member no longer exists.' })
      await assertValidManager(member.team, member.id, input.patch.managerId)
    }
    const columns: Record<string, string> = { name: 'name', email: 'email', managerId: 'manager_id' }
    const values: (string | null)[] = fields.map((field) => (input.patch as Record<string, string | null>)[field])
    const clauses = fields.map((field, index) => `${columns[field]}=$${index + 1}`)
    values.push(input.id)
    try {
      await pool.query(`UPDATE delivery_team_members SET ${clauses.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new TRPCError({ code: 'CONFLICT', message: 'A person with this name is already on the team.' })
      }
      throw error
    }
    return oneMember(input.id)
  }),
  setStatus: protectedProcedure.input(z.object({ id: z.string().uuid(), status: z.enum(['active', 'inactive']) }))
    .mutation(async ({ input }) => {
      await pool.query('UPDATE delivery_team_members SET status=$1, updated_at=now() WHERE id=$2', [input.status, input.id])
    }),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query('DELETE FROM delivery_team_members WHERE id=$1', [input.id])
  }),
})