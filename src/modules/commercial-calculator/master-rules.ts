/** Vertical→Product→Module→Feature parent/child rules, the code-clash check,
 *  and the single-base-currency invariant now live in `@goms/domain` (shared
 *  with apps/api's commercial router, which needs the exact same rules) —
 *  this file re-exports them and keeps the frontend-only `MastersState`
 *  wrappers below. */
import { MASTER_CHILD_OF, MASTER_PARENT_FIELD, enforceSingleBaseCurrency, findMasterCodeClash } from '@goms/domain'
import type { MasterEntityKey, MastersState } from './types'

export { enforceSingleBaseCurrency }

export function validateMasterCode(
  masters: MastersState, key: MasterEntityKey, code: string, excludeId: string | null,
): string | null {
  const trimmed = code.trim()
  if (!trimmed) return 'Code is required.'
  const rows = masters[key] as unknown as { id: string; code: string }[]
  const clash = findMasterCodeClash(rows, code, excludeId)
  return clash ? `Code "${trimmed}" is already used by another ${key} row.` : null
}

export function validateParentExists(
  masters: MastersState, key: MasterEntityKey, input: Record<string, unknown>,
): string | null {
  const rule = MASTER_PARENT_FIELD[key]
  if (!rule) return null
  const parentId = input[rule.field]
  if (typeof parentId !== 'string' || !parentId) return `${rule.field} is required.`
  const rows = masters[rule.parentKey] as unknown as { id: string }[]
  return rows.some((r) => r.id === parentId) ? null : `No such ${rule.parentKey} row: ${parentId}`
}

export function findMasterChildren(masters: MastersState, key: MasterEntityKey, id: string): unknown[] {
  const rule = MASTER_CHILD_OF[key]
  if (!rule) return []
  const rows = masters[rule.childKey] as unknown as Record<string, unknown>[]
  return rows.filter((r) => r[rule.field] === id)
}
