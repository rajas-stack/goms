import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { accessFor, isBuiltInId, normalizeReportInput, normalizeVisualInput, type InsightReportInput, type InsightVisualInput } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router, type Context } from '../trpc.js'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { rbacMode } from '../auth/rbac/mode.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import {
  deleteRow, getVisible, insertReport, insertVisual, listCorrigendaForInsights, listVisible, toReport, toVisual, updateReportRow,
  updateVisualRow, visibleVisualIds, type StudioTable,
} from '../lib/insightsStudioStore.js'

/** Insights Studio: saved visuals and reports. Reads return the caller's own rows plus shared ones; a write needs the
 *  caller to own the row, or — for a shared row — to manage Role & Access (admin.access at W, or System Admin). Specs
 *  are validated against the semantic catalog so a visual can only name real sources and their own fields. */

async function caller(ctx: Context): Promise<string> {
  const user = ctx.user ?? await verifyIdentity(ctx.authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
  return user.email.toLowerCase()
}

async function managesShared(email: string): Promise<boolean> {
  if (isSystemAdminEmail(email)) return true
  if (rbacMode() === 'off') return false
  return accessFor(await loadUserFacts(email), 'admin.access').level === 'W'
}

/** The row, when the caller may change it; otherwise NOT_FOUND / FORBIDDEN. */
async function writable(table: StudioTable, id: string, email: string) {
  const row = await getVisible(table, id, email)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' })
  if (row.owner_email.toLowerCase() !== email && !(row.shared && await managesShared(email))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only its owner can change this. Duplicate it to make your own copy.' })
  }
  return row
}

function clean<T>(fn: () => T): T {
  try { return fn() } catch (error) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Invalid input.' })
  }
}

const id = z.string().guid('Invalid UUID')
/** Shape only; the domain validator checks every id against the catalog. */
const visualShape = z.object({
  name: z.string().max(240), description: z.string().max(2000).optional(), shared: z.boolean().optional(),
  spec: z.object({ query: z.object({}).passthrough(), chart: z.string().max(40) }).passthrough(),
})
const widgetShape = z.object({
  id: z.string().max(64), kind: z.enum(['visual', 'text']), visualId: z.string().max(80).optional(), title: z.string().max(240).optional(),
  text: z.string().max(4000).optional(), x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int(),
})
const reportShape = z.object({
  name: z.string().max(240), description: z.string().max(2000).optional(), shared: z.boolean().optional(),
  widgets: z.array(widgetShape).max(80), filters: z.object({ period: z.object({ kind: z.string().max(20) }).passthrough() }).passthrough(),
})

async function cleanReport(input: InsightReportInput, email: string) {
  const saved = input.widgets.flatMap((w) => (w.kind === 'visual' && w.visualId && !isBuiltInId(w.visualId) ? [w.visualId] : []))
  const uuids = saved.filter((v) => z.string().guid().safeParse(v).success)
  const known = await visibleVisualIds(email, uuids)
  return clean(() => normalizeReportInput(input, (visualId) => known.has(visualId)))
}

export const insightsStudioRouter = router({
  listVisuals: protectedReadProcedure.query(async ({ ctx }) => (await listVisible('insight_visuals', await caller(ctx))).map(toVisual)),
  getVisual: protectedReadProcedure.input(z.object({ id })).query(async ({ input, ctx }) => {
    const row = await getVisible('insight_visuals', input.id, await caller(ctx))
    return row ? toVisual(row) : null
  }),
  createVisual: protectedProcedure.input(visualShape).mutation(async ({ input, ctx }) => {
    const email = await caller(ctx)
    return toVisual(await insertVisual(email, clean(() => normalizeVisualInput(input as unknown as InsightVisualInput))))
  }),
  updateVisual: protectedProcedure.input(visualShape.extend({ id })).mutation(async ({ input, ctx }) => {
    const email = await caller(ctx)
    await writable('insight_visuals', input.id, email)
    const updated = await updateVisualRow(input.id, clean(() => normalizeVisualInput(input as unknown as InsightVisualInput)))
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' })
    return toVisual(updated)
  }),
  deleteVisual: protectedProcedure.input(z.object({ id })).mutation(async ({ input, ctx }) => {
    await writable('insight_visuals', input.id, await caller(ctx))
    await deleteRow('insight_visuals', input.id)
  }),

  listReports: protectedReadProcedure.query(async ({ ctx }) => (await listVisible('insight_reports', await caller(ctx))).map(toReport)),
  getReport: protectedReadProcedure.input(z.object({ id })).query(async ({ input, ctx }) => {
    const row = await getVisible('insight_reports', input.id, await caller(ctx))
    return row ? toReport(row) : null
  }),
  createReport: protectedProcedure.input(reportShape).mutation(async ({ input, ctx }) => {
    const email = await caller(ctx)
    return toReport(await insertReport(email, await cleanReport(input as unknown as InsightReportInput, email)))
  }),
  updateReport: protectedProcedure.input(reportShape.extend({ id })).mutation(async ({ input, ctx }) => {
    const email = await caller(ctx)
    await writable('insight_reports', input.id, email)
    const updated = await updateReportRow(input.id, await cleanReport(input as unknown as InsightReportInput, email))
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' })
    return toReport(updated)
  }),
  deleteReport: protectedProcedure.input(z.object({ id })).mutation(async ({ input, ctx }) => {
    await writable('insight_reports', input.id, await caller(ctx))
    await deleteRow('insight_reports', input.id)
  }),

  /** Read-only: the corrigendum register across every bid (no per-bid list endpoint covers this). */
  corrigenda: protectedReadProcedure.query(() => listCorrigendaForInsights()),
})
