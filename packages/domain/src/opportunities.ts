/** Opportunity pipeline stages.
 *
 *  Data, not a TypeScript union: a closed union bakes into every stored
 *  `Opportunity.stageKey`, so adding or renaming a stage later would mean
 *  a data migration. `key` is an open string for the same reason — a
 *  retired stage keeps rendering on historical rows. */
export interface PipelineStageDef {
  key: string
  label: string
  /** Display and progression order. Unique across stages. */
  order: number
  /** 0–1, for weighted pipeline value. Closed-won is 1, closed-lost is 0. */
  probability: number
  isClosed: boolean
  isWon: boolean
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  { key: 'pipeline', label: 'Pipeline', order: 0, probability: 0.1, isClosed: false, isWon: false },
  { key: 'qualified', label: 'Qualified', order: 1, probability: 0.3, isClosed: false, isWon: false },
  { key: 'submitted', label: 'Submitted', order: 2, probability: 0.5, isClosed: false, isWon: false },
  { key: 'won', label: 'Won', order: 3, probability: 1, isClosed: true, isWon: true },
  { key: 'lost', label: 'Lost', order: 4, probability: 0, isClosed: true, isWon: false },
  { key: 'dropped', label: 'Dropped', order: 5, probability: 0, isClosed: true, isWon: false },
]

export const PIPELINE_STAGE_MAP: Record<string, PipelineStageDef> =
  Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]))

/** The stage a newly created opportunity starts in, and the stage every
 *  migrated legacy work is assigned. */
export const DEFAULT_STAGE_KEY = 'pipeline'

/** Falls back to the raw key so a historical row referencing a retired
 *  stage still renders something meaningful rather than blank. */
export function stageLabel(key: string): string {
  return PIPELINE_STAGE_MAP[key]?.label ?? key
}
