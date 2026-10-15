import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  RBAC_ACTIONS, RBAC_LIMITS, normalizeRoleInput, normalizeTemplateName, subjectKey,
  type RbacCustomRole, type RbacMyAccess, type RbacSubjectConfig, type RbacSubjectRef, type RbacSubjects, type RbacTemplate,
} from '@goms/domain'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { accessProcedure, protectedReadProcedure, router, systemAdminProcedure } from '../trpc.js'
import {
  auditTree, clearRbacTreeCache, inTransaction, linkedTemplate, loadGrants, loadRbacNodes, resolveForEmail, syncRbacNodes, writeGrantChanges,
} from '../lib/rbacTreeStore.js'

const nodeId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_:-]+(\.[A-Za-z0-9_:-]+)*$/)
const email = z.string().trim().toLowerCase().email().max(254)
const subjectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), id: z.string().min(1).max(80) }),
  z.object({ type: z.literal('user'), id: email }),
  z.object({ type: z.literal('template'), id: z.string().guid('Invalid UUID') }),
])
const linkable = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), id: z.string().min(1).max(80) }),
  z.object({ type: z.literal('user'), id: email }),
])
const roleShape = z.object({
  label: z.string().max(RBAC_LIMITS.label * 2), description: z.string().max(RBAC_LIMITS.description * 2).optional(),
  members: z.array(z.string().max(254)).max(RBAC_LIMITS.members).optional(),
})
const actorOf = (ctx: { user?: { email: string } }): string | null => ctx.user?.email?.toLowerCase() ?? null
const customUuid = (id: string): string => {
  const uuid = id.startsWith('custom:') ? id.slice(7) : ''
  if (!z.string().guid('Invalid UUID').safeParse(uuid).success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown role.' })
  return uuid
}
const bad = (error: unknown): never => { throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Invalid input.' }) }
const conflict = (what: string, name: string): never => { throw new TRPCError({ code: 'CONFLICT', message: `A ${what} named "${name}" already exists.` }) }
/** Every write changes what someone may see: drop the cached trees. */
const changed = <T>(value: T): T => { clearRbacTreeCache(); return value }

async function listTemplates(): Promise<RbacTemplate[]> {
  const { rows } = await pool.query(
    `SELECT t.*, (SELECT count(*) FROM rbac_grants g WHERE g.subject_type='template' AND g.subject_id = t.id::text)::int AS grant_count
     FROM rbac_templates t ORDER BY lower(t.name)`,
  )
  const links = (await pool.query('SELECT subject_type, subject_id, template_id::text AS template_id FROM rbac_template_links')).rows
  return rows.map((t) => ({
    id: t.id, name: t.name, description: t.description, grantCount: t.grant_count,
    links: links.filter((l) => l.template_id === t.id).map((l) => ({ type: l.subject_type, id: l.subject_id })),
    createdAt: new Date(t.created_at).toISOString(), updatedAt: new Date(t.updated_at).toISOString(),
  }))
}

async function listRoles(): Promise<RbacCustomRole[]> {
  const roles = (await pool.query('SELECT * FROM rbac_custom_roles ORDER BY lower(label)')).rows
  const members = (await pool.query('SELECT role_id::text AS role_id, email FROM rbac_custom_role_members ORDER BY email')).rows
  return roles.map((r) => ({
    id: `custom:${r.id}`, label: r.label, description: r.description, members: members.filter((m) => m.role_id === r.id).map((m) => m.email),
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  }))
}

async function createTemplateRow(client: { query: typeof pool.query }, name: string, description: string, actor: string | null): Promise<string> {
  try {
    const { rows } = await client.query('INSERT INTO rbac_templates (name, description, created_by) VALUES ($1,$2,$3) RETURNING id', [name, description, actor])
    return rows[0].id as string
  } catch (error) {
    if (isUniqueViolation(error)) conflict('template', name)
    throw error
  }
}

export const rbacTreeRouter = router({
  /** The caller's resolved tree. System Admins are never restricted by it (they must always reach Roles & Access). */
  myAccess: protectedReadProcedure.query(async ({ ctx }): Promise<RbacMyAccess> => {
    let mail = ctx.user?.email
    if (!mail) {
      try { mail = (await verifyIdentity(ctx.authHeader)).email } catch { return { configured: false, allowed: {} } }
    }
    if (!mail || !isAmnexAccount(mail) || isSystemAdminEmail(mail)) return { configured: false, allowed: {} }
    const facts = await loadUserFacts(mail)
    return resolveForEmail(mail, facts.roles.filter((r) => r !== 'system_admin'))
  }),

  nodes: accessProcedure.query(() => loadRbacNodes()),
  subjects: accessProcedure.query(async (): Promise<RbacSubjects> => {
    const links = (await pool.query('SELECT subject_type, subject_id, template_id::text AS template_id FROM rbac_template_links')).rows
    const users = (await pool.query(
      `SELECT subject_id FROM rbac_grants WHERE subject_type='user' UNION SELECT subject_id FROM rbac_template_links WHERE subject_type='user' ORDER BY 1`,
    )).rows.map((r) => r.subject_id as string)
    return {
      customRoles: await listRoles(), templates: await listTemplates(), users,
      links: Object.fromEntries(links.map((l) => [subjectKey({ type: l.subject_type, id: l.subject_id }), l.template_id])),
    }
  }),
  getConfig: accessProcedure.input(subjectSchema).query(async ({ input }): Promise<RbacSubjectConfig> => ({
    subject: input, grants: await loadGrants(input), templateId: await linkedTemplate(input),
  })),

  sync: systemAdminProcedure.mutation(async ({ ctx }) => changed(await syncRbacNodes(actorOf(ctx)))),

  setConfig: systemAdminProcedure
    .input(z.object({
      subject: subjectSchema,
      changes: z.array(z.object({ nodeId, action: z.enum(RBAC_ACTIONS), value: z.enum(['allow', 'deny', 'inherit']) })).max(RBAC_LIMITS.changes),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.subject.type === 'user' && isSystemAdminEmail(input.subject.id)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'System Admins are never restricted by the permission tree.' })
      }
      return changed({ written: await inTransaction((client) => writeGrantChanges(client, input.subject, input.changes, actorOf(ctx))) })
    }),

  createRole: systemAdminProcedure.input(roleShape).mutation(async ({ input, ctx }): Promise<RbacCustomRole> => {
    let clean: ReturnType<typeof normalizeRoleInput> = { label: '', description: '', members: [] }
    try { clean = normalizeRoleInput(input) } catch (e) { bad(e) }
    const id = await inTransaction(async (client) => {
      try {
        const { rows } = await client.query('INSERT INTO rbac_custom_roles (label, description, created_by) VALUES ($1,$2,$3) RETURNING id', [clean.label, clean.description, actorOf(ctx)])
        const roleId = rows[0].id as string
        if (clean.members.length) await client.query('INSERT INTO rbac_custom_role_members (role_id, email) SELECT $1, unnest($2::text[])', [roleId, clean.members])
        await auditTree(client, `role:custom:${roleId}`, 'role', '', JSON.stringify(clean), 'create', actorOf(ctx))
        return roleId
      } catch (error) {
        if (isUniqueViolation(error)) conflict('role', clean.label)
        throw error
      }
    })
    return changed((await listRoles()).find((r) => r.id === `custom:${id}`)!)
  }),
  updateRole: systemAdminProcedure.input(roleShape.extend({ id: z.string().max(80) })).mutation(async ({ input, ctx }) => {
    const uuid = customUuid(input.id)
    let clean: ReturnType<typeof normalizeRoleInput> = { label: '', description: '', members: [] }
    try { clean = normalizeRoleInput(input) } catch (e) { bad(e) }
    await inTransaction(async (client) => {
      try {
        const { rows } = await client.query('UPDATE rbac_custom_roles SET label=$1, description=$2, updated_at=now() WHERE id=$3 RETURNING id', [clean.label, clean.description, uuid])
        if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'That role no longer exists.' })
      } catch (error) {
        if (isUniqueViolation(error)) conflict('role', clean.label)
        throw error
      }
      await client.query('DELETE FROM rbac_custom_role_members WHERE role_id=$1', [uuid])
      if (clean.members.length) await client.query('INSERT INTO rbac_custom_role_members (role_id, email) SELECT $1, unnest($2::text[])', [uuid, clean.members])
      await auditTree(client, `role:${input.id}`, 'role', '', JSON.stringify(clean), 'update', actorOf(ctx))
    })
    changed(null)
  }),
  deleteRole: systemAdminProcedure.input(z.object({ id: z.string().max(80) })).mutation(async ({ input, ctx }) => {
    const uuid = customUuid(input.id)
    await inTransaction(async (client) => {
      await client.query(`DELETE FROM rbac_grants WHERE subject_type='role' AND subject_id=$1`, [input.id])
      await client.query(`DELETE FROM rbac_template_links WHERE subject_type='role' AND subject_id=$1`, [input.id])
      const { rows } = await client.query('DELETE FROM rbac_custom_roles WHERE id=$1 RETURNING label', [uuid])
      if (rows[0]) await auditTree(client, `role:${input.id}`, 'role', rows[0].label, '', 'delete', actorOf(ctx))
    })
    changed(null)
  }),

  createTemplate: systemAdminProcedure
    .input(z.object({ name: z.string().max(RBAC_LIMITS.label * 2), description: z.string().max(RBAC_LIMITS.description * 2).optional(), from: subjectSchema.nullish() }))
    .mutation(async ({ input, ctx }) => {
      let name = ''
      try { name = normalizeTemplateName(input.name) } catch (e) { bad(e) }
      const id = await inTransaction(async (client) => {
        const templateId = await createTemplateRow(client as never, name, (input.description ?? '').trim(), actorOf(ctx))
        if (input.from) {
          const from: RbacSubjectRef = input.from
          const linked = await linkedTemplate(from, client)
          const base = linked ? await loadGrants({ type: 'template', id: linked }, client) : []
          const own = await loadGrants(from, client)
          const cells = [...base, ...own].map((g) => ({ nodeId: g.nodeId, action: g.action, value: g.effect }))
          await writeGrantChanges(client, { type: 'template', id: templateId }, cells, actorOf(ctx))
        }
        await auditTree(client, `template:${templateId}`, 'template', '', name, 'create', actorOf(ctx))
        return templateId
      })
      return changed({ id })
    }),
  updateTemplate: systemAdminProcedure
    .input(z.object({ id: z.string().guid('Invalid UUID'), name: z.string().max(RBAC_LIMITS.label * 2), description: z.string().max(RBAC_LIMITS.description * 2).optional() }))
    .mutation(async ({ input, ctx }) => {
      let name = ''
      try { name = normalizeTemplateName(input.name) } catch (e) { bad(e) }
      await inTransaction(async (client) => {
        try {
          const { rows } = await client.query(
            'UPDATE rbac_templates SET name=$1, description=COALESCE($2, description), updated_at=now() WHERE id=$3 RETURNING id', [name, input.description?.trim() ?? null, input.id],
          )
          if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'That template no longer exists.' })
        } catch (error) {
          if (isUniqueViolation(error)) conflict('template', name)
          throw error
        }
        await auditTree(client, `template:${input.id}`, 'template', '', name, 'update', actorOf(ctx))
      })
    }),
  duplicateTemplate: systemAdminProcedure.input(z.object({ id: z.string().guid('Invalid UUID') })).mutation(async ({ input, ctx }) => {
    const id = await inTransaction(async (client) => {
      const source = (await client.query('SELECT * FROM rbac_templates WHERE id=$1', [input.id])).rows[0]
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'That template no longer exists.' })
      const taken = new Set((await client.query('SELECT lower(name) AS n FROM rbac_templates')).rows.map((r) => r.n as string))
      let name = `${source.name} (copy)`
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${source.name} (copy ${i})`
      const copy = await createTemplateRow(client as never, name.slice(0, RBAC_LIMITS.label), source.description, actorOf(ctx))
      const cells = (await loadGrants({ type: 'template', id: input.id }, client)).map((g) => ({ nodeId: g.nodeId, action: g.action, value: g.effect }))
      await writeGrantChanges(client, { type: 'template', id: copy }, cells, actorOf(ctx))
      return copy
    })
    return { id }
  }),
  deleteTemplate: systemAdminProcedure.input(z.object({ id: z.string().guid('Invalid UUID') })).mutation(async ({ input, ctx }) => {
    await inTransaction(async (client) => {
      await client.query(`DELETE FROM rbac_grants WHERE subject_type='template' AND subject_id=$1`, [input.id])
      const { rows } = await client.query('DELETE FROM rbac_templates WHERE id=$1 RETURNING name', [input.id])
      if (rows[0]) await auditTree(client, `template:${input.id}`, 'template', rows[0].name, '', 'delete', actorOf(ctx))
    })
    changed(null)
  }),
  /** Links the template to every subject (linked mode). `replace` also clears their own overrides (each removal audited). */
  applyTemplate: systemAdminProcedure
    .input(z.object({ templateId: z.string().guid('Invalid UUID'), subjects: z.array(linkable).min(1).max(RBAC_LIMITS.subjects), mode: z.enum(['keep', 'replace']) }))
    .mutation(async ({ input, ctx }) => {
      await inTransaction(async (client) => {
        if (!(await client.query('SELECT 1 FROM rbac_templates WHERE id=$1', [input.templateId])).rows[0]) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That template no longer exists.' })
        }
        for (const subject of input.subjects) {
          await client.query(
            `INSERT INTO rbac_template_links (subject_type, subject_id, template_id, linked_by) VALUES ($1,$2,$3,$4)
             ON CONFLICT (subject_type, subject_id) DO UPDATE SET template_id = EXCLUDED.template_id, linked_by = EXCLUDED.linked_by, linked_at = now()`,
            [subject.type, subject.id, input.templateId, actorOf(ctx)],
          )
          await auditTree(client, subjectKey(subject), 'template', '', input.templateId, 'link', actorOf(ctx))
          if (input.mode === 'replace') {
            const own = await loadGrants(subject, client)
            await writeGrantChanges(client, subject, own.map((g) => ({ nodeId: g.nodeId, action: g.action, value: 'inherit' as const })), actorOf(ctx))
          }
        }
      })
      changed(null)
    }),
  unlinkTemplate: systemAdminProcedure.input(linkable).mutation(async ({ input, ctx }) => {
    await inTransaction(async (client) => {
      const { rows } = await client.query('DELETE FROM rbac_template_links WHERE subject_type=$1 AND subject_id=$2 RETURNING template_id', [input.type, input.id])
      if (rows[0]) await auditTree(client, subjectKey(input), 'template', String(rows[0].template_id), '', 'unlink', actorOf(ctx))
    })
    changed(null)
  }),
})
