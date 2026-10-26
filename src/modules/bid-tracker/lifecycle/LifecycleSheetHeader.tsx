import { OPPORTUNITY_LIFECYCLE, lifecycleIndex, type OwnedSheet } from '@goms/domain'

export function LifecycleSheetHeader({ sheet }: { sheet: OwnedSheet }) {
  const index = lifecycleIndex(sheet)
  const stage = OPPORTUNITY_LIFECYCLE[index]
  return <div className="shrink-0 border-b border-line bg-white px-4 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink-900">{stage.label}</h2>
      <span className="text-xs text-muted">Stage {index + 1} of {OPPORTUNITY_LIFECYCLE.length}</span>
    </div>
    <p className="mt-1 text-xs text-muted">{stage.description} {index > 0 ? 'Earlier-stage information carries forward.' : 'Start here with the client, need and first conversation.'}</p>
    <p className="mt-1 text-xs text-muted">Opportunities remain listed here after advancing. Check Current stage for where they are now.</p>
  </div>
}
