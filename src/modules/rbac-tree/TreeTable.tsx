import {
  RBAC_ACTIONS, RBAC_ACTION_LABELS, RBAC_KIND_LABELS, cellValue,
  type RbacAction, type RbacGrantMap, type RbacNode, type RbacNodeKind, type RbacResolution, type RbacResolvedCell,
} from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { TriStateCell } from './TriStateCell'
import { isApplicable, nextValue, type TreeRow } from './treeModel'

const KIND_ICON: Record<RbacNodeKind, string> = {
  module: 'Boxes', page: 'FileText', tab: 'PanelsTopLeft', subtab: 'Rows3', section: 'LayoutGrid', view: 'Eye', 'action-area': 'Pin',
}

interface Props {
  rows: TreeRow[]
  draft: RbacGrantMap
  resolution: RbacResolution
  expanded: ReadonlySet<string>
  readOnly: boolean
  labelOf: (id: string | null) => string
  /** "the template", "this role", … for tooltips. */
  sourceName: (layer: string) => string
  onToggle: (id: string) => void
  onCell: (nodeId: string, action: RbacAction, value: ReturnType<typeof nextValue>) => void
  onApplyToChildren: (nodeId: string) => void
}

function explain(cell: RbacResolvedCell | undefined, hiddenBy: string | null, nodeId: string, props: Pick<Props, 'labelOf' | 'sourceName'>): string {
  if (!cell) return ''
  const verdict = cell.allowed ? 'Allowed' : 'Denied'
  if (hiddenBy && hiddenBy !== nodeId && cell.effect === 'allow') return `Denied — View is denied on “${props.labelOf(hiddenBy)}”, which hides everything below it.`
  if (cell.explicit) return `${verdict} — set here (${props.sourceName(cell.source.layer)}). Click to change.`
  if (cell.source.layer === 'default') return `${verdict} — inherited default: nothing above sets it, so it is allowed. Click to set it here.`
  const where = cell.source.nodeId === nodeId ? 'this row' : `“${props.labelOf(cell.source.nodeId)}”`
  return `${verdict} — inherited from ${where} (${props.sourceName(cell.source.layer)}). Click to set it here.`
}

/** The permission tree as an indented table: one row per node, one tri-state cell per action. */
export function TreeTable(props: Props) {
  const { rows, draft, resolution, expanded, readOnly, onToggle, onCell, onApplyToChildren } = props
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin" data-testid="rbac-tree-table">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-paper/95 backdrop-blur">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Area</th>
            {RBAC_ACTIONS.map((a) => (
              <th key={a} scope="col" className="w-[72px] border-b border-line px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{RBAC_ACTION_LABELS[a]}</th>
            ))}
            <th scope="col" className="w-10 border-b border-line"><span className="sr-only">Row actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth, hasChildren }) => (
            <Row key={node.id} node={node} depth={depth} hasChildren={hasChildren} open={expanded.has(node.id)}
              {...{ draft, resolution, readOnly, onToggle, onCell, onApplyToChildren }} explainCell={(cell, hiddenBy) => explain(cell, hiddenBy, node.id, props)} />
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={RBAC_ACTIONS.length + 2} className="px-3 py-10 text-center text-muted">No areas match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Row({ node, depth, hasChildren, open, draft, resolution, readOnly, onToggle, onCell, onApplyToChildren, explainCell }: {
  node: RbacNode; depth: number; hasChildren: boolean; open: boolean
  explainCell: (cell: RbacResolvedCell | undefined, hiddenBy: string | null) => string
} & Pick<Props, 'draft' | 'resolution' | 'readOnly' | 'onToggle' | 'onCell' | 'onApplyToChildren'>) {
  const resolved = resolution.get(node.id)
  const hasOverrides = Object.keys(draft).some((id) => id.startsWith(`${node.id}.`))
  return (
    <tr className={cn('group transition-colors hover:bg-ink-900/[0.03]', node.retired && 'opacity-55', depth === 0 && 'bg-panel/40')}>
      <th scope="row" className="border-b border-line/70 py-1.5 pr-2 text-left font-normal" style={{ paddingLeft: 8 + depth * 18 }}>
        <div className="flex min-w-0 items-center gap-1.5">
          {hasChildren
            ? <button type="button" onClick={() => onToggle(node.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-ink-900/[0.06] hover:text-ink focus-visible:focus-ring">
                <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} />
              </button>
            : <span className="w-6 shrink-0" />}
          <span title={RBAC_KIND_LABELS[node.kind]} className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            depth === 0 ? 'bg-goms-navy text-paper' : 'bg-ink-900/[0.05] text-ink-700')}>
            <Icon name={KIND_ICON[node.kind]} size={13} />
          </span>
          <span className={cn('truncate', depth === 0 ? 'font-semibold text-ink-900' : 'text-ink')} title={node.id}>{node.label}</span>
          <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-muted/70">{RBAC_KIND_LABELS[node.kind]}</span>
          {node.retired && <span className="shrink-0 rounded bg-ink-900/[0.07] px-1.5 text-[10.5px] text-muted" title="No longer in the app; its settings are kept.">Retired</span>}
          {node.runtime && <span className="shrink-0 rounded bg-goms-sky/20 px-1.5 text-[10.5px] text-goms-navy" title="Created from data (a saved view).">Saved view</span>}
        </div>
      </th>
      {RBAC_ACTIONS.map((a) => {
        const value = cellValue(draft, node.id, a)
        const cell = resolved?.cells[a]
        return (
          <td key={a} className="border-b border-line/70 px-1 py-1">
            <TriStateCell value={value} allowed={cell?.allowed ?? true} applicable={isApplicable(node, a)} readOnly={readOnly}
              label={`${node.label} · ${RBAC_ACTION_LABELS[a]}`} explain={explainCell(cell, resolved?.hiddenBy ?? null)}
              onCycle={() => onCell(node.id, a, nextValue(value))} />
          </td>
        )
      })}
      <td className="border-b border-line/70 px-1 text-center">
        {hasChildren && !readOnly && (
          <button type="button" onClick={() => onApplyToChildren(node.id)} disabled={!hasOverrides}
            title={hasOverrides ? 'Apply to all children: clear the overrides below so the whole branch follows this row' : 'Nothing below overrides this row'}
            aria-label={`Apply ${node.label} to all children`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-ink-900/[0.06] hover:text-ink focus-visible:opacity-100 focus-visible:focus-ring group-hover:opacity-100 disabled:opacity-0">
            <Icon name="ChevronsDown" size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}
