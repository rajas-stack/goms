import {
  CORRIGENDUM_AFFECTED_MODULES, CORRIGENDUM_CHANGE_CLASSIFICATIONS, CORRIGENDUM_IMPACT_LEVELS, CORRIGENDUM_REVIEW_STATUSES,
  type CorrigendumAffectedModule,
} from '@goms/domain'
import type { BidCorrigendum, BidCorrigendumChange, CorrigendumChangeDetails, CorrigendumRegister } from '@/lib/types'

/** One change as the user records it. Everything past the three core fields
 *  is optional so the original milestone-only callers keep working. */
export interface CorrigendumChangeInput extends Partial<CorrigendumChangeDetails> {
  fieldKey: string; currentValue: string; proposedValue: string
}
export interface CreateCorrigendumInput {
  bidId: string; corrigendumNumber: number; sourceDocumentId?: string
  register?: Partial<CorrigendumRegister>
  changes: CorrigendumChangeInput[]
}
export interface UpdateCorrigendumRegisterInput { corrigendumId: string; patch: Partial<CorrigendumRegister> }

export const DEFAULT_REGISTER: CorrigendumRegister = {
  publishedDate: null, receivedDate: null, effectiveDate: null, affectedSections: [], impactLevel: 'medium',
  technicalImpact: false, commercialImpact: false, bidDateImpact: false, submissionDateImpact: false,
  reviewOwnerId: null, reviewStatus: 'pending', remarks: '',
}

const FIELD_TITLES: Record<string, string> = { submissionDeadline: 'Submission Deadline', tenderLink: 'Tender Link' }

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback
const isoDateOrNull = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** Detail defaults for a change. A legacy milestone change (no `kind`) is a
 *  'field' change on the Dates module, which is exactly what it always was. */
export function changeDetails(input: Partial<CorrigendumChangeDetails> & { fieldKey: string }): CorrigendumChangeDetails {
  const kind = input.kind === 'clause' ? 'clause' : 'field'
  const isDateField = kind === 'field' && input.fieldKey !== 'tenderLink'
  return {
    kind,
    clauseTitle: input.clauseTitle?.trim() || FIELD_TITLES[input.fieldKey] || input.fieldKey,
    affectedModule: oneOf(CORRIGENDUM_AFFECTED_MODULES, input.affectedModule, isDateField ? 'dates' : 'other'),
    classification: oneOf(CORRIGENDUM_CHANGE_CLASSIFICATIONS, input.classification, isDateField ? 'date_changed' : 'modified'),
    impactLevel: oneOf(CORRIGENDUM_IMPACT_LEVELS, input.impactLevel, 'medium'),
    sourceRef: input.sourceRef?.trim() ?? '',
  }
}

/** Register values with every unknown/missing field replaced by its default —
 *  used on write (validation) and on read (snapshots that predate Part 1). */
export function normalizeRegister(input: Partial<CorrigendumRegister> | undefined): CorrigendumRegister {
  const r = input ?? {}
  return {
    publishedDate: isoDateOrNull(r.publishedDate),
    receivedDate: isoDateOrNull(r.receivedDate),
    effectiveDate: isoDateOrNull(r.effectiveDate),
    affectedSections: Array.isArray(r.affectedSections)
      ? [...new Set(r.affectedSections.filter((m): m is CorrigendumAffectedModule => (CORRIGENDUM_AFFECTED_MODULES as readonly string[]).includes(m)))]
      : [],
    impactLevel: oneOf(CORRIGENDUM_IMPACT_LEVELS, r.impactLevel, 'medium'),
    technicalImpact: r.technicalImpact === true,
    commercialImpact: r.commercialImpact === true,
    bidDateImpact: r.bidDateImpact === true,
    submissionDateImpact: r.submissionDateImpact === true,
    reviewOwnerId: typeof r.reviewOwnerId === 'string' && r.reviewOwnerId ? r.reviewOwnerId : null,
    reviewStatus: oneOf(CORRIGENDUM_REVIEW_STATUSES, r.reviewStatus, 'pending'),
    remarks: typeof r.remarks === 'string' ? r.remarks : '',
  }
}

/** Applies only the keys present in `patch`, validating each. */
export function patchRegister(current: CorrigendumRegister, patch: Partial<CorrigendumRegister>): CorrigendumRegister {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<CorrigendumRegister>
  return normalizeRegister({ ...current, ...defined })
}

export function normalizeChange(change: Partial<BidCorrigendumChange> & Pick<BidCorrigendumChange, 'id' | 'corrigendumId' | 'fieldKey'>): BidCorrigendumChange {
  return {
    id: change.id, corrigendumId: change.corrigendumId, fieldKey: change.fieldKey,
    currentValue: change.currentValue ?? '', proposedValue: change.proposedValue ?? '',
    decision: change.decision ?? 'pending', decidedAt: change.decidedAt ?? null, decidedBy: change.decidedBy ?? null,
    ...changeDetails(change),
  }
}

export interface CorrigendumStats { numberOfChanges: number; openActions: number }
/** Number of Changes = every recorded change; Open Actions = changes still
 *  awaiting an accept/reject decision. Both derived, never stored. */
export const corrigendumStats = (c: Pick<BidCorrigendum, 'changes'>): CorrigendumStats => ({
  numberOfChanges: c.changes.length,
  openActions: c.changes.filter((ch) => ch.decision === 'pending').length,
})

/** "2026-10-14" → "14 Oct 2026" (no timezone shift: parsed as parts). */
export function formatRegisterDate(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}
