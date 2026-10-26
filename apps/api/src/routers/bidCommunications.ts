import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { CONTACT_PARTIES, validMailAddress, type CommunicationContact } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router, type Context } from '../trpc.js'
import { verifyIdentity, isAmnexAccount } from '../auth/identity.js'
import { requireSystemAdmin, EMAIL_BINDING_MESSAGE } from '../auth/rbac/systemAdminOnly.js'
import { pool } from '../db.js'
import { orgPeopleRouter } from './orgPeople.js'
import { employeesRouter } from './employees.js'
import { rejectKnownCommunicationEmail } from '../lib/communicationPeople.js'

const email = z.string().trim().toLowerCase().max(254).refine(validMailAddress, 'Enter a valid email address.')
const uuid = z.string().uuid()
const scope = z.object({ bidId: uuid }).strict()
const contactInput = z.object({
  email, name: z.string().trim().min(1).max(200), party: z.enum(CONTACT_PARTIES),
  organization: z.string().trim().min(1).max(200), departmentId: uuid.nullable(),
}).strict()

async function identity(ctx: Context) {
  // Mail remains private even when staged app authentication is disabled.
  const user = await verifyIdentity(ctx.authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your Amnex Google account.' })
  return user
}
async function assertBid(bidId: string) {
  if (!(await pool.query('SELECT id FROM bids WHERE id=$1', [bidId])).rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'This bid no longer exists.' })
}
function contact(row: any): CommunicationContact {
  return { id: row.id, email: row.email, name: row.name, party: row.party, organization: row.organization, departmentId: row.department_id }
}
async function checkDepartment(id: string | null, required = false) {
  if (required && !id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select the client department.' })
  if (id && !(await pool.query("SELECT id FROM hierarchy_nodes WHERE id=$1 AND domain='org' AND status='active'", [id])).rows.length)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an active client department or office.' })
}

export const bidCommunicationsRouter = router({
  ignore: protectedProcedure.input(scope.extend({ email, ignored: z.boolean() }).strict()).mutation(async ({ input, ctx }) => {
    const user = await identity(ctx); await assertBid(input.bidId)
    if (input.ignored) await pool.query('INSERT INTO bid_communication_ignored (bid_id,user_uid,email) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [input.bidId, user.uid, input.email])
    else await pool.query('DELETE FROM bid_communication_ignored WHERE bid_id=$1 AND user_uid=$2 AND email=$3', [input.bidId, user.uid, input.email])
  }),
  contacts: protectedReadProcedure.query(async ({ ctx }) => { await identity(ctx); return (await pool.query('SELECT * FROM communication_contacts ORDER BY lower(name),email')).rows.map(contact) }),
  createContact: protectedProcedure.input(contactInput).mutation(async ({ input, ctx }) => {
    const user = await identity(ctx); await checkDepartment(input.departmentId, input.party === 'clientDepartment')
    const db = await pool.connect()
    try {
      await db.query('BEGIN'); await db.query('LOCK TABLE communication_contacts IN SHARE ROW EXCLUSIVE MODE')
      await rejectKnownCommunicationEmail(db, input.email)
      const result = await db.query('INSERT INTO communication_contacts (email,name,party,organization,department_id,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [input.email, input.name, input.party, input.organization, input.departmentId, user.email])
      await db.query('COMMIT'); return contact(result.rows[0])
    } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
  }),
  updateContact: protectedProcedure.input(contactInput.omit({ email: true }).extend({ id: uuid }).strict()).mutation(async ({ input, ctx }) => {
    await identity(ctx); await checkDepartment(input.departmentId, input.party === 'clientDepartment')
    const result = await pool.query('UPDATE communication_contacts SET name=$2,party=$3,organization=$4,department_id=$5,updated_at=now() WHERE id=$1 RETURNING *', [input.id, input.name, input.party, input.organization, input.departmentId])
    if (!result.rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact no longer exists.' })
    return contact(result.rows[0])
  }),
  // Removes the address-book entry only: linked mail threads keep their own copy of each participant and category.
  deleteContact: protectedProcedure.input(z.object({ id: uuid }).strict()).mutation(async ({ input, ctx }) => {
    await identity(ctx)
    const result = await pool.query('DELETE FROM communication_contacts WHERE id=$1 RETURNING id', [input.id])
    if (!result.rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact no longer exists.' })
  }),
  // Existing native mutations retain their permission, email-binding and org-roster rules.
  addInternal: protectedProcedure.input(z.object({
    name: z.string().trim().min(1).max(200), email, designation: z.string().trim().max(200),
    level: z.number().int().min(0).max(7), departments: z.array(z.string().max(80)).min(1).max(12), managerId: uuid.nullable(),
  }).strict()).mutation(async ({ input, ctx }) => {
    const user = await identity(ctx)
    const departments = (await pool.query('SELECT name FROM amnex_departments')).rows.map(row => row.name)
    if (input.departments.some(value => !departments.includes(value))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose departments from the Employee Master.' })
    return orgPeopleRouter.createCaller({ ...ctx, user }).create({ ...input, rejectDuplicateEmail: true })
  }),
  bindInternalEmail: protectedProcedure.input(z.object({ id: uuid, email, confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const user = await identity(ctx)
    requireSystemAdmin({ ...ctx, user }, EMAIL_BINDING_MESSAGE, 'orgPeople.update#email')
    const db = await pool.connect()
    try {
      await db.query('BEGIN'); await db.query('LOCK TABLE org_people IN SHARE ROW EXCLUSIVE MODE')
      const current = (await db.query('SELECT email FROM org_people WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee no longer exists.' })
      if (current.email?.trim()) throw new TRPCError({ code: 'CONFLICT', message: 'This employee already has an email. Existing emails are never replaced here.' })
      await rejectKnownCommunicationEmail(db, input.email)
      const before = new Map<string, string>((await db.query('SELECT id,email FROM delivery_team_members')).rows.map(row => [row.id, row.email]))
      await db.query('UPDATE org_people SET email=$2,updated_at=now() WHERE id=$1', [input.id, input.email])
      await db.query('SELECT sync_delivery_teams_from_org()')
      const after = (await db.query('SELECT id,email FROM delivery_team_members')).rows
      if (after.some(row => before.get(row.id)?.trim() && before.get(row.id) !== row.email)) throw new TRPCError({ code: 'CONFLICT', message: 'This would replace an existing team email. Review the employee in Teams first.' })
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
  }),
  addClient: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(200), email, designation: z.string().trim().min(1).max(200), orgNodeId: uuid }).strict()).mutation(async ({ input, ctx }) => {
    const user = await identity(ctx); await checkDepartment(input.orgNodeId, true)
    return employeesRouter.createCaller({ ...ctx, user }).create({ ...input, phone: '', managerId: null, rejectDuplicateEmail: true })
  }),
})
