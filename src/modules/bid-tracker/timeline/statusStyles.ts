// One place for how each status looks, in the app's own tokens. Colour is
// never the only signal: every status also has its own glyph and text label.
import type { MilestoneStatus, TimelineEventSeverity } from './types'

export interface StatusMeta {
  label: string
  /** Icon registry name for the status glyph. */
  glyph: string
  /** Stage segment surface (background + border + text). */
  segment: string
  /** Progress fill inside the current segment. */
  progress: string
  /** Solid fill: actual-execution line, legend swatch, navigator. */
  fill: string
  text: string
}

export const STATUS_META: Record<MilestoneStatus, StatusMeta> = {
  COMPLETED: { label: 'Completed', glyph: 'Check', segment: 'border-emerald-200 bg-emerald-50 text-emerald-800', progress: '', fill: 'bg-emerald', text: 'text-emerald-700' },
  IN_PROGRESS: { label: 'In progress', glyph: 'CircleDot', segment: 'border-blue bg-blue-50 text-blue-700', progress: 'bg-blue-100', fill: 'bg-blue', text: 'text-blue-700' },
  UPCOMING: { label: 'Upcoming', glyph: 'Clock', segment: 'border-dashed border-line bg-panel/60 text-muted', progress: '', fill: 'bg-line', text: 'text-muted' },
  DELAYED: { label: 'Delayed', glyph: 'CircleAlert', segment: 'border-crimson/50 bg-crimson-100 text-crimson', progress: 'bg-crimson/10', fill: 'bg-crimson', text: 'text-crimson' },
  BLOCKED: { label: 'Blocked', glyph: 'Lock', segment: 'border-amber-200 bg-amber-50 text-amber-800', progress: '', fill: 'bg-amber', text: 'text-amber-700' },
}

export const SEVERITY_CLASS: Record<TimelineEventSeverity, string> = {
  Low: 'border-amber-200 bg-amber-50 text-amber-800',
  Medium: 'border-crimson/40 bg-white text-crimson',
  High: 'border-crimson/50 bg-crimson-100 text-crimson',
  Critical: 'border-crimson bg-crimson text-white',
}

/** Gantt grid geometry (px). */
export const GANTT = {
  monthH: 34,
  dayH: 30,
  headerH: 64,
  rowH: 58,
  milestoneH: 92,
  totalH: 64 + 58 * 2 + 92,
  /** Below this many px per day, the day row switches to weekly / monthly ticks. */
  dayMinPx: 24,
} as const
