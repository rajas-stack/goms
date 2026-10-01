import { OPERATORS_BY_TYPE, type FilterOperator, type TypedFilterRule } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { CUSTOM_GROUP, operatorLabel, type GridColumnMeta } from '../gridColumns'

const control = 'h-8 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

/** The reference prototype's rule builder: `WHERE [field] [operator] [value]`,
 *  further rules joined with `AND`. Operators come from the chosen field's
 *  type (`OPERATORS_BY_TYPE`); the value control is type-aware. Standard and
 *  custom columns share one field list — custom ones under a "Custom" heading. */
export function FilterBuilder({ columns, rules, onChange }: {
  /** Filterable columns only (type !== null). */
  columns: GridColumnMeta[]
  rules: TypedFilterRule[]
  onChange: (rules: TypedFilterRule[]) => void
}) {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const standard = columns.filter((c) => c.group !== 'custom')
  const custom = columns.filter((c) => c.group === 'custom')

  const patch = (index: number, next: TypedFilterRule) => onChange(rules.map((r, i) => (i === index ? next : r)))
  const remove = (index: number) => onChange(rules.filter((_, i) => i !== index))
  const add = () => {
    const first = columns[0]
    if (!first) return
    onChange([...rules, { field: first.id, operator: OPERATORS_BY_TYPE[first.type!][0], value: '' }])
  }

  const changeField = (index: number, field: string) => {
    const col = byId.get(field)
    if (!col?.type) return
    patch(index, { field, operator: OPERATORS_BY_TYPE[col.type][0], value: '' })
  }
  const changeOperator = (index: number, rule: TypedFilterRule, operator: FilterOperator) => {
    // `in` and `between` carry extra payload the other operators don't, so
    // crossing into or out of them resets what no longer applies.
    const next: TypedFilterRule = { field: rule.field, operator, value: operator === 'in' ? '' : rule.value }
    if (operator === 'between') next.value2 = rule.value2 ?? ''
    patch(index, next)
  }

  return (
    <div className="flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-2 p-3" data-testid="filter-builder">
      {rules.length === 0 && <p className="text-[13px] text-muted">No filters. Add one to narrow the grid.</p>}
      {rules.map((rule, index) => {
        const col = byId.get(rule.field)
        const type = col?.type ?? 'text'
        return (
          <div key={index} className="flex flex-wrap items-center gap-2" data-testid="filter-rule">
            <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {index === 0 ? 'Where' : 'And'}
            </span>
            <select
              aria-label="Field" className={control} value={rule.field}
              onChange={(e) => changeField(index, e.target.value)}
            >
              {!col && <option value={rule.field}>{rule.field} (unavailable)</option>}
              <optgroup label="Columns">
                {standard.map((c) => <option key={c.id} value={c.id}>{c.header}</option>)}
              </optgroup>
              {custom.length > 0 && (
                <optgroup label={CUSTOM_GROUP.label}>
                  {custom.map((c) => <option key={c.id} value={c.id}>{c.header}</option>)}
                </optgroup>
              )}
            </select>
            <select
              aria-label="Operator" className={control} value={rule.operator}
              onChange={(e) => changeOperator(index, rule, e.target.value as FilterOperator)}
            >
              {OPERATORS_BY_TYPE[type].map((op) => <option key={op} value={op}>{operatorLabel(type, op)}</option>)}
            </select>
            <RuleValue rule={rule} col={col} onChange={(next) => patch(index, next)} />
            <Button variant="ghost" size="icon" aria-label="Remove filter" onClick={() => remove(index)}>
              <Icon name="X" size={14} />
            </Button>
          </div>
        )
      })}
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={add}><Icon name="Plus" size={14} /> Add filter</Button>
        {rules.length > 0 && <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear all filters</Button>}
      </div>
    </div>
  )
}

function RuleValue({ rule, col, onChange }: {
  rule: TypedFilterRule
  col: GridColumnMeta | undefined
  onChange: (rule: TypedFilterRule) => void
}) {
  const type = col?.type ?? 'text'

  if (type === 'boolean') {
    return (
      <select aria-label="Value" className={control} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })}>
        <option value="">Choose…</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    )
  }

  if (type === 'select') {
    const options = col?.options ?? []
    if (rule.operator === 'in') {
      const chosen = new Set(rule.values ?? [])
      const toggle = (value: string) => {
        const next = new Set(chosen)
        if (next.has(value)) next.delete(value); else next.add(value)
        onChange({ ...rule, value: '', values: options.map((o) => o.value).filter((v) => next.has(v)) })
      }
      return (
        <div role="group" aria-label="Values" className="flex flex-wrap gap-x-3 gap-y-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-[13px] text-ink">
              <input type="checkbox" className="accent-ink-900" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )
    }
    return (
      <select aria-label="Value" className={control} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'
  return (
    <>
      <input
        aria-label={rule.operator === 'between' ? 'From' : 'Value'} type={inputType} step={type === 'number' ? 'any' : undefined}
        className={`${control} w-36`} value={rule.value} placeholder="Value"
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
      />
      {rule.operator === 'between' && (
        <>
          <span className="text-[13px] text-muted">and</span>
          <input
            aria-label="To" type={inputType} step={type === 'number' ? 'any' : undefined}
            className={`${control} w-36`} value={rule.value2 ?? ''} placeholder="Value"
            onChange={(e) => onChange({ ...rule, value2: e.target.value })}
          />
        </>
      )}
    </>
  )
}
