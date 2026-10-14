import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  COMPETITOR_LIMITS, COMPETITOR_LIST_LIMITS, COMPETITOR_LOGO_DATA_URL_MAX, COMPETITOR_RELATIONSHIPS, normalizeCompetitorInput,
  type Competitor, type CompetitorInput, type CompetitorListField, type NormalizedCompetitorInput,
} from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { writeAuditLog } from '../lib/auditLog.js'

/** Generous outer bounds only; the domain rules give the user-facing messages. */
const tagList = (field: CompetitorListField) =>
  z.array(z.string().max(COMPETITOR_LIST_LIMITS[field].each * 2)).max(COMPETITOR_LIST_LIMITS[field].max * 2).optional()

const competitorShape = z.object({
  name: z.string().max(COMPETITOR_LIMITS.name * 2),
  logo: z.string().max(COMPETITOR_LOGO_DATA_URL_MAX + 64).nullable().optional(),
  website: z.string().max(COMPETITOR_LIMITS.url + 16).nullable().optional(),
  relationship: z.enum(COMPETITOR_RELATIONSHIPS).optional(),
  category: z.string().max(COMPETITOR_LIMITS.category * 2).nullable().optional(),
  subCategories: tagList('subCategories'),
  verticals: tagList('verticals'),
  certifications: tagList('certifications'),
  offerings: tagList('offerings'),
  strengths: tagList('strengths'),
  description: z.string().max(COMPETITOR_LIMITS.description * 2).nullable().optional(),
})

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

function toCompetitor(row: any): Competitor {
  return {
    id: String(row.id), name: row.name, logo: row.logo ?? null, website: row.website ?? null,
    relationship: row.relationship ?? 'competitor', category: row.category ?? '',
    subCategories: list(row.sub_categories), verticals: list(row.verticals), certifications: list(row.certifications),
    offerings: list(row.offerings), strengths: list(row.strengths), description: row.description ?? '',
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** Column values in the order of COLUMNS. */
const COLUMNS = 'name, logo, website, relationship, category, sub_categories, verticals, certifications, offerings, strengths, description'
const ASSIGNMENTS = COLUMNS.split(', ').map((column, i) => `${column}=$${i + 1}`).join(', ')
const values = (c: NormalizedCompetitorInput) => [
  c.name, c.logo, c.website, c.relationship, c.category, c.subCategories, c.verticals, c.certifications, c.offerings, c.strengths, c.description,
]

/** Same rules as the local store. */
function clean(input: CompetitorInput): NormalizedCompetitorInput {
  try { return normalizeCompetitorInput(input) } catch (error) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Invalid competitor.' })
  }
}

function duplicateName(name: string): TRPCError {
  return new TRPCError({ code: 'CONFLICT', message: `A competitor named "${name}" already exists.` })
}

async function audit(entityId: string, action: string, value: string, changedBy?: string | null) {
  await writeAuditLog(pool, { entityType: 'competitor', entityId, field: 'competitor', oldValue: '', newValue: value, reason: '', action, changedBy })
    .catch(() => { console.error(JSON.stringify({ event: 'competitor_audit_failed', entityId, action })) })
}

export const competitorsRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM competitors ORDER BY lower(name)')
    return result.rows.map(toCompetitor)
  }),

  create: protectedProcedure.input(competitorShape).mutation(async ({ input, ctx }) => {
    const item = clean(input)
    try {
      const result = await pool.query(
        `INSERT INTO competitors (${COLUMNS}, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [...values(item), ctx.user?.email ?? null],
      )
      await audit(result.rows[0].id, 'create', item.name, ctx.user?.email)
      return toCompetitor(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(item.name)
      throw error
    }
  }),

  update: protectedProcedure.input(competitorShape.extend({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const item = clean(input)
    try {
      const result = await pool.query(
        `UPDATE competitors SET ${ASSIGNMENTS}, updated_at=now()
         WHERE id=$12 RETURNING *`,
        [...values(item), input.id],
      )
      if (!result.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'That competitor no longer exists.' })
      await audit(input.id, 'update', item.name, ctx.user?.email)
      return toCompetitor(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(item.name)
      throw error
    }
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const result = await pool.query('DELETE FROM competitors WHERE id=$1 RETURNING id', [input.id])
    if (!result.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'That competitor no longer exists.' })
    await audit(input.id, 'delete', '', ctx.user?.email)
  }),
})
