export type ImportDomainKey =
  | 'taxClasses' | 'commercialMastersFlat' | 'currencies' | 'approvalMatrix'
  | 'commercialMastersCatalog' | 'organizationHierarchy' | 'employees'
  | 'salesRoster' | 'skus' | 'bom' | 'geography'

export type ImportAction = 'create' | 'update' | 'unchanged' | 'needs-review' | 'reject'

export interface ImportFieldDiff {
  field: string
  oldValue: unknown
  newValue: unknown
}

export interface FuzzyCandidate {
  key: string
  score: number
}

export interface ImportRowResult {
  /** 1-based, matches the uploaded sheet's data row (header row excluded). */
  rowNumber: number
  /** Set only for multi-sheet templates (e.g. Sales Roster's "Postings" sheet). */
  sheet?: string
  businessKey: string
  action: ImportAction
  /** Present only when action === 'update'. */
  diff?: ImportFieldDiff[]
  /** Present only when action === 'needs-review'. */
  candidates?: FuzzyCandidate[]
  /** Set only by the session commit path when a row was explicitly excluded, never by validate. */
  excludeReason?: string
  /** Present only when action === 'reject' or 'needs-review'; empty array otherwise. */
  errors: string[]
}

export interface ImportSummary {
  toCreate: number
  toUpdate: number
  unchanged: number
  needsReview: number
  rejected: number
  total: number
}

export interface ImportPreview {
  domain: ImportDomainKey
  rows: ImportRowResult[]
  summary: ImportSummary
  commitToken: string
}
