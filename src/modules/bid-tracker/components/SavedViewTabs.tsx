import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidSavedViews } from '@/lib/api'
import { cn } from '@/lib/utils'

/** The saved-view strip. System views always come first (they are a code
 *  registry the API merges in); user views follow. Only user-created views can
 *  be deleted — system views are structurally immutable. Each one is a
 *  workspace: switching loads its filters, column visibility and column order.
 *  Changes made on a system view can't be saved into it, so the strip says so
 *  (`modifiedViewId`) and offers to keep them as a new view. */
export function SavedViewTabs({ activeViewId, onChange, onCreateNew, onDelete, modifiedViewId }: {
  activeViewId: string
  onChange: (id: string) => void
  onCreateNew: () => void
  onDelete?: (id: string) => void
  modifiedViewId?: string | null
}) {
  const { data: views = [], isLoading } = useBidSavedViews()
  if (isLoading) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-[#F1F6FA] px-3 py-1" data-testid="saved-view-tabs">
      <span className="mr-1 shrink-0 text-[12px] font-semibold text-muted">Views</span>
      {views.map((v) => {
        const active = v.id === activeViewId
        const modified = active && modifiedViewId === v.id
        return (
          <span
            key={v.id}
            className={cn(
              'inline-flex shrink-0 items-center rounded-md text-[13px] transition-colors',
              active ? 'bg-goms-navy text-paper shadow-sm' : 'text-ink hover:bg-goms-sky/[0.14]',
            )}
          >
            <button
              type="button" aria-pressed={active} onClick={() => onChange(v.id)}
              className={cn('flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md pl-2.5 focus-visible:focus-ring', v.isSystem || !active || !onDelete ? 'pr-2.5' : 'pr-1')}
            >
              {v.name}
              {!v.isSystem && v.scope === 'global' && <span className="text-[10px] opacity-70">Global</span>}
              {modified && <span title="Changed since this view was loaded" className="h-1.5 w-1.5 rounded-full bg-amber" />}
            </button>
            {!v.isSystem && active && onDelete && (
              <button
                type="button" aria-label={`Delete view ${v.name}`} onClick={() => onDelete(v.id)}
                className="mr-1 flex h-5 w-5 items-center justify-center rounded hover:bg-white/20"
              >
                <Icon name="X" size={12} />
              </button>
            )}
          </span>
        )
      })}
      {modifiedViewId && (
        <span className="ml-1 shrink-0 text-[12px] text-amber-600" role="status">Changes not saved to this view</span>
      )}
      <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={onCreateNew}>
        <Icon name="Plus" size={14} /> Create Saved View
      </Button>
    </div>
  )
}
