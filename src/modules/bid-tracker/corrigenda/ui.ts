import type {
  CorrigendumChangeClassification, CorrigendumImpactLevel, CorrigendumReviewStatus,
} from '@goms/domain'
import type { BadgeTone } from '@/components/ui/Badge'
import type { BidCorrigendumChange } from '@/lib/types'

/** Semantic colour for each register/change value — impact escalates
 *  blue → amber → crimson; relaxations read green, tightenings red. */
export const IMPACT_TONE: Record<CorrigendumImpactLevel, BadgeTone> = {
  low: 'emerald', medium: 'blue', high: 'amber', critical: 'crimson',
}
export const REVIEW_STATUS_TONE: Record<CorrigendumReviewStatus, BadgeTone> = {
  pending: 'amber', reviewed: 'blue', action_required: 'crimson', closed: 'emerald',
}
export const CLASSIFICATION_TONE: Record<CorrigendumChangeClassification, BadgeTone> = {
  added: 'emerald', modified: 'indigo', deleted: 'crimson', clarified: 'neutral', date_changed: 'blue',
  quantity_changed: 'amber', commercial_changed: 'purple', qualification_relaxed: 'emerald',
  qualification_tightened: 'crimson', no_material_change: 'gray',
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Milestone ('field') changes store ISO instants — show them as readable
 *  dates so the word diff compares "14 Nov 2026, 15:00", not raw ISO. */
export function displayValue(change: Pick<BidCorrigendumChange, 'kind'>, value: string): string {
  if (change.kind !== 'field' || !ISO_INSTANT.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Section label used above the comparison columns and in the history rail. */
export const eyebrow = 'text-[10.5px] font-semibold uppercase tracking-[0.14em]'
