import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidSavedViews } from '@/lib/api'
import { cn } from '@/lib/utils'

/** The saved-view pill row. System views always come first (they are a code
 *  registry the API merges in); user views follow. Only user-created views can
 *  be deleted — system views are structurally immutable. */
export function SavedViewTabs({ activeViewId, onChange, onCreateNew, onDelete }: {
  activeViewId: string
  onChange: (id: string) => void
  onCreateNew: () => void
  onDelete?: (id: string) => void
}) {
  const { data: views = [], isLoading } = useBidSavedViews()
  if (isLoading) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2" data-testid="saved-view-tabs">
      {views.map((v) => {
        const active = v.id === activeViewId
        return (
          <span
            key={v.id}
            className={cn(
              'inline-flex items-center rounded-full text-[13px]',
              active ? 'bg-ink-900 text-paper' : 'bg-ink-900/[0.06] text-ink hover:bg-ink-900/[0.1]',
            )}
          >
            <button
              type="button" aria-pressed={active} onClick={() => onChange(v.id)}
              className={cn('whitespace-nowrap py-1 pl-3 focus-visible:focus-ring rounded-full', v.isSystem || !active || !onDelete ? 'pr-3' : 'pr-1')}
            >
              {v.name}
              {!v.isSystem && v.scope === 'global' && <span className="ml-1 text-[10px] opacity-70">Global</span>}
            </button>
            {!v.isSystem && active && onDelete && (
              <button
                type="button" aria-label={`Delete view ${v.name}`} onClick={() => onDelete(v.id)}
                className="mr-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/20"
              >
                <Icon name="X" size={12} />
              </button>
            )}
          </span>
        )
      })}
      <Button variant="ghost" size="sm" onClick={onCreateNew}><Icon name="Plus" size={14} /> Create Saved View</Button>
    </div>
  )
}
