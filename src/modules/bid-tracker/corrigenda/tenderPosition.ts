import {
  CORRIGENDUM_AFFECTED_MODULES, corrigendumCode,
  type CorrigendumAffectedModule, type CorrigendumChangeClassification, type CorrigendumChangeKind, type CorrigendumImpactLevel,
} from '@goms/domain'
import type { BidCorrigendum, BidCorrigendumChange } from '@/lib/types'

/** Version history + current position of every tender clause/field touched by
 *  any corrigendum. Pure. Nothing is ever overwritten: the original tender
 *  value is the `currentValue` of the clause's EARLIEST change row, and each
 *  later corrigendum adds a version on top (Original → C1 → C2 → … → Current). */

export interface ClauseVersion {
  corrigendumId: string
  corrigendumNumber: number
  publishedDate: string | null
  changeId: string
  before: string
  after: string
  classification: CorrigendumChangeClassification
  impactLevel: CorrigendumImpactLevel
  sourceRef: string
  decision: BidCorrigendumChange['decision']
}

export interface ClauseHistory {
  key: string
  title: string
  module: CorrigendumAffectedModule
  kind: CorrigendumChangeKind
  /** The value in the original tender — never replaced. */
  original: string
  /** Oldest first. Includes rejected versions (shown struck in History View). */
  versions: ClauseVersion[]
  /** Latest valid value: the newest non-rejected version, else the original. */
  current: { value: string; source: ClauseVersion | null }
}

const MODULE_ORDER = new Map(CORRIGENDUM_AFFECTED_MODULES.map((m, i) => [m, i]))

export function buildTenderPosition(corrigenda: readonly BidCorrigendum[]): ClauseHistory[] {
  const ordered = [...corrigenda].sort((a, b) => a.corrigendumNumber - b.corrigendumNumber)
  const byKey = new Map<string, { change: BidCorrigendumChange; version: ClauseVersion }[]>()
  for (const c of ordered) {
    for (const change of c.changes) {
      const version: ClauseVersion = {
        corrigendumId: c.id, corrigendumNumber: c.corrigendumNumber, publishedDate: c.publishedDate, changeId: change.id,
        before: change.currentValue, after: change.proposedValue, classification: change.classification,
        impactLevel: change.impactLevel, sourceRef: change.sourceRef, decision: change.decision,
      }
      byKey.set(change.fieldKey, [...(byKey.get(change.fieldKey) ?? []), { change, version }])
    }
  }
  const histories = [...byKey.entries()].map(([key, entries]): ClauseHistory => {
    const latest = entries[entries.length - 1].change
    const versions = entries.map((e) => e.version)
    const valid = versions.filter((v) => v.decision !== 'rejected')
    const source = valid.length ? valid[valid.length - 1] : null
    const original = versions[0].before
    return {
      key, title: latest.clauseTitle, module: latest.affectedModule, kind: latest.kind,
      original, versions, current: { value: source ? source.after : original, source },
    }
  })
  return histories.sort((a, b) =>
    (MODULE_ORDER.get(a.module) ?? 99) - (MODULE_ORDER.get(b.module) ?? 99) || a.title.localeCompare(b.title))
}

/** "Updated through C2" / "Original tender". */
export const currentSourceLabel = (h: ClauseHistory): string =>
  h.current.source ? `Updated through ${corrigendumCode(h.current.source.corrigendumNumber)}` : 'Original tender'

/** The chain heading for History View: Original Tender → C1 → C2 → Current Effective. */
export function versionChain(corrigenda: readonly Pick<BidCorrigendum, 'corrigendumNumber'>[]): string[] {
  const codes = [...corrigenda].sort((a, b) => a.corrigendumNumber - b.corrigendumNumber).map((c) => corrigendumCode(c.corrigendumNumber))
  return ['Original Tender', ...codes, 'Current Effective']
}
