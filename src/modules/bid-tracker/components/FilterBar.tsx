import { useRef } from 'react'
import { motion } from 'framer-motion'
import type { TypedFilterRule } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'
import { isRuleComplete, operatorLabel, type GridColumnMeta } from '../gridColumns'
import { FilterBuilder } from './FilterBuilder'

/** The value half of a rule, as words ("Solutioning, Qualification", "2026-01-01 – 2026-01-09"). */
export function ruleValueText(rule: TypedFilterRule, col: GridColumnMeta | undefined): string {
  const type = col?.type ?? null
  const labelOf = (v: string) => col?.options?.find((o) => o.value === v)?.label ?? v
  if (rule.operator === 'in') return (rule.values ?? []).map(labelOf).join(', ')
  if (rule.operator === 'between') return `${rule.value} – ${rule.value2 ?? ''}`
  if (type === 'boolean') return rule.value === 'true' ? 'true' : rule.value === 'false' ? 'false' : ''
  return labelOf(rule.value)
}

export function ruleSummary(rule: TypedFilterRule, col: GridColumnMeta | undefined): string {
  return `${col?.header ?? rule.field} ${operatorLabel(col?.type ?? null, rule.operator)} ${ruleValueText(rule, col)}`
}

function Chip({ rule, col, open, columns, rules, onOpen, onClose, onChange, onRemove }: {
  rule: TypedFilterRule
  col: GridColumnMeta | undefined
  open: boolean
  columns: GridColumnMeta[]
  rules: TypedFilterRule[]
  onOpen: () => void
  onClose: () => void
  onChange: (rules: TypedFilterRule[]) => void
  onRemove: () => void
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const complete = isRuleComplete(rule)
  const value = ruleValueText(rule, col)
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
        type="button" onClick={onOpen} aria-expanded={open} aria-label={`Edit filter ${ruleSummary(rule, col)}`}
        className="flex min-w-0 items-center gap-1.5 rounded-l-md py-0.5 pl-2 pr-1.5 hover:bg-goms-sky/[0.12] focus-visible:focus-ring"
      >
        <span className="font-semibold text-goms-navy">{col?.header ?? rule.field}</span>{' '}
        <span className="text-muted">{operatorLabel(col?.type ?? null, rule.operator)}</span>{' '}
        <span className={cn('min-w-0 truncate rounded bg-goms-sky/[0.18] px-1.5 text-goms-navy', !value && 'bg-transparent italic text-muted')}>
          {value || 'choose a value'}
        </span>
      </button>
      <button
        type="button" aria-label={`Clear filter ${ruleSummary(rule, col)}`} onClick={onRemove}
        className="flex h-7 w-6 items-center justify-center rounded-r-md text-muted hover:bg-crimson-100 hover:text-crimson focus-visible:focus-ring"
      >
        <Icon name="X" size={12} />
      </button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={onClose} maxPanelHeight={420}>
        {({ maxHeight }) => (
          <motion.div
            data-canvas-ui initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            style={{ maxHeight }} className="overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper shadow-pop"
          >
            <FilterBuilder columns={columns} rules={rules} onChange={onChange} />
          </motion.div>
        )}
      </PopoverPanel>
    </span>
  )
}

/** `WHERE [Field] [operator] [value]  AND …` — every active condition, always
 *  visible above the grid. Click a condition to edit it, × removes just that
 *  one, "Add condition" appends another (conditions combine with AND). */
export function FilterBar({ rules, columns, columnById, ignoredCount, editing, onEditing, onChange, onAdd }: {
  rules: TypedFilterRule[]
  /** Filterable columns only (type !== null). */
  columns: GridColumnMeta[]
  columnById: Map<string, GridColumnMeta>
  ignoredCount: number
  /** Index of the condition whose editor is open, if any. */
  editing: number | null
  onEditing: (index: number | null) => void
  onChange: (rules: TypedFilterRule[]) => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-goms-sky/30 bg-goms-sky/[0.08] px-3 py-1.5" data-testid="active-filters">
      <span className="mr-0.5 text-[12px] font-semibold tracking-wide text-goms-navy">Where</span>
      {rules.map((rule, index) => {
        const col = columnById.get(rule.field)
        // A rule on an archived custom column is ignored (and noted below), not shown as a live condition.
        if (!col && rule.field.startsWith('custom:')) return null
        const first = rules.findIndex((r) => columnById.has(r.field) || !r.field.startsWith('custom:')) === index
        return (
          <span key={index} className="inline-flex items-center gap-1.5">
            {!first && <span className="text-[11px] font-semibold text-muted">and</span>}
            <Chip
              rule={rule} col={col} open={editing === index} columns={columns} rules={rules}
              onOpen={() => onEditing(editing === index ? null : index)} onClose={() => { if (editing === index) onEditing(null) }}
              onChange={onChange}
              onRemove={() => { onEditing(null); onChange(rules.filter((r) => r !== rule)) }}
            />
          </span>
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
