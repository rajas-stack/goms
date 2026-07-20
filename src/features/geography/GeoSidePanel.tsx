import { useOrgRoots } from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { Icon } from '@/components/ui/Icon'
import type { HierNode } from '@/lib/types'

/** Administrative side panel shown beside every geography map. Updates as the
 *  user drills down: the current region's identity plus the departments
 *  operating in the enclosing state (the jurisdiction level the data model
 *  records). Reuses the same workspace selection as the rest of the app, so
 *  clicking a department opens it in the details panel. */
export function GeoSidePanel({
  region, levelLabel, stateCode, stateName,
}: {
  region: HierNode | { name: string; code: string | null } | null
  levelLabel: string
  stateCode: number | null
  stateName: string | null
}) {
  const ws = useWorkspace()
  const { data: departments = [] } = useOrgRoots(stateCode ?? -1)

  const isState = levelLabel === 'State'
  const deptHeading = isState
    ? 'Departments under this State'
    : `Departments operating in this ${levelLabel}`

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-card border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <span className="eyebrow">{levelLabel}</span>
        <h3 className="mt-0.5 break-words font-display text-lg font-bold text-ink-900">
          {region?.name ?? '—'}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
          {!isState && stateName && <span className="break-words">in {stateName}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-ink-800">{deptHeading}</span>
          <span className="font-mono text-[11px] text-muted">{departments.length}</span>
        </div>
        {!isState && (
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            Jurisdiction is recorded at the state level; these operate across {stateName ?? 'this state'}.
          </p>
        )}
        {departments.length === 0 ? (
          <p className="text-sm text-muted">No departments recorded for this state.</p>
        ) : (
          <div className="space-y-1">
            {departments.map((d) => (
              <button
                key={d.id}
                onClick={() => ws.select('node', d.id)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left transition-colors hover:border-ink-600"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-paper">
                  <Icon name="Landmark" size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] font-medium text-ink-900">
                    Department of {d.name}
                  </span>
                  {d.metadata.shortName && (
                    <span className="block truncate text-[11px] text-muted">{d.metadata.shortName}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
