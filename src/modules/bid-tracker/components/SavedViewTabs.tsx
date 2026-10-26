import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidSavedViews } from '@/lib/api'
import { cn } from '@/lib/utils'
import { savedViewNodeId } from '@goms/domain'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { SHEET_VIEWS_NODE } from '../sheets'

/** A sheet's Views node (unknown sheets file under Live Bids', like the API's default). */
export const viewsNodeFor = (sheet = 'bidTracker'): string => SHEET_VIEWS_NODE[sheet as keyof typeof SHEET_VIEWS_NODE] ?? SHEET_VIEWS_NODE.bidTracker

/** The saved-view strip. System views always come first (they are a code
 *  registry the API merges in); user views follow. Only user-created views can
 *  be deleted — system views are structurally immutable. Each one is a
 *  workspace: switching loads its filters, column visibility and column order.
 *  Changes made on a system view can't be saved into it, so the strip says so
 *  (`modifiedViewId`) and offers to keep them as a new view. */
export function SavedViewTabs({ sheet, activeViewId, onChange, onCreateNew, onDelete, modifiedViewId, canDelete, deleting }: {
  /** The Opportunity sheet whose views are listed (default: Live Bids). */
  sheet?: string
  activeViewId: string
  onChange: (id: string) => void
  onCreateNew: () => void
  onDelete?: (id: string) => void
  modifiedViewId?: string | null
  canDelete?: (id: string) => boolean
  deleting?: boolean
}) {
  const { data: allViews = [], isLoading } = useBidSavedViews(sheet)
  // The permission tree: each view is a node under its sheet's Views node (created views appear there automatically).
  const allowed = useNodeFilter()
  const viewsNode = viewsNodeFor(sheet)
  const views = allViews.filter((v) => allowed(savedViewNodeId(viewsNode, v.id)))
  const canCreate = allowed(viewsNode, 'create')
  const treeDelete = (id: string) => allowed(savedViewNodeId(viewsNode, id), 'delete')
  if (isLoading) return null
  const selectedView = views.find(view => view.id === activeViewId)
  const deletable = !!selectedView && !selectedView.isSystem && !!onDelete && (canDelete?.(selectedView.id) ?? true) && treeDelete(selectedView.id)
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-grid-tab px-3 py-1" data-testid="saved-view-tabs">
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
              className={cn('flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md pl-2.5 focus-visible:focus-ring', v.isSystem || !onDelete ? 'pr-2.5' : 'pr-1')}
            >
              {v.name}
              {!v.isSystem && v.scope === 'global' && <span className="text-[10px] opacity-70">Global</span>}
              {modified && <span title="Changed since this view was loaded" className="h-1.5 w-1.5 rounded-full bg-amber" />}
            </button>
            {!v.isSystem && onDelete && (canDelete?.(v.id) ?? true) && treeDelete(v.id) && (
              <button
                type="button" aria-label={`Delete view ${v.name}`} title={`Delete view ${v.name}`} disabled={deleting} onClick={() => onDelete(v.id)}
                className={cn('mr-1 flex h-5 w-5 items-center justify-center rounded focus-visible:focus-ring',
                  active ? 'hover:bg-white/20' : 'text-muted hover:bg-crimson-100 hover:text-crimson')}
              >
                <Icon name="Trash2" size={14} />
              </button>
            )}
          </span>
        )
      })}
      {modifiedViewId && (
        <span className="ml-1 shrink-0 text-[12px] text-amber-600" role="status">Changes not saved to this view</span>
      )}
      {canCreate && <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={onCreateNew}>
        <Icon name="Plus" size={14} /> Create Saved View
      </Button>}
      {onDelete && <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" aria-label="Delete selected view" disabled={!deletable || deleting}
        title={deletable ? `Delete view ${selectedView!.name}` : selectedView?.isSystem ? 'System views cannot be deleted' : 'You cannot delete this view'}
        onClick={() => { if (deletable) onDelete(activeViewId) }}>
        <Icon name="Trash2" size={14} /> Delete View
      </Button>}
    </div>
  )
}
