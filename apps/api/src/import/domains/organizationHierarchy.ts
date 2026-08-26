import { z } from 'zod'
import { classifyRows, resolveTreeReferences } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const NODE_TYPES = ['department', 'branch', 'division', 'office', 'unit'] as const
const STATUSES = ['active', 'archived'] as const

/** Blank cells arrive as `''`/`undefined`/`null` depending on how the caller
 *  parsed the sheet — normalized to `null` before validation so "blank" has
 *  one representation throughout this module. */
function blankToNull(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  return v
}

const orgHierarchyRowSchema = z.object({
  nodeType: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.enum(NODE_TYPES, {
      errorMap: () => ({ message: `Node Type must be one of: ${NODE_TYPES.join(', ')}` }),
    }),
  ),
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Code is required').trim(),
  parentCode: z.preprocess(blankToNull, z.string().trim().min(1).nullable()),
  stateCode: z.preprocess(blankToNull, z.number({ invalid_type_error: 'State Code must be a number' }).nullable()),
  status: z.preprocess(
    (v) => (blankToNull(v) === null ? 'active' : v),
    z.enum(STATUSES, {
      errorMap: () => ({ message: `Status must be one of: ${STATUSES.join(', ')}` }),
    }),
  ),
})
export type OrgHierarchyRow = z.infer<typeof orgHierarchyRowSchema>

interface ExistingOrgNode {
  id: string
  nodeType: string
  name: string
  /** Parent's own code, uppercased — `null` for a root node, or for a node
   *  whose existing parent has no code of its own (nothing to diff against). */
  parentCode: string | null
  stateCode: number | null
  status: string
}

/** Best-effort Code extraction straight off the raw row, used only by
 *  `resolveTreeReferences` (which runs before schema validation, since a
 *  child row's own resolution shouldn't depend on whether some *other* row
 *  in the file happens to be well-formed). */
function rawCode(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const c = (raw as Record<string, unknown>).code
  return typeof c === 'string' ? c.trim().toUpperCase() : ''
}

function rawParentCode(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = (raw as Record<string, unknown>).parentCode
  if (typeof c !== 'string') return null
  const trimmed = c.trim()
  return trimmed === '' ? null : trimmed.toUpperCase()
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingOrgNode>> {
  const result = await client.query(`SELECT * FROM hierarchy_nodes WHERE domain='org'`)
  const idToCode = new Map<string, string>()
  for (const row of result.rows) {
    if (row.code) idToCode.set(row.id, String(row.code).trim().toUpperCase())
  }
  const byCode = new Map<string, ExistingOrgNode>()
  for (const row of result.rows) {
    if (!row.code) continue
    const key = String(row.code).trim().toUpperCase()
    byCode.set(key, {
      id: row.id,
      nodeType: row.type_key,
      name: row.name,
      parentCode: row.parent_id ? idToCode.get(row.parent_id) ?? null : null,
      stateCode: row.state_code,
      status: row.status,
    })
  }
  return byCode
}

export async function validateOrgHierarchyRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  const existingKeys = new Set(existingByKey.keys())

  // Stage 4 (reference resolution): resolves every row's Parent Code against
  // rows already in the database or elsewhere in this same file, regardless
  // of file order — the exact deferred two-pass algorithm the engine
  // provides for self-referencing trees like this one.
  const { unresolved } = resolveTreeReferences({
    rows: rawRows,
    getOwnKey: rawCode,
    getParentKey: rawParentCode,
    existingKeys,
  })
  const unresolvedIndexes = new Set(unresolved)

  return classifyRows<unknown, ExistingOrgNode>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = orgHierarchyRowSchema.safeParse(raw)
      if (parsed.success) return parsed.data.code.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
      const rawCodeValue = (raw as Record<string, unknown>).code
      if (typeof rawCodeValue === 'string' && rawCodeValue.trim() !== '') return rawCodeValue.trim().toUpperCase()
      // Blank/missing/non-string code: key it by its own position so it
      // still reaches validateRow (and gets the precise "Code is required"
      // message) instead of being silently swallowed as a false duplicate.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = orgHierarchyRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.nodeType !== existing.nodeType) diffs.push({ field: 'nodeType', oldValue: existing.nodeType, newValue: row.nodeType })
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      const rowParentCode = row.parentCode ? row.parentCode.toUpperCase() : null
      if (rowParentCode !== existing.parentCode) diffs.push({ field: 'parentCode', oldValue: existing.parentCode, newValue: rowParentCode })
      const rowStateCode = row.stateCode ?? null
      if (rowStateCode !== existing.stateCode) diffs.push({ field: 'stateCode', oldValue: existing.stateCode, newValue: rowStateCode })
      if (row.status !== existing.status) diffs.push({ field: 'status', oldValue: existing.status, newValue: row.status })
      return diffs
    },
    validateRow: (raw, index) => {
      const parsed = orgHierarchyRowSchema.safeParse(raw)
      if (!parsed.success) {
        return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      }
      if (unresolvedIndexes.has(index)) {
        const parentCode = rawParentCode(raw)
        return [`Parent Code "${parentCode}" does not match any code in this file or the existing organization hierarchy`]
      }
      return []
    },
  })
}

export async function commitOrgHierarchyRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  // Seeded with every code already in the database, then grown as rows are
  // written below — lets a create/update row resolve its parent's real DB id
  // regardless of whether that parent appears earlier or later in the file
  // (mirrors the same deferred, retry-until-no-progress strategy
  // `resolveTreeReferences` used during validation, but performing the
  // actual writes this time instead of just checking resolvability).
  const codeToId = new Map<string, string>()
  const existingResult = await client.query(`SELECT id, code FROM hierarchy_nodes WHERE domain='org' AND code IS NOT NULL`)
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
      const row = orgHierarchyRowSchema.parse(item.raw)
      const parentCode = row.parentCode ? row.parentCode.toUpperCase() : null
      const parentId = parentCode === null ? null : codeToId.get(parentCode)
      if (parentCode !== null && parentId === undefined) {
        deferred.push(item)
        continue
      }

      const ownKey = row.code.toUpperCase()
      const action = preview[item.index].action
      let newId: string
      if (action === 'create') {
        const result = await client.query(
          `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
           VALUES ('org',$1,$2,$3,$4,$5,0,'{}',$6) RETURNING id`,
          [row.nodeType, parentId ?? null, row.stateCode ?? null, row.name, row.code, row.status],
        )
        newId = result.rows[0].id
      } else {
        const result = await client.query(
          `UPDATE hierarchy_nodes SET type_key=$2, parent_id=$3, state_code=$4, name=$5, status=$6, updated_at=now()
           WHERE domain='org' AND lower(trim(code))=lower(trim($1)) RETURNING id`,
          [row.code, row.nodeType, parentId ?? null, row.stateCode ?? null, row.name, row.status],
        )
        newId = result.rows[0].id
      }
      codeToId.set(ownKey, newId)
      progressed = true
    }

    if (!progressed) {
      // Shouldn't happen: validateOrgHierarchyRows already rejects any row
      // whose Parent Code doesn't resolve, so every create/update row here
      // should eventually find its parent. Guards against an infinite loop
      // rather than silently dropping rows if that invariant is ever broken
      // (e.g. a race between preview and commit).
      throw new Error('organizationHierarchy commit: unable to resolve the parent chain for the remaining rows')
    }
    pending = deferred
  }
}
