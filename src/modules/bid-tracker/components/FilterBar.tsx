import { Fragment, useRef } from 'react'
import { motion } from 'framer-motion'
import { isFilterGroup, type FilterNode, type TypedFilterRule } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'
import { NO_LOOKUPS, isRuleComplete, operatorLabel, optionsOf, type EntityLookups, type GridColumnMeta } from '../gridColumns'
import { fromRoot, removeAt, toRoot, type NodePath } from '../filterTree'
import { FilterBuilder } from './FilterBuilder'

/** The value half of a rule, as words ("Solutioning, Qualification", "2026-01-01 – 2026-01-09"). */
export function ruleValueText(rule: TypedFilterRule, col: GridColumnMeta | undefined, lookups: EntityLookups = NO_LOOKUPS): string {
  const type = col?.type ?? null
  const options = optionsOf(col, lookups)
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  if (rule.operator === 'in') return (rule.values ?? []).map(labelOf).join(', ')
  if (rule.operator === 'between') return `${rule.value} – ${rule.value2 ?? ''}`
  if (type === 'boolean') return rule.value === 'true' ? 'true' : rule.value === 'false' ? 'false' : ''
  return labelOf(rule.value)
}

export function ruleSummary(rule: TypedFilterRule, col: GridColumnMeta | undefined, lookups: EntityLookups = NO_LOOKUPS): string {
  return `${col?.header ?? rule.field} ${operatorLabel(col?.type ?? null, rule.operator)} ${ruleValueText(rule, col, lookups)}`
}

const pathKey = (path: NodePath) => path.join('.')

function Chip({ rule, col, lookups, open, columns, rules, onOpen, onClose, onChange, onRemove }: {
  rule: TypedFilterRule
  col: GridColumnMeta | undefined
  lookups: EntityLookups
  open: boolean
  columns: GridColumnMeta[]
  rules: FilterNode[]
  onOpen: () => void
  onClose: () => void
  onChange: (rules: FilterNode[]) => void
  onRemove: () => void
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const complete = isRuleComplete(rule)
  const value = ruleValueText(rule, col, lookups)
  const summary = ruleSummary(rule, col, lookups)
  return (
    <span
      ref={anchorRef}
      className={cn(
        'inline-flex h-7 max-w-[26rem] items-center rounded-md border bg-white text-[12.5px]',
        complete ? 'border-goms-sky' : 'border-dashed border-goms-navy/40',
        open && 'ring-2 ring-goms-sky/40',
      )}
    >
      <button
        type="button" onClick={onOpen} aria-expanded={open} aria-label={`Edit filter ${summary}`}
        className="flex min-w-0 items-center gap-1.5 rounded-l-md py-0.5 pl-2 pr-1.5 hover:bg-goms-sky/[0.12] focus-visible:focus-ring"
      >
        <span className="font-semibold text-goms-navy">{col?.header ?? rule.field}</span>{' '}
        <span className="text-muted">{operatorLabel(col?.type ?? null, rule.operator)}</span>{' '}
        <span className={cn('min-w-0 truncate rounded bg-goms-sky/[0.18] px-1.5 text-goms-navy', !value && 'bg-transparent italic text-muted')}>
          {value || 'choose a value'}
        </span>
      </button>
      <button
        type="button" aria-label={`Clear filter ${summary}`} onClick={onRemove}
        className="flex h-7 w-6 items-center justify-center rounded-r-md text-muted hover:bg-crimson-100 hover:text-crimson focus-visible:focus-ring"
      >
        <Icon name="X" size={12} />
      </button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={onClose} maxPanelHeight={460}>
        {({ maxHeight }) => (
          <motion.div
            data-canvas-ui initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            style={{ maxHeight }} className="overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper shadow-pop"
          >
            <FilterBuilder columns={columns} rules={rules} onChange={onChange} lookups={lookups} />
          </motion.div>
        )}
      </PopoverPanel>
    </span>
  )
}

/** `WHERE [Field] [operator] [value]  AND (…  OR …)` — every active condition,
 *  always visible above the grid. Click a condition to edit it, × removes just
 *  that one, "Add condition" appends another. Top-level conditions are joined
 *  by the filter's "all / any" setting; a bracketed group has its own. */
export function FilterBar({ rules, columns, columnById, lookups = NO_LOOKUPS, ignoredCount, editing, onEditing, onChange, onAdd }: {
  rules: FilterNode[]
  /** Filterable columns only (type !== null). */
  columns: GridColumnMeta[]
  columnById: Map<string, GridColumnMeta>
  lookups?: EntityLookups
  ignoredCount: number
  /** Path key (`"2"` or `"1.0"`) of the condition whose editor is open, if any. */
  editing: string | null
  onEditing: (key: string | null) => void
  onChange: (rules: FilterNode[]) => void
  onAdd: () => void
}) {
  const root = toRoot(rules)
  // A rule on an archived custom column is ignored (and noted below), not shown as a live condition.
  const live = (r: TypedFilterRule) => columnById.has(r.field) || !r.field.startsWith('custom:')

  const chip = (rule: TypedFilterRule, path: NodePath) => {
    const key = pathKey(path)
    return (
      <Chip
        rule={rule} col={columnById.get(rule.field)} lookups={lookups} open={editing === key} columns={columns} rules={rules}
        onOpen={() => onEditing(editing === key ? null : key)} onClose={() => { if (editing === key) onEditing(null) }}
        onChange={onChange}
        onRemove={() => {
          onEditing(null)
          // Root "any" is stored as one wrapping group, so a path is relative to its items.
          onChange(fromRoot({ ...root, items: removeAt(root.items, path) }))
        }}
      />
    )
  }
  const word = (logic: 'and' | 'or') => <span className="text-[11px] font-semibold text-muted">{logic === 'and' ? 'and' : 'or'}</span>

  let shown = 0
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-goms-sky/30 bg-goms-sky/[0.08] px-3 py-1.5" data-testid="active-filters">
      <span className="mr-0.5 text-[12px] font-semibold tracking-wide text-goms-navy">Where</span>
      {root.items.map((node, i) => {
        if (isFilterGroup(node)) {
          const kids = node.rules.flatMap((r, j) => (isFilterGroup(r) || !live(r) ? [] : [{ r, j }]))
          if (!kids.length) return null
          const lead = shown++ > 0
          return (
            <Fragment key={i}>
              {lead && word(root.logic)}
              <span
                data-testid="active-filter-group"
                className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-goms-navy/20 bg-white/60 px-1.5 py-0.5"
              >
                <span aria-hidden className="text-[15px] leading-none text-goms-navy/60">(</span>
                {kids.map(({ r, j }, k) => (
                  <Fragment key={j}>
                    {k > 0 && word(node.logic)}
                    {chip(r, [i, j])}
                  </Fragment>
                ))}
                <span aria-hidden className="text-[15px] leading-none text-goms-navy/60">)</span>
              </span>
            </Fragment>
          )
        }
        if (!live(node)) return null
        const lead = shown++ > 0
        return (
          <Fragment key={i}>
            {lead && word(root.logic)}
            {chip(node, [i])}
          </Fragment>
        )
      })}
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onAdd}><Icon name="Plus" size={13} /> Add condition</Button>
      {rules.length > 0 && (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { onEditing(null); onChange([]) }}>Clear all filters</Button>
      )}
      {ignoredCount > 0 && (
        <span role="status" className="text-[12px] text-amber-600">
          {ignoredCount} filter{ignoredCount === 1 ? '' : 's'} ignored — column archived
        </span>
      )}
    </div>
  )
}
