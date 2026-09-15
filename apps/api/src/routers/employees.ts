import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { subtreeIds } from './hierarchy.js'
import { MERGEABLE_FIELDS, type MergeableField } from '@goms/domain'

const relationshipStatusSchema = z.enum(['engaged', 'developing', 'dormant', 'new'])
const relationshipQualitySchema = z.enum(['excellent', 'good', 'neutral', 'weak', 'poor'])
const preferredCommSchema = z.enum(['phone', 'email', 'whatsapp', 'in-person', 'sms'])
const timelineEventTypeSchema = z.enum([
  'joined', 'promoted', 'transferred', 'meeting', 'inPerson', 'call', 'email',
  'whatsapp', 'followup', 'note', 'document', 'custom',
])
const chargeKindSchema = z.enum(['acting', 'additional'])
const visitingCardSchema = z.object({
  id: z.string(), frontUrl: z.string(), frontName: z.string(),
  backUrl: z.string().nullable(), backName: z.string().nullable(),
})
const chargeInputShape = {
  kind: chargeKindSchema, title: z.string().min(1), orgNodeId: z.string().uuid().nullable(),
  startDate: z.string().nullable(), endDate: z.string().nullable(), reason: z.string(),
}

function toCharge(row: any) {
  return { id: row.id, kind: row.kind, title: row.title, orgNodeId: row.org_node_id, startDate: row.start_date, endDate: row.end_date, reason: row.reason }
}

function toEmployeeRow(row: any) {
  return {
    id: row.id, code: row.code, name: row.name, designation: row.designation,
    email: row.email, phone: row.phone, company: row.company, address: row.address, website: row.website,
    photoUrl: row.photo_url, orgNodeId: row.org_node_id, managerId: row.manager_id,
    vacant: row.vacant, connected: row.connected,
    relationshipStatus: row.relationship_status, relationshipQuality: row.relationship_quality,
    relationshipType: row.relationship_type, introducedBy: row.introduced_by,
    importantContact: row.important_contact, preferredComm: row.preferred_comm,
    lastInteractionAt: row.last_interaction_at, followUpDate: row.follow_up_date,
    notes: row.notes, visitingCards: row.visiting_cards, metadata: row.metadata, status: row.status,
  }
}

async function attachCharges(rows: any[]) {
  if (!rows.length) return []
  const chargeRows = (await pool.query(
    `SELECT * FROM employee_charges WHERE employee_id = ANY($1) ORDER BY start_date NULLS LAST`,
    [rows.map((r) => r.id)],
  )).rows
  const byEmp = new Map<string, any[]>()
  for (const c of chargeRows) {
    const arr = byEmp.get(c.employee_id) ?? []
    arr.push(toCharge(c))
    byEmp.set(c.employee_id, arr)
  }
  return rows.map((r) => ({ ...toEmployeeRow(r), charges: byEmp.get(r.id) ?? [] }))
}

async function oneEmployee(id: string) {
  const result = await pool.query('SELECT * FROM employees WHERE id=$1', [id])
  if (!result.rows[0]) return null
  return (await attachCharges([result.rows[0]]))[0]
}

function toTimelineEvent(row: any) {
  return {
    id: row.id, employeeId: row.employee_id, type: row.type, title: row.title,
    customLabel: row.custom_label ?? undefined, date: row.date, time: row.time ?? undefined,
    note: row.note, source: row.source, attendees: row.attendees ?? undefined, attended: row.attended ?? undefined,
    agenda: row.agenda ?? undefined, outcome: row.outcome ?? undefined, nextSteps: row.next_steps ?? undefined,
  }
}

function toTransfer(row: any) {
  return {
    id: row.id, employeeId: row.employee_id,
    fromDesignation: row.from_designation, toDesignation: row.to_designation,
    fromDepartmentName: row.from_department_name, toDepartmentName: row.to_department_name,
    fromOfficeName: row.from_office_name, toOfficeName: row.to_office_name, toOrgNodeId: row.to_org_node_id,
    fromManagerName: row.from_manager_name, toManagerName: row.to_manager_name,
    effectiveDate: row.effective_date, reason: row.reason, remarks: row.remarks,
  }
}

// Same "sequential single-row lookups" style hierarchy.ts's fetchBreadcrumb
// uses — this app is small-scale internal-tool traffic (spec §2), so a plain
// loop is simpler to read and review than a recursive CTE for a per-transfer,
// low-frequency lookup.
async function departmentNameOf(db: { query: typeof pool.query }, nodeId: string | null): Promise<string> {
  let curId = nodeId
  while (curId) {
    const result = await db.query('SELECT * FROM hierarchy_nodes WHERE id=$1', [curId])
    const row = result.rows[0]
    if (!row) return '—'
    if (row.type_key === 'department') return row.name
    curId = row.parent_id
  }
  return '—'
}

const employeePatchShape = {
  name: z.string().min(1).optional(), designation: z.string().min(1).optional(),
  email: z.string().optional(), phone: z.string().optional(), company: z.string().optional(),
  address: z.string().optional(), website: z.string().optional(), photoUrl: z.string().nullable().optional(),
  orgNodeId: z.string().uuid().optional(), managerId: z.string().uuid().nullable().optional(),
  vacant: z.boolean().optional(), connected: z.boolean().optional(),
  relationshipStatus: relationshipStatusSchema.optional(), relationshipQuality: relationshipQualitySchema.optional(),
  relationshipType: z.string().optional(), introducedBy: z.string().optional(),
  importantContact: z.boolean().optional(), preferredComm: z.array(preferredCommSchema).optional(),
  lastInteractionAt: z.string().nullable().optional(), followUpDate: z.string().nullable().optional(),
  notes: z.string().optional(), visitingCards: z.array(visitingCardSchema).optional(),
  metadata: z.record(z.string()).optional(), status: z.enum(['active', 'archived']).optional(),
}

const employeeColumnFor: Record<string, string> = {
  name: 'name', designation: 'designation', email: 'email', phone: 'phone', company: 'company',
  address: 'address', website: 'website', photoUrl: 'photo_url', orgNodeId: 'org_node_id',
  managerId: 'manager_id', vacant: 'vacant', connected: 'connected',
  relationshipStatus: 'relationship_status', relationshipQuality: 'relationship_quality',
  relationshipType: 'relationship_type', introducedBy: 'introduced_by',
  importantContact: 'important_contact', preferredComm: 'preferred_comm',
  lastInteractionAt: 'last_interaction_at', followUpDate: 'follow_up_date', notes: 'notes',
  visitingCards: 'visiting_cards', metadata: 'metadata', status: 'status',
}
const jsonColumns = new Set(['preferredComm', 'visitingCards', 'metadata'])

// Item 14: mirrors employees.update's dynamic-SET convention exactly (see
// employeePatchShape/employeeColumnFor above) — every field optional, only
// the ones present in the patch get written.
const timelineEventPatchShape = {
  title: z.string().min(1).optional(), date: z.string().optional(), time: z.string().optional(),
  note: z.string().optional(),
  attendees: z.array(z.union([z.string(), z.object({ salesPersonId: z.string(), name: z.string() })])).optional(),
  // Nullable (unlike `add`'s equivalent fields): editing must be able to
  // clear a previously-set agenda/outcome/nextSteps back out, not just set one.
  agenda: z.string().nullable().optional(), outcome: z.string().nullable().optional(), nextSteps: z.string().nullable().optional(),
}
const timelineEventColumnFor: Record<string, string> = {
  title: 'title', date: 'date', time: 'time', note: 'note', attendees: 'attendees',
  agenda: 'agenda', outcome: 'outcome', nextSteps: 'next_steps',
}
const timelineJsonColumns = new Set(['attendees'])

const timelineRouter = router({
  listForEmployee: protectedReadProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT * FROM timeline_events WHERE employee_id=$1 ORDER BY date DESC, id DESC`, [input.employeeId])
    return result.rows.map(toTimelineEvent)
  }),
  listAll: protectedReadProcedure
    .input(z.object({ types: z.array(timelineEventTypeSchema).optional() }).optional())
    .query(async ({ input }) => {
      const types = input?.types
      const result = types?.length
        ? await pool.query(`SELECT * FROM timeline_events WHERE type = ANY($1) ORDER BY date DESC, id DESC`, [types])
        : await pool.query(`SELECT * FROM timeline_events ORDER BY date DESC, id DESC`)
      return result.rows.map(toTimelineEvent)
    }),
  add: protectedProcedure
    .input(z.object({
      employeeId: z.string().uuid(), type: timelineEventTypeSchema, title: z.string().min(1),
      customLabel: z.string().optional(), date: z.string(), time: z.string().optional(),
      note: z.string().optional(),
      // Legacy plain-string attendee, or the new ID-carrying snapshot
      // captured at selection time — see src/lib/types.ts's AttendeeRef.
      attendees: z.array(z.union([z.string(), z.object({ salesPersonId: z.string(), name: z.string() })])).optional(),
      agenda: z.string().optional(), outcome: z.string().optional(), nextSteps: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `INSERT INTO timeline_events (employee_id, type, title, custom_label, date, time, note, source, attendees, agenda, outcome, next_steps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10,$11) RETURNING *`,
        [
          input.employeeId, input.type, input.title,
          input.type === 'custom' ? (input.customLabel?.trim() || null) : null,
          input.date, input.time || null, input.note ?? '',
          input.attendees ? JSON.stringify(input.attendees) : null,
          input.agenda ?? null, input.outcome ?? null, input.nextSteps ?? null,
        ],
      )
      return toTimelineEvent(result.rows[0])
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(timelineEventPatchShape) }))
    .mutation(async ({ input }) => {
      const fields = Object.keys(input.patch)
      if (!fields.length) {
        const existing = await pool.query('SELECT * FROM timeline_events WHERE id=$1', [input.id])
        return toTimelineEvent(existing.rows[0])
      }
      const values = fields.map((f) => (timelineJsonColumns.has(f) ? JSON.stringify((input.patch as any)[f]) : (input.patch as any)[f]))
      const setClauses = fields.map((f, i) => `${timelineEventColumnFor[f]}=$${i + 1}`)
      values.push(input.id)
      const result = await pool.query(`UPDATE timeline_events SET ${setClauses.join(', ')} WHERE id=$${values.length} RETURNING *`, values)
      return toTimelineEvent(result.rows[0])
    }),
  setAttended: protectedProcedure
    .input(z.object({ id: z.string().uuid(), attended: z.boolean().optional() }))
    .mutation(({ input }) => pool.query(`UPDATE timeline_events SET attended=$1 WHERE id=$2`, [input.attended ?? null, input.id]).then(() => undefined)),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) =>
    pool.query('DELETE FROM timeline_events WHERE id=$1', [input.id]).then(() => undefined)
  ),
})

const transfersRouter = router({
  listForEmployee: protectedReadProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT * FROM transfers WHERE employee_id=$1 ORDER BY effective_date DESC`, [input.employeeId])
    return result.rows.map(toTransfer)
  }),
  transfer: protectedProcedure
    .input(z.object({
      employeeId: z.string().uuid(), toOrgNodeId: z.string().uuid(), toDesignation: z.string(),
      toManagerId: z.string().uuid().nullable().optional(), effectiveDate: z.string(),
      reason: z.string(), remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const empResult = await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [input.employeeId])
        const emp = empResult.rows[0]
        if (!emp) throw new TRPCError({ code: 'NOT_FOUND' })
        const fromOffice = (await client.query('SELECT name FROM hierarchy_nodes WHERE id=$1', [emp.org_node_id])).rows[0]
        const toOffice = (await client.query('SELECT name FROM hierarchy_nodes WHERE id=$1', [input.toOrgNodeId])).rows[0]
        const fromDept = await departmentNameOf(client, emp.org_node_id)
        const toDept = await departmentNameOf(client, input.toOrgNodeId)
        const managerName = async (id: string | null) => {
          if (!id) return '—'
          const r = await client.query('SELECT name FROM employees WHERE id=$1', [id])
          return r.rows[0]?.name ?? '—'
        }
        const managerChanging = input.toManagerId !== undefined
        const fromManagerName = await managerName(emp.manager_id)
        const toManagerName = managerChanging ? await managerName(input.toManagerId ?? null) : fromManagerName
        const toDesignation = input.toDesignation || emp.designation
        const transferResult = await client.query(
          `INSERT INTO transfers (employee_id, from_designation, to_designation, from_department_name, to_department_name,
             from_office_name, to_office_name, to_org_node_id, from_manager_name, to_manager_name, effective_date, reason, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [emp.id, emp.designation, toDesignation, fromDept, toDept, fromOffice?.name ?? '—', toOffice?.name ?? '—',
           input.toOrgNodeId, fromManagerName, toManagerName, input.effectiveDate, input.reason, input.remarks ?? ''],
        )
        await client.query(
          `UPDATE employees SET org_node_id=$1, designation=$2, manager_id=$3, updated_at=now() WHERE id=$4`,
          [input.toOrgNodeId, toDesignation, managerChanging ? (input.toManagerId ?? null) : emp.manager_id, emp.id],
        )
        await client.query(
          `INSERT INTO timeline_events (employee_id, type, title, date, note, source) VALUES ($1,'transferred',$2,$3,$4,'system')`,
          [emp.id, `Transferred to ${toOffice?.name ?? '—'}`, input.effectiveDate, input.reason],
        )
        await client.query('COMMIT')
        return toTransfer(transferResult.rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})

export const employeesRouter = router({
  listUnder: protectedReadProcedure.input(z.object({ orgNodeId: z.string().uuid() })).query(async ({ input }) => {
    const ids = await subtreeIds(input.orgNodeId)
    const result = await pool.query(`SELECT * FROM employees WHERE org_node_id = ANY($1) AND status='active' ORDER BY name`, [ids])
    return attachCharges(result.rows)
  }),
  listDirect: protectedReadProcedure.input(z.object({ orgNodeId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(`SELECT * FROM employees WHERE org_node_id=$1 AND status='active' ORDER BY name`, [input.orgNodeId])
    return attachCharges(result.rows)
  }),
  listByState: protectedReadProcedure.input(z.object({ stateCode: z.number() })).query(async ({ input }) => {
    const result = await pool.query(
      `SELECT e.* FROM employees e JOIN hierarchy_nodes n ON n.id = e.org_node_id
       WHERE n.domain='org' AND n.state_code=$1 AND e.status='active' ORDER BY e.name`,
      [input.stateCode],
    )
    return attachCharges(result.rows)
  }),
  listAll: protectedReadProcedure.query(async () => attachCharges((await pool.query(`SELECT * FROM employees WHERE status='active' ORDER BY name`)).rows)),
  listDepartments: protectedReadProcedure.query(async () => {
    const result = await pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id AS start_id, id, parent_id, type_key, name FROM hierarchy_nodes
         UNION ALL
         SELECT c.start_id, n.id, n.parent_id, n.type_key, n.name
         FROM chain c JOIN hierarchy_nodes n ON n.id = c.parent_id
         WHERE c.type_key <> 'department'
       )
       SELECT DISTINCT ON (e.id) e.id AS employee_id, d.id AS dept_id, d.name AS dept_name
       FROM employees e JOIN chain d ON d.start_id = e.org_node_id AND d.type_key = 'department'
       WHERE e.status = 'active'`,
    )
    const out: Record<string, { id: string; name: string }> = {}
    for (const row of result.rows) out[row.employee_id] = { id: row.dept_id, name: row.dept_name }
    return out
  }),
  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneEmployee(input.id)),
  directReports: protectedReadProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ input }) =>
    attachCharges((await pool.query(`SELECT * FROM employees WHERE manager_id=$1 AND status='active'`, [input.employeeId])).rows)
  ),
  reportingChain: protectedReadProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ input }) => {
    const chain: any[] = []
    let cur = (await pool.query('SELECT * FROM employees WHERE id=$1', [input.employeeId])).rows[0]
    while (cur?.manager_id) {
      const mgr = (await pool.query('SELECT * FROM employees WHERE id=$1', [cur.manager_id])).rows[0]
      if (!mgr) break
      chain.unshift(mgr)
      cur = mgr
    }
    return attachCharges(chain)
  }),
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1), designation: z.string().min(1), email: z.string(), phone: z.string(),
      photoUrl: z.string().nullable().optional(), company: z.string().optional(), address: z.string().optional(),
      website: z.string().optional(), orgNodeId: z.string().uuid(), managerId: z.string().uuid().nullable(),
      vacant: z.boolean().optional(), connected: z.boolean().optional(),
      relationshipStatus: relationshipStatusSchema.optional(), relationshipQuality: relationshipQualitySchema.optional(),
      relationshipType: z.string().optional(), introducedBy: z.string().optional(),
      importantContact: z.boolean().optional(), preferredComm: z.array(preferredCommSchema).optional(),
      lastInteractionAt: z.string().nullable().optional(), followUpDate: z.string().nullable().optional(),
      notes: z.string().optional(),
      charges: z.array(z.object(chargeInputShape)).optional(),
      visitingCards: z.array(visitingCardSchema).optional(),
      metadata: z.record(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const vacant = input.vacant ?? false
      const code = `EMP-NEW-${Math.floor(Math.random() * 9000 + 1000)}`
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(
          `INSERT INTO employees (
             code, name, designation, email, phone, company, address, website, photo_url,
             org_node_id, manager_id, vacant, connected, relationship_status, relationship_quality,
             relationship_type, introduced_by, important_contact, preferred_comm,
             last_interaction_at, follow_up_date, notes, visiting_cards, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING *`,
          [
            code, input.name, input.designation, input.email, input.phone,
            input.company ?? '', input.address ?? '', input.website ?? '', input.photoUrl ?? null,
            input.orgNodeId, input.managerId, vacant, vacant ? false : input.connected ?? true,
            input.relationshipStatus ?? 'new', input.relationshipQuality ?? 'neutral',
            input.relationshipType ?? '', input.introducedBy ?? '', input.importantContact ?? false,
            JSON.stringify(input.preferredComm ?? []), input.lastInteractionAt ?? null, input.followUpDate ?? null,
            input.notes ?? '', JSON.stringify(input.visitingCards ?? []), input.metadata ?? {},
          ],
        )
        const emp = result.rows[0]
        for (const charge of input.charges ?? []) {
          await client.query(
            `INSERT INTO employee_charges (employee_id, kind, title, org_node_id, start_date, end_date, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [emp.id, charge.kind, charge.title, charge.orgNodeId, charge.startDate, charge.endDate, charge.reason],
          )
        }
        if (!vacant) {
          await client.query(
            `INSERT INTO timeline_events (employee_id, type, title, date, note, source) VALUES ($1,'joined','Contact created',CURRENT_DATE,'','system')`,
            [emp.id],
          )
        }
        await client.query('COMMIT')
        return (await attachCharges([emp]))[0]
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(employeePatchShape) }))
    .mutation(async ({ input }) => {
      const fields = Object.keys(input.patch)
      if (!fields.length) return oneEmployee(input.id)
      const values = fields.map((f) => (jsonColumns.has(f) ? JSON.stringify((input.patch as any)[f]) : (input.patch as any)[f]))
      const setClauses = fields.map((f, i) => `${employeeColumnFor[f]}=$${i + 1}`)
      values.push(input.id)
      await pool.query(`UPDATE employees SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${values.length}`, values)
      return oneEmployee(input.id)
    }),
  setManager: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid(), managerId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      if (input.employeeId === input.managerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'An employee cannot report to themselves' })
      }
      if (!input.managerId) {
        await pool.query(`UPDATE employees SET manager_id=$1, updated_at=now() WHERE id=$2`, [input.managerId, input.employeeId])
        return
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Locks both employees involved, in a stable (sorted) order so two
        // concurrent setManager calls touching the same two people can't
        // deadlock each other. Without this lock, two concurrent calls (A:
        // set X's manager to Y; B, at the same instant: set Y's manager to
        // X) can each pass the cycle-detection query below before the
        // other commits — both see a pre-change manager chain, both pass,
        // and both UPDATEs land, producing a real 2-node reporting cycle
        // that `reportingChain`'s chain-walk would then loop on forever.
        const lockIds = [input.employeeId, input.managerId].sort()
        await client.query('SELECT id FROM employees WHERE id = ANY($1) ORDER BY id FOR UPDATE', [lockIds])
        const cycle = await client.query(
          `WITH RECURSIVE chain AS (
             SELECT id, manager_id FROM employees WHERE id=$1
             UNION ALL
             SELECT e.id, e.manager_id FROM employees e JOIN chain c ON e.id = c.manager_id
           )
           SELECT 1 FROM chain WHERE id=$2`,
          [input.managerId, input.employeeId],
        )
        if (cycle.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That would create a reporting cycle' })
        await client.query(`UPDATE employees SET manager_id=$1, updated_at=now() WHERE id=$2`, [input.managerId, input.employeeId])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const removedManagerId = (await client.query('SELECT manager_id FROM employees WHERE id=$1', [input.id])).rows[0]?.manager_id ?? null
      await client.query(`UPDATE employees SET manager_id=$1 WHERE manager_id=$2`, [removedManagerId, input.id])
      // Clears a dangling deptHead pointer if the deleted employee headed a
      // department — the same cleanup `merge` already does (by reassigning
      // the pointer to the survivor, `departmentHeadshipsMoved` below) for
      // its own case; plain delete has no replacement employee to reassign
      // to, so the key is removed outright rather than left pointing at a
      // now-nonexistent employee id.
      await client.query(`UPDATE hierarchy_nodes SET metadata = metadata - 'deptHead' WHERE metadata->>'deptHead' = $1`, [input.id])
      await client.query(`DELETE FROM follow_ups WHERE entity_type='contact' AND entity_id=$1`, [input.id])
      await client.query('DELETE FROM employees WHERE id=$1', [input.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),
  merge: protectedProcedure
    .input(z.object({ survivorId: z.string().uuid(), duplicateId: z.string().uuid(), resolutions: z.record(z.string()).optional() }))
    .mutation(async ({ input }) => {
      if (input.survivorId === input.duplicateId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot merge a record with itself' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const survivor = (await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [input.survivorId])).rows[0]
        const duplicate = (await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [input.duplicateId])).rows[0]
        if (!survivor || !duplicate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Both records must exist to merge' })

        const columnFor: Record<MergeableField, string> = {
          name: 'name', designation: 'designation', email: 'email', phone: 'phone', company: 'company',
          address: 'address', website: 'website', relationshipStatus: 'relationship_status',
          relationshipQuality: 'relationship_quality', relationshipType: 'relationship_type',
          introducedBy: 'introduced_by', notes: 'notes',
        }
        const fieldResolutions: { field: string; kept: 'survivor' | 'duplicate'; value: string }[] = []
        const patchColumns: string[] = []
        const patchValues: any[] = []
        for (const field of MERGEABLE_FIELDS) {
          const column = columnFor[field]
          const resolved = input.resolutions?.[field]
          if (resolved !== undefined) {
            if (resolved !== survivor[column]) {
              patchColumns.push(column); patchValues.push(resolved)
              fieldResolutions.push({ field, kept: resolved === duplicate[column] ? 'duplicate' : 'survivor', value: String(resolved) })
            }
          } else if (!survivor[column] && duplicate[column]) {
            patchColumns.push(column); patchValues.push(duplicate[column])
            fieldResolutions.push({ field, kept: 'duplicate', value: String(duplicate[column]) })
          }
        }

        const mergedPreferredComm = JSON.stringify([...new Set([...survivor.preferred_comm, ...duplicate.preferred_comm])])
        const lastInteractionAt = duplicate.last_interaction_at && (!survivor.last_interaction_at || duplicate.last_interaction_at > survivor.last_interaction_at)
          ? duplicate.last_interaction_at : survivor.last_interaction_at
        const followUpDate = duplicate.follow_up_date && (!survivor.follow_up_date || duplicate.follow_up_date < survivor.follow_up_date)
          ? duplicate.follow_up_date : survivor.follow_up_date
        const visitingCardsMoved = duplicate.visiting_cards.length
        const visitingCards = JSON.stringify([...survivor.visiting_cards, ...duplicate.visiting_cards])

        patchColumns.push('preferred_comm', 'last_interaction_at', 'follow_up_date', 'important_contact', 'connected', 'visiting_cards')
        patchValues.push(mergedPreferredComm, lastInteractionAt, followUpDate,
          survivor.important_contact || duplicate.important_contact, survivor.connected || duplicate.connected, visitingCards)

        const setClauses = patchColumns.map((c, i) => `${c}=$${i + 1}`)
        patchValues.push(survivor.id)
        await client.query(`UPDATE employees SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${patchValues.length}`, patchValues)

        const timelineMoved = (await client.query('UPDATE timeline_events SET employee_id=$1 WHERE employee_id=$2 RETURNING id', [survivor.id, duplicate.id])).rowCount ?? 0
        const transfersMoved = (await client.query('UPDATE transfers SET employee_id=$1 WHERE employee_id=$2 RETURNING id', [survivor.id, duplicate.id])).rowCount ?? 0
        const chargesMoved = (await client.query('UPDATE employee_charges SET employee_id=$1 WHERE employee_id=$2 RETURNING id', [survivor.id, duplicate.id])).rowCount ?? 0
        const directReportsMoved = (await client.query(
          'UPDATE employees SET manager_id=$1 WHERE manager_id=$2 AND id NOT IN ($1,$2) RETURNING id', [survivor.id, duplicate.id],
        )).rowCount ?? 0

        if (survivor.manager_id === duplicate.id) {
          await client.query('UPDATE employees SET manager_id=$1 WHERE id=$2', [duplicate.manager_id, survivor.id])
        }
        await client.query(`UPDATE employees SET manager_id=NULL WHERE id=$1 AND manager_id=$1`, [survivor.id])

        const departmentHeadshipsMoved = (await client.query(
          `UPDATE hierarchy_nodes SET metadata = jsonb_set(metadata, '{deptHead}', to_jsonb($1::text)) WHERE metadata->>'deptHead' = $2 RETURNING id`,
          [survivor.id, duplicate.id],
        )).rowCount ?? 0

        await client.query(`UPDATE employees SET metadata = metadata - 'duplicateOf' WHERE id=$1 AND metadata->>'duplicateOf' = $2`, [survivor.id, duplicate.id])
        await client.query(
          `UPDATE employees SET metadata = jsonb_set(metadata, '{duplicateOf}', to_jsonb($1::text)) WHERE metadata->>'duplicateOf' = $2 AND id <> $1`,
          [survivor.id, duplicate.id],
        )

        await client.query('DELETE FROM employees WHERE id=$1', [duplicate.id])

        const transferred = {
          timelineEvents: timelineMoved, transfers: transfersMoved, directReports: directReportsMoved,
          departmentHeadships: departmentHeadshipsMoved, visitingCards: visitingCardsMoved, charges: chargesMoved,
        }
        const audit = (await client.query(
          `INSERT INTO employee_merge_audit (survivor_id, survivor_name, duplicate_id, duplicate_name, field_resolutions, transferred)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [survivor.id, survivor.name, duplicate.id, duplicate.name, JSON.stringify(fieldResolutions), JSON.stringify(transferred)],
        )).rows[0]
        await client.query(
          `INSERT INTO timeline_events (employee_id, type, custom_label, title, date, note, source)
           VALUES ($1,'custom','Merged duplicate',$2,CURRENT_DATE,'','system')`,
          [survivor.id, `Merged duplicate contact "${duplicate.name || duplicate.designation}" into this record`],
        )
        await client.query('COMMIT')
        const mergedSurvivor = (await attachCharges([(await pool.query('SELECT * FROM employees WHERE id=$1', [survivor.id])).rows[0]]))[0]
        return {
          survivor: mergedSurvivor,
          audit: {
            id: audit.id, survivorId: survivor.id, survivorName: survivor.name,
            duplicateId: duplicate.id, duplicateName: duplicate.name,
            mergedAt: audit.merged_at.toISOString(), fieldResolutions, transferred,
          },
        }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  listMergeAudit: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM employee_merge_audit ORDER BY merged_at DESC')
    return result.rows.map((row) => ({
      id: row.id, survivorId: row.survivor_id, survivorName: row.survivor_name,
      duplicateId: row.duplicate_id, duplicateName: row.duplicate_name,
      mergedAt: row.merged_at.toISOString(), fieldResolutions: row.field_resolutions, transferred: row.transferred,
    }))
  }),
  addCharge: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid(), charge: z.object(chargeInputShape) }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(
          `INSERT INTO employee_charges (employee_id, kind, title, org_node_id, start_date, end_date, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [input.employeeId, input.charge.kind, input.charge.title, input.charge.orgNodeId, input.charge.startDate, input.charge.endDate, input.charge.reason],
        )
        await client.query(
          `INSERT INTO timeline_events (employee_id, type, title, date, note, source) VALUES ($1,$2,$3,$4,$5,'system')`,
          [
            input.employeeId, input.charge.kind === 'acting' ? 'promoted' : 'custom',
            `${input.charge.kind === 'acting' ? 'Acting' : 'Additional'} charge: ${input.charge.title}`,
            input.charge.startDate ?? new Date().toISOString().slice(0, 10), input.charge.reason,
          ],
        )
        await client.query('COMMIT')
        return toCharge(result.rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  removeCharge: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid(), chargeId: z.string().uuid() }))
    .mutation(({ input }) => pool.query('DELETE FROM employee_charges WHERE id=$1 AND employee_id=$2', [input.chargeId, input.employeeId]).then(() => undefined)),
  import: protectedProcedure
    .input(z.object({
      orgNodeId: z.string().uuid(),
      rows: z.array(z.object({ name: z.string(), designation: z.string(), email: z.string().optional(), phone: z.string().optional(), connected: z.boolean().optional() })),
    }))
    .mutation(async ({ input }) => {
      const node = (await pool.query('SELECT id FROM hierarchy_nodes WHERE id=$1', [input.orgNodeId])).rows[0]
      if (!node) return 0
      let added = 0
      for (const row of input.rows) {
        const name = row.name.trim()
        const designation = row.designation.trim()
        if (!name || !designation) continue
        const code = `EMP-NEW-${Math.floor(Math.random() * 9000 + 1000)}`
        const inserted = await pool.query(
          `INSERT INTO employees (code, name, designation, email, phone, org_node_id, manager_id, connected) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7) RETURNING id`,
          [code, name, designation, row.email?.trim() ?? '', row.phone?.trim() ?? '', input.orgNodeId, row.connected ?? true],
        )
        await pool.query(
          `INSERT INTO timeline_events (employee_id, type, title, date, note, source) VALUES ($1,'joined','Contact created',CURRENT_DATE,'','system')`,
          [inserted.rows[0].id],
        )
        added += 1
      }
      return added
    }),
  timeline: timelineRouter,
  transfers: transfersRouter,
})
