import { DERIVED_ROLE_DEPARTMENTS, FUNCTIONAL_ROLES, SALES_ROLE_STATUSES, type Role } from '@goms/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { combineRoles, clearUserFactsCache, normalizeEmail } from '../auth/rbac/userFacts.js'
import { isAllowListed, parseAllowList } from '../auth/identity.js'
import { pool } from '../db.js'
import { accessProcedure, router } from '../trpc.js'

const roleSchema = z.enum(FUNCTIONAL_ROLES) // System Admin is never an override (spec §3.4)
const SYSTEM_ADMIN_MANAGED = 'System Admin accounts are managed through the protected admin allow-list.'
const isSystemAdmin = (email: string): boolean => isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS)
const emailSchema = z.string().trim().toLowerCase().email().max(254)

export interface ReadinessRow {
  key: string
  kind: 'org' | 'sales' | 'seen' | 'admin'
  name: string
  email: string
  derivedRoles: Role[]
  overrides: { id: string; role: Role; effect: 'grant' | 'revoke'; reason: string }[]
  effectiveRoles: Role[]
  /** An account on the protected admin allow-list: unrestricted, and not editable here (spec §3.4). */
  systemAdmin: boolean
  warnings: ('no-email' | 'no-role' | 'duplicate-email')[]
  lastSeenAt: string | null
}

const toOverride = (r: any) => ({
  id: r.id as string, email: r.email as string, role: r.role as Role, effect: r.effect as 'grant' | 'revoke',
  reason: r.reason as string, createdBy: r.created_by as string, createdAt: new Date(r.created_at).toISOString(),
})

export const accessRouter = router({
  listOverrides: accessProcedure.query(async () =>
    (await pool.query('SELECT * FROM user_role_overrides ORDER BY email, role')).rows.map(toOverride),
  ),

  setOverride: accessProcedure
    .input(z.object({ email: emailSchema, role: roleSchema, effect: z.enum(['grant', 'revoke']), reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      if (isSystemAdmin(input.email)) throw new TRPCError({ code: 'BAD_REQUEST', message: SYSTEM_ADMIN_MANAGED })
      const { rows } = await pool.query(
        `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email, role) DO UPDATE SET effect = EXCLUDED.effect, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
         RETURNING *`,
        [input.email, input.role, input.effect, input.reason, normalizeEmail(ctx.user?.email ?? 'unknown')],
      )
      clearUserFactsCache()
      return toOverride(rows[0])
    }),

  removeOverride: accessProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const target = (await pool.query('SELECT email FROM user_role_overrides WHERE id=$1', [input.id])).rows[0]
    if (target && isSystemAdmin(target.email)) throw new TRPCError({ code: 'BAD_REQUEST', message: SYSTEM_ADMIN_MANAGED })
    await pool.query('DELETE FROM user_role_overrides WHERE id=$1', [input.id])
    clearUserFactsCache()
  }),

  /** Per person: derived roles, overrides, effective roles, and what needs fixing before RBAC can be enforced. */
  readiness: accessProcedure.query(async (): Promise<ReadinessRow[]> => {
    const [org, sales, overrides, seen] = await Promise.all([
      pool.query(`SELECT id, name, email, departments, status FROM org_people ORDER BY name`),
      pool.query(`SELECT id, name, official_email, status FROM sales_persons ORDER BY name`),
      pool.query(`SELECT * FROM user_role_overrides`),
      pool.query(`SELECT email, role_count, last_seen_at FROM rbac_seen_users`),
    ])
    const adminList = process.env.ADMIN_ALLOWED_EMAILS
    const overridesOf = (email: string) => overrides.rows.filter((o) => o.email === email)
    const seenAt = (email: string) => {
      const s = seen.rows.find((r) => r.email === email)
      return s ? new Date(s.last_seen_at).toISOString() : null
    }
    const rows: ReadinessRow[] = []
    const make = (kind: ReadinessRow['kind'], key: string, name: string, rawEmail: string, derived: Role[]): ReadinessRow => {
      const email = normalizeEmail(rawEmail)
      const own = email ? overridesOf(email) : []
      const effective = email ? combineRoles(derived, own, isAllowListed(email, adminList)) : []
      return {
        key, kind, name, email,
        derivedRoles: email ? derived : [],
        overrides: own.map((o) => ({ id: o.id, role: o.role, effect: o.effect, reason: o.reason })),
        effectiveRoles: effective,
        systemAdmin: !!email && isAllowListed(email, adminList),
        warnings: [...(email ? [] : ['no-email' as const]), ...(effective.length === 0 ? ['no-role' as const] : [])],
        lastSeenAt: email ? seenAt(email) : null,
      }
    }

    for (const p of org.rows) {
      const derived = p.status === 'active'
        ? (Object.entries(DERIVED_ROLE_DEPARTMENTS).filter(([, d]) => (p.departments as string[]).includes(d)).map(([r]) => r as Role))
        : []
      rows.push(make('org', `org:${p.id}`, p.name, p.email ?? '', derived))
    }
    for (const s of sales.rows) {
      rows.push(make('sales', `sales:${s.id}`, s.name, s.official_email ?? '', (SALES_ROLE_STATUSES as readonly string[]).includes(s.status) ? ['sales'] : []))
    }
    const known = new Set(rows.map((r) => r.email).filter(Boolean))
    for (const s of seen.rows) {
      if (!known.has(s.email)) rows.push(make('seen', `seen:${s.email}`, s.email, s.email, []))
    }

    // System Admin accounts are always listed, even when they are in neither the org chart nor the roster (protected rows).
    const listed = new Set(rows.map((r) => r.email).filter(Boolean))
    for (const email of parseAllowList(adminList)) {
      if (!listed.has(email)) rows.push(make('admin', `admin:${email}`, email, email, []))
    }

    const counts = new Map<string, number>()
    for (const r of rows) if (r.email) counts.set(r.email, (counts.get(r.email) ?? 0) + (r.kind === 'seen' ? 0 : 1))
    for (const r of rows) if (r.email && (counts.get(r.email) ?? 0) > 1) r.warnings.push('duplicate-email')
    return rows
  }),
})
