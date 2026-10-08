/** Corrigendum register + clause-level change vocabulary (Corrigendum Part 1).
 *  Shared by the web app, the local repository and the API so every layer
 *  validates against the same lists. Stored ids are snake_case; labels are
 *  what the UI shows. */

export const CORRIGENDUM_IMPACT_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type CorrigendumImpactLevel = (typeof CORRIGENDUM_IMPACT_LEVELS)[number]
export const CORRIGENDUM_IMPACT_LABELS: Record<CorrigendumImpactLevel, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}

export const CORRIGENDUM_REVIEW_STATUSES = ['pending', 'reviewed', 'action_required', 'closed'] as const
export type CorrigendumReviewStatus = (typeof CORRIGENDUM_REVIEW_STATUSES)[number]
export const CORRIGENDUM_REVIEW_STATUS_LABELS: Record<CorrigendumReviewStatus, string> = {
  pending: 'Pending', reviewed: 'Reviewed', action_required: 'Action Required', closed: 'Closed',
}

export const CORRIGENDUM_CHANGE_CLASSIFICATIONS = [
  'added', 'modified', 'deleted', 'clarified', 'date_changed', 'quantity_changed',
  'commercial_changed', 'qualification_relaxed', 'qualification_tightened', 'no_material_change',
] as const
export type CorrigendumChangeClassification = (typeof CORRIGENDUM_CHANGE_CLASSIFICATIONS)[number]
export const CORRIGENDUM_CLASSIFICATION_LABELS: Record<CorrigendumChangeClassification, string> = {
  added: 'Added', modified: 'Modified', deleted: 'Deleted', clarified: 'Clarified', date_changed: 'Date Changed',
  quantity_changed: 'Quantity Changed', commercial_changed: 'Commercial Changed',
  qualification_relaxed: 'Qualification Relaxed', qualification_tightened: 'Qualification Tightened',
  no_material_change: 'No Material Change',
}

export const CORRIGENDUM_AFFECTED_MODULES = [
  'sow', 'pq', 'tq', 'manpower', 'milestones', 'payment_terms', 'boq', 'dates', 'sla', 'commercial', 'other',
] as const
export type CorrigendumAffectedModule = (typeof CORRIGENDUM_AFFECTED_MODULES)[number]
export const CORRIGENDUM_MODULE_LABELS: Record<CorrigendumAffectedModule, string> = {
  sow: 'SOW', pq: 'PQ', tq: 'TQ', manpower: 'Manpower', milestones: 'Milestones', payment_terms: 'Payment Terms',
  boq: 'BoQ', dates: 'Dates', sla: 'SLA', commercial: 'Commercial', other: 'Other',
}

/** 'field' = an existing milestone/tender-link change that is applied to the
 *  bid on accept; 'clause' = a tender clause tracked for history only. */
export const CORRIGENDUM_CHANGE_KINDS = ['field', 'clause'] as const
export type CorrigendumChangeKind = (typeof CORRIGENDUM_CHANGE_KINDS)[number]

/** Register short code: 1 → "C1". */
export const corrigendumCode = (n: number): string => `C${n}`
/** Main heading: 2 → "CORRIGENDUM 02". */
export const corrigendumHeading = (n: number): string => `CORRIGENDUM ${String(n).padStart(2, '0')}`
