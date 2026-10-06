import {
  accessFor, maskAuditEntry, redactSalesPerson, type PolicyModuleKey, type UserFacts,
} from '@goms/domain'
import { ROW_MODULES } from './helpers.js'
import type { Check, Requirement } from './types.js'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const canRead = (user: UserFacts, module: PolicyModuleKey) => accessFor(user, module).level !== 'N'

/** Search category → the modules that make it visible (SEARCH_CATEGORIES keys in packages/domain/src/search.ts). */
export const SEARCH_CATEGORY_MODULES: Record<string, PolicyModuleKey[]> = {
  department: ['am.departments'], office: ['am.departments'], employee: ['am.contacts'], meeting: ['am.meetings'],
  geography: ['am.geography'], work: ROW_MODULES, salesPerson: ['team.sales'],
}

/** Removes search results (and related-record groups) whose category the caller cannot read. An unknown category is hidden. */
export function filterSearchResults(data: unknown, user: UserFacts): unknown {
  const visible = (category: unknown) => {
    const modules = typeof category === 'string' ? SEARCH_CATEGORY_MODULES[category] : undefined
    return !!modules && modules.some((m) => canRead(user, m))
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter((i) => !(isRecord(i) && 'category' in i) || visible(i.category)).map(walk)
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    return value
  }
  return walk(data)
}

/** Roster rows for roles that can read opportunity rows but not the Sales Team module: names stay, personal data goes (gap A4). */
export function redactSalesRoster(data: unknown, user: UserFacts): unknown {
  if (canRead(user, 'team.sales')) return data
  if (Array.isArray(data)) return data.map((p) => (isRecord(p) ? redactSalesPerson(p) : p))
  return isRecord(data) ? redactSalesPerson(data) : data
}

export function maskAuditList(data: unknown, user: UserFacts): unknown {
  return Array.isArray(data) ? data.map((e) => (isRecord(e) ? maskAuditEntry(e as any, user.roles) : e)) : data
}

/** Which modules make an audit entry of this entity type readable. */
const AUDIT_ENTITY_MODULES: Record<string, PolicyModuleKey[]> = {
  bid: ROW_MODULES, opportunity: ROW_MODULES, bidCorrigendum: ROW_MODULES, bidCustomFieldValue: ROW_MODULES, bidSavedView: ROW_MODULES,
  bidCustomField: ['bid.columns'], contact: ['am.contacts'], orgNode: ['am.departments'],
  sku: ['com.skus'], boq: ['com.boqs'], boqLineItem: ['com.boqs'], feature: ['com.masters'],
}

/** A scoped audit query follows the entity's module; the global feed (no entity type, or an unknown one) needs `admin.audit`. */
export const auditReadRequirement: Requirement = (raw): Check => {
  const modules = typeof raw?.entityType === 'string' ? AUDIT_ENTITY_MODULES[raw.entityType] : undefined
  return modules ? { module: modules[0], action: 'read', anyOf: modules } : { module: 'admin.audit', action: 'read' }
}
