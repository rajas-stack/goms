import { z } from 'zod'
import { classifyRows, resolveTreeReferences } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const STATUSES = ['active', 'archived'] as const

/** Blank cells arrive as `''`/`undefined`/`null` depending on how the caller
 *  parsed the sheet — normalized to `null` before validation so "blank" has
 *  one representation throughout this module. Mirrors
 *  organizationHierarchy.ts's own `blankToNull` (not exported from there, so
 *  redefined here rather than reaching across domain modules for it). */
function blankToNull(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  return v
}

const employeeRowSchema = z.object({
  employeeCode: z.string().min(1, 'Employee Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  designation: z.string().min(1, 'Designation is required'),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  orgNodeCode: z.string().min(1, 'Org Node Code is required').trim(),
  managerCode: z.preprocess(blankToNull, z.string().trim().min(1).nullable()),
  vacant: z.boolean().optional().default(false),
  status: z.preprocess(
    (v) => (blankToNull(v) === null ? 'active' : v),
    z.enum(STATUSES, {
      errorMap: () => ({ message: `Status must be one of: ${STATUSES.join(', ')}` }),
    }),
  ),
})
export type EmployeeRow = z.infer<typeof employeeRowSchema>

interface ExistingEmployee {
  id: string
  name: string
  designation: string
  email: string
  phone: string
  /** Uppercased code of the employee's current org node, or `null` if the
   *  node it points at has no code of its own (shouldn't happen for a node
   *  written by this importer, but a manually-created node might lack one). */
  orgNodeCode: string | null
  /** Uppercased code of the employee's current manager, or `null` if
   *  unmanaged. */
  managerCode: string | null
  vacant: boolean
  status: string
}

/** Best-effort Employee Code / Manager Code extraction straight off the raw
 *  row, used only by `resolveTreeReferences` (which runs before schema
 *  validation, since a report row's own manager resolution shouldn't depend
 *  on whether some *other* row in the file happens to be well-formed). */
function rawEmployeeCode(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const c = (raw as Record<string, unknown>).employeeCode
  return typeof c === 'string' ? c.trim().toUpperCase() : ''
}

function rawManagerCode(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = (raw as Record<string, unknown>).managerCode
  if (typeof c !== 'string') return null
  const trimmed = c.trim()
  return trimmed === '' ? null : trimmed.toUpperCase()
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingEmployee>> {
  const result = await client.query(
    `SELECT e.*, org.code AS org_node_code, mgr.code AS manager_code
     FROM employees e
     LEFT JOIN hierarchy_nodes org ON org.id = e.org_node_id
     LEFT JOIN employees mgr ON mgr.id = e.manager_id`,
  )
  const map = new Map<string, ExistingEmployee>()
  for (const row of result.rows) {
    map.set(String(row.code).trim().toUpperCase(), {
      id: row.id,
      name: row.name,
      designation: row.designation,
      email: row.email,
      phone: row.phone,
      orgNodeCode: row.org_node_code ? String(row.org_node_code).trim().toUpperCase() : null,
      managerCode: row.manager_code ? String(row.manager_code).trim().toUpperCase() : null,
      vacant: row.vacant,
      status: row.status,
    })
  }
  return map
}

export async function validateEmployeeRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  const existingEmployeeKeys = new Set(existingByKey.keys())

  // Hard dependency (Task 12): Org Node Code must resolve against
  // hierarchy_nodes(domain='org') as it exists in the database right now —
  // this importer never creates org nodes itself, so there's nothing to
  // resolve against "elsewhere in this same file" the way Manager Employee
  // Code does. employees.org_node_id is NOT NULL REFERENCES ... ON DELETE
  // RESTRICT, so an unresolvable code must be rejected here, before commit
  // is even attempted, rather than surfacing as a raw 23503 FK violation.
  const orgCodesResult = await client.query(`SELECT code FROM hierarchy_nodes WHERE domain='org' AND code IS NOT NULL`)
  const existingOrgCodes = new Set<string>(
    orgCodesResult.rows.map((r: { code: string }) => String(r.code).trim().toUpperCase()),
  )

  // Stage 4 (self-reference resolution): Manager Employee Code can name
  // another row earlier or later in this same file — the same deferred
  // two-pass resolver organizationHierarchy.ts uses for Parent Code.
  const { unresolved } = resolveTreeReferences({
    rows: rawRows,
    getOwnKey: rawEmployeeCode,
    getParentKey: rawManagerCode,
    existingKeys: existingEmployeeKeys,
  })
  const unresolvedManagerIndexes = new Set(unresolved)

  return classifyRows<unknown, ExistingEmployee>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = employeeRowSchema.safeParse(raw)
      if (parsed.success) return parsed.data.employeeCode.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
      const rawCodeValue = (raw as Record<string, unknown>).employeeCode
      if (typeof rawCodeValue === 'string' && rawCodeValue.trim() !== '') return rawCodeValue.trim().toUpperCase()
      // Blank/missing/non-string Employee Code: still a distinct, valid row —
      // key it by its own position so it reaches validateRow (and gets the
      // precise "Employee Code is required" message) instead of being
      // silently swallowed as a false duplicate of some other blank-coded row.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = employeeRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (row.designation !== existing.designation) diffs.push({ field: 'designation', oldValue: existing.designation, newValue: row.designation })
      if (row.email !== existing.email) diffs.push({ field: 'email', oldValue: existing.email, newValue: row.email })
      if (row.phone !== existing.phone) diffs.push({ field: 'phone', oldValue: existing.phone, newValue: row.phone })
      const rowOrgNodeCode = row.orgNodeCode.toUpperCase()
      if (rowOrgNodeCode !== existing.orgNodeCode) diffs.push({ field: 'orgNodeCode', oldValue: existing.orgNodeCode, newValue: rowOrgNodeCode })
      const rowManagerCode = row.managerCode ? row.managerCode.toUpperCase() : null
      if (rowManagerCode !== existing.managerCode) diffs.push({ field: 'managerCode', oldValue: existing.managerCode, newValue: rowManagerCode })
      if (row.vacant !== existing.vacant) diffs.push({ field: 'vacant', oldValue: existing.vacant, newValue: row.vacant })
      if (row.status !== existing.status) diffs.push({ field: 'status', oldValue: existing.status, newValue: row.status })
      return diffs
    },
    validateRow: (raw, index) => {
      const parsed = employeeRowSchema.safeParse(raw)
      if (!parsed.success) {
        return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      }
      const errors: string[] = []
      const orgNodeCode = parsed.data.orgNodeCode.toUpperCase()
      if (!existingOrgCodes.has(orgNodeCode)) {
        errors.push(`no such organization hierarchy code: ${parsed.data.orgNodeCode}`)
      }
      if (unresolvedManagerIndexes.has(index)) {
        const managerCode = rawManagerCode(raw)
        errors.push(`Manager Employee Code "${managerCode}" does not match any code in this file or the existing employees`)
      }
      return errors
    },
  })
}

export async function commitEmployeeRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  // Org Node Code always resolves in one pass — validateEmployeeRows already
  // rejected any row whose code doesn't exist, and this importer never
  // creates org nodes itself, so there's no "resolve, defer, retry" needed
  // for it the way there is for the manager chain below.
  const orgCodeToId = new Map<string, string>()
  const orgResult = await client.query(`SELECT id, code FROM hierarchy_nodes WHERE domain='org' AND code IS NOT NULL`)
  for (const row of orgResult.rows) {
    if (row.code) orgCodeToId.set(String(row.code).trim().toUpperCase(), row.id)
  }

  // Seeded with every employee code already in the database, then grown as
  // rows are written below — lets a create/update row resolve its manager's
  // real DB id regardless of whether that manager appears earlier or later
  // in the file (same deferred, retry-until-no-progress strategy
  // `resolveTreeReferences` used during validation, but performing the
  // actual writes this time instead of just checking resolvability).
  const codeToId = new Map<string, string>()
  const existingResult = await client.query(`SELECT id, code FROM employees`)
  for (const row of existingResult.rows) {
    if (row.code) codeToId.set(String(row.code).trim().toUpperCase(), row.id)
  }

  let pending = rawRows
    .map((raw, index) => ({ raw, index }))
    .filter(({ index }) => preview[index].action === 'create' || preview[index].action === 'update')

  while (pending.length > 0) {
    const deferred: typeof pending = []
    let progressed = false

    for (const item of pending) {
      const row = employeeRowSchema.parse(item.raw)
      const managerCode = row.managerCode ? row.managerCode.toUpperCase() : null
      const managerId = managerCode === null ? null : codeToId.get(managerCode)
      if (managerCode !== null && managerId === undefined) {
        deferred.push(item)
        continue
      }

      // Guaranteed defined: validateEmployeeRows already rejected any row
      // whose Org Node Code doesn't resolve against the database.
      const orgNodeId = orgCodeToId.get(row.orgNodeCode.toUpperCase())!

      const ownKey = row.employeeCode.toUpperCase()
      const action = preview[item.index].action
      let newId: string
      if (action === 'create') {
        const result = await client.query(
          `INSERT INTO employees (code, name, designation, email, phone, org_node_id, manager_id, vacant, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [row.employeeCode, row.name, row.designation, row.email, row.phone, orgNodeId, managerId ?? null, row.vacant, row.status],
        )
        newId = result.rows[0].id
      } else {
        const result = await client.query(
          `UPDATE employees SET name=$2, designation=$3, email=$4, phone=$5, org_node_id=$6, manager_id=$7, vacant=$8, status=$9, updated_at=now()
           WHERE lower(trim(code))=lower(trim($1)) RETURNING id`,
          [row.employeeCode, row.name, row.designation, row.email, row.phone, orgNodeId, managerId ?? null, row.vacant, row.status],
        )
        newId = result.rows[0].id
      }
      codeToId.set(ownKey, newId)
      progressed = true
    }

    if (!progressed) {
      // Shouldn't happen: validateEmployeeRows already rejects any row whose
      // Manager Employee Code doesn't resolve, so every create/update row
      // here should eventually find its manager. Guards against an infinite
      // loop rather than silently dropping rows if that invariant is ever
      // broken (e.g. a race between preview and commit).
      throw new Error('employees commit: unable to resolve the manager chain for the remaining rows')
    }
    pending = deferred
  }
}
