import { SOURCE_LABEL, type EmployeeSource } from './masterEmployees'

/** Small "also in" badges naming the rosters a person comes from. */
export function SourceBadges({ sources }: { sources: readonly EmployeeSource[] }) {
  if (sources.length === 0) return null
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {sources.map((s) => (
        <span key={s} title={`In the ${SOURCE_LABEL[s]} roster`}
          className="rounded border border-line bg-panel px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-600">
          {SOURCE_LABEL[s]}
        </span>
      ))}
    </span>
  )
}
