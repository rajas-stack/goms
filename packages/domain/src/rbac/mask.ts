import { SKU_COST_FIELDS } from '../commercial.js'
import type { Role } from './types.js'

export const SKU_FLOOR_FIELDS = ['floorPrice', 'minimumAllowedPrice', 'internalPrice'] as const

export type MaskedAtom = 'sku.costs' | 'sku.floor'

export const MASKED_ATOM_FIELDS: Record<MaskedAtom, readonly string[]> = {
  'sku.costs': SKU_COST_FIELDS,
  'sku.floor': SKU_FLOOR_FIELDS,
}

/** Roles that may read each restricted atom (spec §7). */
const MASKED_ATOM_READERS: Record<MaskedAtom, readonly Role[]> = {
  'sku.costs': ['presales', 'finance', 'cxo', 'system_admin'],
  'sku.floor': ['presales', 'finance', 'cxo', 'system_admin'],
}

export const isMaskedAtom = (atom: string): atom is MaskedAtom => atom in MASKED_ATOM_FIELDS

export function canReadAtom(roles: readonly Role[], atom: MaskedAtom): boolean {
  return roles.some((role) => MASKED_ATOM_READERS[atom].includes(role))
}

/** Restricted fields this caller may NOT see. */
export function maskedFieldsFor(roles: readonly Role[]): string[] {
  return (Object.keys(MASKED_ATOM_FIELDS) as MaskedAtom[])
    .filter((atom) => !canReadAtom(roles, atom))
    .flatMap((atom) => [...MASKED_ATOM_FIELDS[atom]])
}

/** Nulls restricted SKU fields (never 0 — a zero would silently corrupt totals) and records which were hidden. */
export function maskSkuRow<T extends object>(row: T, roles: readonly Role[]): T & { maskedFields: string[] } {
  const hidden = maskedFieldsFor(roles)
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = { ...source }
  for (const field of hidden) if (field in out) out[field] = null
  return { ...(out as T), maskedFields: hidden.filter((f) => f in source) }
}

/** Blanks old/new values in an audit entry about a restricted SKU field. */
export function maskAuditEntry<T extends { entityType: string; field: string; oldValue: string; newValue: string }>(
  entry: T, roles: readonly Role[],
): T & { masked?: true } {
  if (entry.entityType === 'sku' && maskedFieldsFor(roles).includes(entry.field)) {
    return { ...entry, oldValue: '', newValue: '', masked: true }
  }
  return entry
}

/** The projection of a Sales Team member that row screens need (owner badges, Geo/BU columns) — no personal data.
 *  Given to roles that can read opportunity rows but have no read on the Sales Team module (gap A4). */
export function redactSalesPerson<T extends Record<string, unknown>>(person: T): T {
  return {
    ...person, personalEmail: '', mobile: '', altMobile: '', notes: '', metadata: {}, employeeCode: '', joinedOn: null, leftOn: null,
  }
}
