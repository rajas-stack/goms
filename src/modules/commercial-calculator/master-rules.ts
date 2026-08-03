import type { MasterEntityKey, MastersState } from './types'

/** Parent-FK field name for each hierarchy master, keyed by child. */
const PARENT_FIELD: Partial<Record<MasterEntityKey, { parentKey: MasterEntityKey; field: string }>> = {
  products: { parentKey: 'verticals', field: 'verticalId' },
  modules: { parentKey: 'products', field: 'productId' },
  features: { parentKey: 'modules', field: 'moduleId' },
}

/** The inverse of `PARENT_FIELD` — which master (if any) treats this master
 *  as its parent. Drives the delete guard: a row with children can't be
 *  deleted out from under them. */
const CHILD_OF: Partial<Record<MasterEntityKey, { childKey: MasterEntityKey; field: string }>> = {
  verticals: { childKey: 'products', field: 'verticalId' },
  products: { childKey: 'modules', field: 'productId' },
  modules: { childKey: 'features', field: 'moduleId' },
}

export function validateMasterCode(
  masters: MastersState, key: MasterEntityKey, code: string, excludeId: string | null,
): string | null {
  const trimmed = code.trim()
  if (!trimmed) return 'Code is required.'
  const rows = masters[key] as unknown as { id: string; code: string }[]
  const clash = rows.find((r) => r.id !== excludeId && r.code.toLowerCase() === trimmed.toLowerCase())
  return clash ? `Code "${trimmed}" is already used by another ${key} row.` : null
}

export function validateParentExists(
  masters: MastersState, key: MasterEntityKey, input: Record<string, unknown>,
): string | null {
  const rule = PARENT_FIELD[key]
  if (!rule) return null
  const parentId = input[rule.field]
  if (typeof parentId !== 'string' || !parentId) return `${rule.field} is required.`
  const rows = masters[rule.parentKey] as unknown as { id: string }[]
  return rows.some((r) => r.id === parentId) ? null : `No such ${rule.parentKey} row: ${parentId}`
}

export function findMasterChildren(masters: MastersState, key: MasterEntityKey, id: string): unknown[] {
  const rule = CHILD_OF[key]
  if (!rule) return []
  const rows = masters[rule.childKey] as unknown as Record<string, unknown>[]
  return rows.filter((r) => r[rule.field] === id)
}

/** Enforces "exactly one base currency": setting the winner's flag true and
 *  clearing every other row's, in place — same single-winner idea as a radio
 *  group. Mutates `rows` directly, matching how `updateSalesPerson` mutates
 *  in place via `Object.assign` elsewhere in this codebase. */
export function enforceSingleBaseCurrency(rows: { id: string; isBaseCurrency: boolean }[], winnerId: string): void {
  for (const row of rows) {
    row.isBaseCurrency = row.id === winnerId
  }
}
