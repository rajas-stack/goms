import { credentialEnvelope, credentialTransaction, validateManagedCredential } from '../lib/credentialPassphrases.js'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { normalizeTenderWebsiteInput, TENDER_WEBSITE_KINDS, TENDER_WEBSITE_NAME_MAX, TENDER_WEBSITE_URL_MAX, type TenderWebsite, type TenderWebsiteInput } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { writeAuditLog } from '../lib/auditLog.js'

const kindShape = z.enum(TENDER_WEBSITE_KINDS)

const websiteShape = z.object({
  name: z.string().max(TENDER_WEBSITE_NAME_MAX * 2), url: z.string().max(TENDER_WEBSITE_URL_MAX),
  credentials: credentialEnvelope.nullable().optional(),
  dscEmployeeId: z.string().uuid().nullable().optional(),
})

/** Create picks the Settings page; update never moves a website between pages. */
const createShape = websiteShape.extend({ kind: kindShape.optional() })

function toWebsite(row: any): TenderWebsite {
  return { id: row.id, ...(row.kind !== undefined ? { kind: row.kind } : {}), name: row.name, url: row.url, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.credentials !== undefined ? { credentials: row.credentials } : {}),
    ...(row.dsc_employee_id !== undefined ? { dscEmployeeId: row.dsc_employee_id } : {}),
    ...(row.editing_locked !== undefined ? { editingLocked: row.editing_locked } : {}),
  }
}

async function validateDsc(employeeId: string | null | undefined) {
  if (!employeeId) return
  const result = await pool.query("SELECT id FROM org_people WHERE id=$1 AND status='active' AND level IN (0,1,2)", [employeeId])
  if (!result.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select an active employee at L0, L1, or L2 for DSC.' })
}

/** Same rules as the local store: trimmed name, absolute http(s) link only. */
function clean(input: TenderWebsiteInput): TenderWebsiteInput {
  try { return normalizeTenderWebsiteInput(input) } catch (error) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Invalid website.' })
  }
}

function duplicateName(name: string): TRPCError {
  return new TRPCError({ code: 'CONFLICT', message: `A website named "${name}" already exists.` })
}

async function audit(entityId: string, action: string, value: string, changedBy?: string | null) {
  await writeAuditLog(pool, { entityType: 'tenderWebsite', entityId, field: 'website', oldValue: '', newValue: value, reason: '', action, changedBy })
    .catch(() => undefined) // best-effort, never blocks the change itself
}

export const tenderWebsitesRouter = router({
  dscEmployees: protectedReadProcedure.query(async () => {
    const result = await pool.query("SELECT id, name, level FROM org_people WHERE status='active' AND level IN (0,1,2) ORDER BY level, lower(name)")
    return result.rows.map((row: any) => ({ id: String(row.id), name: String(row.name), level: Number(row.level) }))
  }),
  list: protectedReadProcedure.input(z.object({ kind: kindShape }).optional()).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM tender_websites WHERE kind=$1 ORDER BY lower(name)', [input?.kind ?? 'tender'])
    return result.rows.map(toWebsite)
  }),

  create: protectedProcedure.input(createShape).mutation(async ({ input, ctx }) => {
    const site = clean(input)
    await validateDsc(site.dscEmployeeId)
    try {
      const write = (db: Pick<typeof pool, 'query'>) => db.query(
        'INSERT INTO tender_websites (name, url, created_by, credentials, dsc_employee_id, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [site.name, site.url, ctx.user?.email ?? null, site.credentials ?? null, site.dscEmployeeId ?? null, site.kind ?? 'tender'],
      )
      const result = site.credentials?.passphraseId ? await credentialTransaction(async client => {
        await validateManagedCredential(client, site.credentials)
        return write(client)
      }) : await write(pool)
      await audit(result.rows[0].id, 'create', `${site.name} ${site.url}`, ctx.user?.email)
      return toWebsite(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(site.name)
      throw error
    }
  }),

  update: protectedProcedure.input(websiteShape.extend({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const site = clean(input)
    if (site.dscEmployeeId) {
      const existing = await pool.query('SELECT dsc_employee_id FROM tender_websites WHERE id=$1', [input.id])
      if (site.dscEmployeeId !== existing.rows[0]?.dsc_employee_id) await validateDsc(site.dscEmployeeId)
    }
    try {
      const write = (db: Pick<typeof pool, 'query'>) => db.query(
        `UPDATE tender_websites SET name=$1, url=$2, updated_at=now(),
         credentials=CASE WHEN $4 THEN $5::jsonb ELSE credentials END,
         dsc_employee_id=CASE WHEN $6 THEN $7::uuid ELSE dsc_employee_id END WHERE id=$3 AND NOT editing_locked RETURNING *`,
        [site.name, site.url, input.id, site.credentials !== undefined, site.credentials ?? null, site.dscEmployeeId !== undefined, site.dscEmployeeId ?? null],
      )
      const result = site.credentials?.passphraseId ? await credentialTransaction(async client => {
        await validateManagedCredential(client, site.credentials)
        return write(client)
      }) : await write(pool)
      if (!result.rows[0]) {
        const current = await pool.query('SELECT editing_locked FROM tender_websites WHERE id=$1', [input.id])
        if (current.rows[0]?.editing_locked) throw new TRPCError({ code: 'CONFLICT', message: 'Unlock editing before changing this website.' })
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That website no longer exists.' })
      }
      await audit(input.id, 'update', `${site.name} ${site.url}`, ctx.user?.email)
      return toWebsite(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(site.name)
      throw error
    }
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    await pool.query('DELETE FROM tender_websites WHERE id=$1', [input.id])
    await audit(input.id, 'delete', '', ctx.user?.email)
  }),

  setEditingLock: protectedProcedure.input(z.object({ id: z.string().uuid(), locked: z.boolean() })).mutation(async ({ input, ctx }) => {
    const result = await pool.query('UPDATE tender_websites SET editing_locked=$1, updated_at=now() WHERE id=$2 RETURNING *', [input.locked, input.id])
    if (!result.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'That website no longer exists.' })
    await audit(input.id, input.locked ? 'lockEditing' : 'unlockEditing', '', ctx.user?.email)
    return toWebsite(result.rows[0])
  }),
})
