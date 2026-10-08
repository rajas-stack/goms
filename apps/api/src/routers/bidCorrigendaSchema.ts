import { z } from 'zod'
import {
  CORRIGENDUM_AFFECTED_MODULES, CORRIGENDUM_CHANGE_CLASSIFICATIONS, CORRIGENDUM_CHANGE_KINDS,
  CORRIGENDUM_IMPACT_LEVELS, CORRIGENDUM_REVIEW_STATUSES,
} from '@goms/domain'

/** Zod input schemas + row mappers for the corrigendum register (Corrigendum
 *  Part 1). Enum lists come from @goms/domain, the same lists the migration's
 *  CHECK constraints mirror. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const CLAUSE_TEXT_MAX = 20_000

export const registerSchema = z.object({
  publishedDate: isoDate.nullable(),
  receivedDate: isoDate.nullable(),
  effectiveDate: isoDate.nullable(),
  affectedSections: z.array(z.enum(CORRIGENDUM_AFFECTED_MODULES)).max(CORRIGENDUM_AFFECTED_MODULES.length),
  impactLevel: z.enum(CORRIGENDUM_IMPACT_LEVELS),
  technicalImpact: z.boolean(),
  commercialImpact: z.boolean(),
  bidDateImpact: z.boolean(),
  submissionDateImpact: z.boolean(),
  reviewOwnerId: z.string().min(1).max(200).nullable(),
  reviewStatus: z.enum(CORRIGENDUM_REVIEW_STATUSES),
  remarks: z.string().max(4000),
}).partial().strict()
export type RegisterPatch = z.infer<typeof registerSchema>

export const changeSchema = z.object({
  fieldKey: z.string().trim().min(1).max(200),
  currentValue: z.string().max(CLAUSE_TEXT_MAX),
  proposedValue: z.string().max(CLAUSE_TEXT_MAX),
  kind: z.enum(CORRIGENDUM_CHANGE_KINDS).optional(),
  clauseTitle: z.string().max(300).optional(),
  affectedModule: z.enum(CORRIGENDUM_AFFECTED_MODULES).optional(),
  classification: z.enum(CORRIGENDUM_CHANGE_CLASSIFICATIONS).optional(),
  impactLevel: z.enum(CORRIGENDUM_IMPACT_LEVELS).optional(),
  sourceRef: z.string().max(300).optional(),
})
export type ChangeInput = z.infer<typeof changeSchema>

/** Same defaults as the web app's `changeDetails` (corrigenda/model.ts): a
 *  change with no `kind` is a legacy milestone-date 'field' change. */
export function changeDefaults(c: ChangeInput) {
  const kind = c.kind ?? 'field'
  const isDateField = kind === 'field' && c.fieldKey !== 'tenderLink'
  return {
    kind,
    clauseTitle: c.clauseTitle?.trim() ?? '',
    affectedModule: c.affectedModule ?? (isDateField ? 'dates' : 'other'),
    classification: c.classification ?? (isDateField ? 'date_changed' : 'modified'),
    impactLevel: c.impactLevel ?? 'medium',
    sourceRef: c.sourceRef?.trim() ?? '',
  }
}

/** Column for each register key — the only names ever interpolated into SQL. */
export const REGISTER_COLUMNS: Record<keyof RegisterPatch, string> = {
  publishedDate: 'published_date', receivedDate: 'received_date', effectiveDate: 'effective_date',
  affectedSections: 'affected_sections', impactLevel: 'impact_level', technicalImpact: 'technical_impact',
  commercialImpact: 'commercial_impact', bidDateImpact: 'bid_date_impact', submissionDateImpact: 'submission_date_impact',
  reviewOwnerId: 'review_owner_id', reviewStatus: 'review_status', remarks: 'remarks',
}

const FIELD_TITLES: Record<string, string> = { submissionDeadline: 'Submission Deadline', tenderLink: 'Tender Link' }
const asDate = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))

export function toChange(row: any) {
  return {
    id: row.id, corrigendumId: row.corrigendum_id, fieldKey: row.field_key, currentValue: row.current_value,
    proposedValue: row.proposed_value, decision: row.decision, decidedAt: row.decided_at, decidedBy: row.decided_by,
    kind: row.kind ?? 'field',
    clauseTitle: row.clause_title || FIELD_TITLES[row.field_key] || row.field_key,
    affectedModule: row.affected_module ?? 'other', classification: row.classification ?? 'modified',
    impactLevel: row.impact_level ?? 'medium', sourceRef: row.source_ref ?? '',
  }
}

export function toBidCorrigendum(row: any, changes: any[]) {
  return {
    id: row.id, bidId: row.bid_id, corrigendumNumber: row.corrigendum_number, sourceDocumentId: row.source_document_id,
    detectedAt: row.detected_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
    // Derived, not stored (spec §12) — flips to 'reviewed' the instant the
    // last pending change is resolved, no separate manual step.
    status: changes.some((c) => c.decision === 'pending') ? 'pending_review' : 'reviewed',
    publishedDate: asDate(row.published_date), receivedDate: asDate(row.received_date), effectiveDate: asDate(row.effective_date),
    affectedSections: row.affected_sections ?? [], impactLevel: row.impact_level ?? 'medium',
    technicalImpact: !!row.technical_impact, commercialImpact: !!row.commercial_impact,
    bidDateImpact: !!row.bid_date_impact, submissionDateImpact: !!row.submission_date_impact,
    reviewOwnerId: row.review_owner_id ?? null, reviewStatus: row.review_status ?? 'pending', remarks: row.remarks ?? '',
    changes: changes.map(toChange),
  }
}
