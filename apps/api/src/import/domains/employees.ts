import { z } from 'zod'
import { classifyRows, resolveTreeReferences, findFuzzyCandidates, caseInsensitiveEnum, cascadeRejectOnRejectedReference } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const STATUSES = ['active', 'archived'] as const

function blankToNull(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  return v
}

const employeeRowSchema = z.object({
  employeeCode: z.string().min(1, 'Employee Code is required').trim(),
  name: z.string().optional().default(''),
  designation: z.string().min(1, 'Designation is required'),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  orgNodeCode: z.string().min(1, 'Org Node Code is required').trim(),
  managerCode: z.preprocess(blankToNull, z.string().trim().min(1).nullable()),
  vacant: z.boolean().optional().default(false),
  status: z.preprocess(
    (v) => (blankToNull(v) === null ? 'active' : v),
    caseInsensitiveEnum(STATUSES, {
      errorMap: () => ({ message: `Status must be one of: ${STATUSES.join(', ')}` }),
    }),
  ),
  // NEW (design spec §6.4): names an org node this employee heads. Resolved
  // against hierarchy_nodes(domain='org', type_key='department') as it
  // exists right now — including any row already committed earlier in this
  // same session's transaction (organizationHierarchy always precedes
  // employees per Task 5's dependency graph).
  departmentHeadOf: z.preprocess(blankToNull, z.string().trim().min(1).nullable()),
}).superRefine((row, ctx) => {
  if (!row.vacant && row.name.trim() === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Name is required' })
  }
  if (row.vacant && row.departmentHeadOf) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['departmentHeadOf'], message: 'A vacant employee cannot be named as a department head' })
  }
})
export type EmployeeRow = z.infer<typeof employeeRowSchema>

interface ExistingEmployee {
  id: string
  name: string
  designation: string
  email: string
  phone: string
  orgNodeCode: string | null
  managerCode: string | null
  vacant: boolean
  status: string
  /** Code of the department-type org node this employee CURRENTLY heads
   *  (metadata.deptHead === this employee's id), or null. Compared in
   *  diffFields below — without this, a row whose only change is a newly
   *  added departmentHeadOf, with every other field identical, would
   *  classify as 'unchanged' and the commit loop would never reach the
   *  metadata-patch step, silently dropping the assignment. This is exactly
   *  the class of bug the redesign's "no silent partial import" rule exists
   *  to close, so it can't be left as a gap here either. */
  currentlyHeadsDeptCode: string | null
}

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

function rawVacant(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  return (raw as Record<string, unknown>).vacant === true
}

function rawDepartmentHeadOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = (raw as Record<string, unknown>).departmentHeadOf
  if (typeof c !== 'string') return null
  const trimmed = c.trim()
  return trimmed === '' ? null : trimmed.toUpperCase()
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingEmployee>> {
  const result = await client.query(
    `SELECT e.*, org.code AS org_node_code, mgr.code AS manager_code, head.code AS heads_dept_code
     FROM employees e
     LEFT JOIN hierarchy_nodes org ON org.id = e.org_node_id
     LEFT JOIN employees mgr ON mgr.id = e.manager_id
     LEFT JOIN hierarchy_nodes head ON head.domain='org' AND head.type_key='department' AND head.metadata->>'deptHead' = e.id::text`,
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
      currentlyHeadsDeptCode: row.heads_dept_code ? String(row.heads_dept_code).trim().toUpperCase() : null,
    })
  }
  return map
}

/** Every department-type org node's code, live right now (existing DB rows
 *  plus any committed earlier in this same session's transaction). */
async function fetchDepartmentCodes(client: { query: Function }): Promise<Set<string>> {
  const result = await client.query(`SELECT code FROM hierarchy_nodes WHERE domain='org' AND type_key='department' AND code IS NOT NULL`)
  return new Set<string>(result.rows.map((r: { code: string }) => String(r.code).trim().toUpperCase()))
}

export async function validateEmployeeRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  const existingEmployeeKeys = new Set(existingByKey.keys())

  const orgCodesResult = await client.query(`SELECT code FROM hierarchy_nodes WHERE domain='org' AND code IS NOT NULL`)
  const existingOrgCodes = new Set<string>(
    orgCodesResult.rows.map((r: { code: string }) => String(r.code).trim().toUpperCase()),
  )
  const existingDeptCodes = await fetchDepartmentCodes(client)

  const { unresolved } = resolveTreeReferences({
    rows: rawRows,
    getOwnKey: rawEmployeeCode,
    getParentKey: rawManagerCode,
    existingKeys: existingEmployeeKeys,
  })
  const unresolvedManagerIndexes = new Set(unresolved)

  // Combines DB-known vacancy with this same file's own rows, so a manager
  // being CREATED by this very upload is still checked (design spec §6.5.7).
  const vacantByCode = new Map<string, boolean>()
  for (const [code, existing] of existingByKey) vacantByCode.set(code, existing.vacant)
  for (const raw of rawRows) {
    const code = rawEmployeeCode(raw)
    if (code) vacantByCode.set(code, rawVacant(raw))
  }

  // departmentHeadOf duplicate-target detection: first row to name a given
  // department wins; every later row naming the SAME department is a hard
  // reject, mirroring the existing "duplicate of row N" convention for
  // Employee Code itself (design spec §6.4: "one head per department, no
  // ambiguity tolerated").
  const firstHeadClaimRow = new Map<string, number>()
  rawRows.forEach((raw, index) => {
    const target = rawDepartmentHeadOf(raw)
    if (target && !firstHeadClaimRow.has(target)) firstHeadClaimRow.set(target, index + 1)
  })

  const preview = classifyRows<unknown, ExistingEmployee>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = employeeRowSchema.safeParse(raw)
      if (parsed.success) return parsed.data.employeeCode.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
      const rawCodeValue = (raw as Record<string, unknown>).employeeCode
      if (typeof rawCodeValue === 'string' && rawCodeValue.trim() !== '') return rawCodeValue.trim().toUpperCase()
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
      // Without this, a row whose ONLY change is a newly-set departmentHeadOf
      // (every other field identical) would classify 'unchanged' and the
      // commit loop below — which only patches metadata for create/update
      // rows — would never run, silently dropping the assignment.
      const rowDeptHeadOf = row.departmentHeadOf ? row.departmentHeadOf.toUpperCase() : null
      if (rowDeptHeadOf !== existing.currentlyHeadsDeptCode) diffs.push({ field: 'departmentHeadOf', oldValue: existing.currentlyHeadsDeptCode, newValue: rowDeptHeadOf })
      return diffs
    },
    validateRow: (raw, index) => {
      const parsed = employeeRowSchema.safeParse(raw)
      if (!parsed.success) {
        return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
      }
      const errors: string[] = []
      let needsReview = false
      let candidates: { key: string; score: number }[] | undefined

      const orgNodeCode = parsed.data.orgNodeCode.toUpperCase()
      if (!existingOrgCodes.has(orgNodeCode)) {
        const suggestions = findFuzzyCandidates(orgNodeCode, existingOrgCodes)
        if (suggestions.length > 0) { needsReview = true; candidates = suggestions }
        errors.push(`no such organization hierarchy code: ${parsed.data.orgNodeCode}`)
      }

      if (unresolvedManagerIndexes.has(index)) {
        const managerCode = rawManagerCode(raw)!
        const suggestions = findFuzzyCandidates(managerCode, existingEmployeeKeys)
        if (suggestions.length > 0) { needsReview = true; candidates = [...(candidates ?? []), ...suggestions].slice(0, 3) }
        errors.push(`Manager Employee Code "${managerCode}" does not match any code in this file or the existing employees`)
      } else if (parsed.data.managerCode && vacantByCode.get(parsed.data.managerCode.toUpperCase()) === true) {
        // Resolves fine, but a vacant seat can't supervise (design spec
        // §6.5.7) — a hard business-rule reject, never fuzzy-eligible.
        errors.push(`Manager Employee Code "${parsed.data.managerCode}" refers to a vacant employee, which cannot supervise anyone`)
      }

      if (parsed.data.departmentHeadOf) {
        const target = parsed.data.departmentHeadOf.toUpperCase()
        if (!existingDeptCodes.has(target)) {
          const suggestions = findFuzzyCandidates(target, existingDeptCodes)
          if (suggestions.length > 0) { needsReview = true; candidates = [...(candidates ?? []), ...suggestions].slice(0, 3) }
          errors.push(`no such department-type organization hierarchy code for Department Head Of: ${parsed.data.departmentHeadOf}`)
        } else if (firstHeadClaimRow.get(target) !== index + 1) {
          errors.push(`Department Head Of "${parsed.data.departmentHeadOf}" is already claimed by row ${firstHeadClaimRow.get(target)} in this file`)
        }
      }

      return { errors, needsReview, candidates }
    },
  })

  // A row can resolve its Manager Employee Code purely because that code
  // appears somewhere in this file — resolveTreeReferences doesn't know
  // whether that manager row will itself survive validation. Cascade the
  // rejection here so a bad manager row never leaves a "create" report
  // pointing at a manager that was never actually written.
  return cascadeRejectOnRejectedReference(preview, rawRows, rawManagerCode, existingEmployeeKeys)
}

export async function commitEmployeeRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  const orgCodeToId = new Map<string, string>()
  const orgResult = await client.query(`SELECT id, code FROM hierarchy_nodes WHERE domain='org' AND code IS NOT NULL`)
  for (const row of orgResult.rows) {
    if (row.code) orgCodeToId.set(String(row.code).trim().toUpperCase(), row.id)
  }

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

      // NEW (design spec §6.4): patch the target org node's metadata.deptHead
      // in place — jsonb_set only ever touches this one key, so any other
      // metadata already on that node (e.g. sales-ownership fields set via
      // DepartmentFields.tsx) survives untouched.
      if (row.departmentHeadOf) {
        await client.query(
          `UPDATE hierarchy_nodes SET metadata = jsonb_set(metadata, '{deptHead}', to_jsonb($1::text)), updated_at=now()
           WHERE domain='org' AND lower(trim(code))=lower(trim($2))`,
          [newId, row.departmentHeadOf],
        )
      }

      progressed = true
    }

    if (!progressed) {
      throw new Error('employees commit: unable to resolve the manager chain for the remaining rows')
    }
    pending = deferred
  }
}
