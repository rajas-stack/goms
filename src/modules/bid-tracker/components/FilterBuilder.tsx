import { OPERATORS_BY_TYPE, isFilterGroup, type FilterGroup, type FilterNode, type FilterOperator, type TypedFilterRule } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Icon } from '@/components/ui/Icon'
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown'
import { cn } from '@/lib/utils'
import { CUSTOM_GROUP, NO_LOOKUPS, operatorLabel, optionsOf, type EntityLookups, type GridColumnMeta } from '../gridColumns'
import { fromRoot, otherLogic, toRoot, type RootFilter } from '../filterTree'

const control = 'h-8 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

type Logic = 'and' | 'or'
const LOGIC_WORD: Record<Logic, string> = { and: 'And', or: 'Or' }

/** The rule builder. Conditions are listed under one "Match all / any" switch;
 *  a condition can be grouped with others ("Add group") and the group has its
 *  own all / any switch, which is how "State = Gujarat AND (Region = West OR
 *  Region = North)" is built without anyone writing boolean syntax. Operators
 *  come from the chosen field's type (`OPERATORS_BY_TYPE`); the value control
 *  is type-aware. Standard and custom columns share one field list — custom
 *  ones under a "Custom" heading. */
export function FilterBuilder({ columns, rules, onChange, lookups = NO_LOOKUPS }: {
  /** Filterable columns only (type !== null). */
  columns: GridColumnMeta[]
  rules: FilterNode[]
  onChange: (rules: FilterNode[]) => void
  lookups?: EntityLookups
}) {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const root = toRoot(rules)
  const commit = (next: RootFilter) => onChange(fromRoot(next))

  const blankRule = (): TypedFilterRule | null => {
    const first = columns[0]
    return first ? { field: first.id, operator: OPERATORS_BY_TYPE[first.type!][0], value: '' } : null
  }
  const addRule = () => { const r = blankRule(); if (r) commit({ ...root, items: [...root.items, r] }) }
  const addGroup = () => {
    const a = blankRule(); const b = blankRule()
    if (a && b) commit({ ...root, items: [...root.items, { logic: otherLogic(root.logic), rules: [a, b] }] })
  }
  const setItem = (i: number, node: FilterNode | null) =>
    commit({ ...root, items: root.items.flatMap((n, k) => (k === i ? (node ? [node] : []) : [n])) })

  return (
    <div className="flex w-[36rem] max-w-[calc(100vw-2rem)] flex-col gap-2 p-3" data-testid="filter-builder">
      {rules.length === 0 && <p className="text-[13px] text-muted">No filters. Add one to narrow the grid.</p>}
      {root.items.map((node, i) => {
        const prefix = i === 0 ? 'Where' : ''
        const connective = i === 0 ? undefined : { logic: root.logic, onChange: (logic: Logic) => commit({ ...root, logic }) }
        if (isFilterGroup(node)) {
          return (
            <GroupBox
              key={i} group={node} prefix={prefix} connective={connective} columns={columns} byId={byId} lookups={lookups}
              onChange={(g) => setItem(i, g)}
              onUngroup={() => commit({ ...root, items: root.items.flatMap((n, k) => (k === i ? node.rules : [n])) })}
            />
          )
        }
        return (
          <RuleRow
            key={i} rule={node} prefix={prefix} connective={connective} columns={columns} byId={byId} lookups={lookups}
            onChange={(r) => setItem(i, r)} onRemove={() => setItem(i, null)}
          />
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={addRule}><Icon name="Plus" size={14} /> Add filter</Button>
          <Button variant="ghost" size="sm" onClick={addGroup} title="A group is a set of conditions that match together, e.g. (West OR North)">
            <Icon name="Brackets" size={14} /> Add group
          </Button>
        </div>
        {rules.length > 0 && <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear all filters</Button>}
      </div>
    </div>
  )
}

/** The "And / Or" that joins a row to the one above it. Rows in the same list share one
 *  connective, so changing it re-joins the whole list. */
function Connective({ logic, onChange }: { logic: Logic; onChange: (logic: Logic) => void }) {
  return (
    <select
      aria-label="Connective" value={logic} onChange={(e) => onChange(e.target.value as Logic)}
      className="h-7 w-[3.75rem] shrink-0 rounded-md border border-line bg-white px-1 text-[12px] font-semibold uppercase tracking-wide text-goms-navy focus-visible:focus-ring"
    >
      <option value="and">{LOGIC_WORD.and}</option>
      <option value="or">{LOGIC_WORD.or}</option>
    </select>
  )
}

function GroupBox({ group, prefix, connective, columns, byId, lookups, onChange, onUngroup }: {
  group: FilterGroup
  prefix: string
  connective?: { logic: Logic; onChange: (logic: Logic) => void }
  columns: GridColumnMeta[]
  byId: Map<string, GridColumnMeta>
  lookups: EntityLookups
  onChange: (group: FilterGroup | null) => void
  onUngroup: () => void
}) {
  const rows = group.rules.filter((r): r is TypedFilterRule => !isFilterGroup(r))
  const setRule = (i: number, next: TypedFilterRule | null) => {
    const rules = rows.flatMap((r, k) => (k === i ? (next ? [next] : []) : [r]))
    onChange(rules.length ? { ...group, rules } : null)
  }
  const addToGroup = () => {
    const first = columns[0]
    if (!first) return
    onChange({ ...group, rules: [...rows, { field: first.id, operator: OPERATORS_BY_TYPE[first.type!][0], value: '' }] })
  }
  return (
    <div className="flex flex-col gap-2" data-testid="filter-group">
      <div className="flex items-start gap-2">
        {connective
          ? <span className="pt-0.5"><Connective logic={connective.logic} onChange={connective.onChange} /></span>
          : <span className="w-11 shrink-0 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{prefix}</span>}
        <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-goms-sky/60 bg-goms-sky/[0.07] p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group</span>
            <div className="flex items-center">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onUngroup}>Ungroup</Button>
              <Button variant="ghost" size="icon" aria-label="Remove group" onClick={() => onChange(null)}><Icon name="X" size={14} /></Button>
            </div>
          </div>
          {rows.map((rule, i) => (
            <RuleRow
              key={i} rule={rule} prefix="" connective={i === 0 ? undefined : { logic: group.logic, onChange: (logic) => onChange({ ...group, logic }) }} columns={columns} byId={byId} lookups={lookups}
              onChange={(r) => setRule(i, r)} onRemove={() => setRule(i, null)}
            />
          ))}
          <div>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={addToGroup}><Icon name="Plus" size={13} /> Add to group</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RuleRow({ rule, prefix, connective, columns, byId, lookups, onChange, onRemove }: {
  rule: TypedFilterRule
  prefix: string
  connective?: { logic: Logic; onChange: (logic: Logic) => void }
  columns: GridColumnMeta[]
  byId: Map<string, GridColumnMeta>
  lookups: EntityLookups
  onChange: (rule: TypedFilterRule) => void
  onRemove: () => void
}) {
  const standard = columns.filter((c) => c.group !== 'custom')
  const custom = columns.filter((c) => c.group === 'custom')
  const col = byId.get(rule.field)
  const type = col?.type ?? 'text'

  const changeField = (field: string) => {
    const next = byId.get(field)
    if (!next?.type) return
    onChange({ field, operator: OPERATORS_BY_TYPE[next.type][0], value: '' })
  }
  const changeOperator = (operator: FilterOperator) => {
    // `in` and `between` carry extra payload the other operators don't, so
    // crossing into or out of them resets what no longer applies.
    const next: TypedFilterRule = { field: rule.field, operator, value: operator === 'in' ? '' : rule.value }
    if (operator === 'between') next.value2 = rule.value2 ?? ''
    onChange(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filter-rule">
      {connective
        ? <Connective logic={connective.logic} onChange={connective.onChange} />
        : <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">{prefix}</span>}
      <select aria-label="Field" className={control} value={rule.field} onChange={(e) => changeField(e.target.value)}>
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
      <select aria-label="Operator" className={control} value={rule.operator} onChange={(e) => changeOperator(e.target.value as FilterOperator)}>
        {OPERATORS_BY_TYPE[type].map((op) => <option key={op} value={op}>{operatorLabel(type, op)}</option>)}
      </select>
      <RuleValue rule={rule} col={col} lookups={lookups} onChange={onChange} />
      <Button variant="ghost" size="icon" aria-label="Remove filter" onClick={onRemove}>
        <Icon name="X" size={14} />
      </Button>
    </div>
  )
}

function RuleValue({ rule, col, lookups, onChange }: {
  rule: TypedFilterRule
  col: GridColumnMeta | undefined
  lookups: EntityLookups
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

  if (type === 'select' || type === 'multiselect' || type === 'person' || type === 'department' || type === 'state') {
    const options = optionsOf(col, lookups)
    if (rule.operator === 'in') {
      const labelOf = new Map(options.map((o) => [o.value, o.label]))
      const valueOf = new Map(options.map((o) => [o.label, o.value]))
      const chosen = (rule.values ?? []).map((v) => labelOf.get(v) ?? v)
      return (
        <div aria-label="Values" role="group" className="min-w-[12rem] max-w-[18rem] flex-1">
          <MultiSelectDropdown
            value={chosen} storageKey="bid-filter-values" allowCustomAdd={false} searchable={options.length > 8}
            placeholder="Choose values…" groups={[{ label: null, options: options.map((o) => o.label) }]}
            onChange={(labels) => {
              const picked = new Set(labels.map((l) => valueOf.get(l) ?? l))
              onChange({ ...rule, value: '', values: options.map((o) => o.value).filter((v) => picked.has(v)) })
            }}
          />
        </div>
      )
    }
    if (type === 'person' || type === 'department') {
      return (
        <div className="w-56">
          <Combobox
            aria-label="Value" value={rule.value} options={options} placeholder={`Choose ${type}…`}
            onChange={(value) => onChange({ ...rule, value })}
          />
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

  const numeric = type === 'number' || type === 'currency'
  const inputType = numeric ? 'number' : type === 'date' ? 'date' : 'text'
  return (
    <>
      <input
        aria-label={rule.operator === 'between' ? 'From' : 'Value'} type={inputType} step={numeric ? 'any' : undefined}
        className={`${control} w-36`} value={rule.value} placeholder="Value"
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
      />
      {rule.operator === 'between' && (
        <>
          <span className="text-[13px] text-muted">and</span>
          <input
            aria-label="To" type={inputType} step={numeric ? 'any' : undefined}
            className={`${control} w-36`} value={rule.value2 ?? ''} placeholder="Value"
            onChange={(e) => onChange({ ...rule, value2: e.target.value })}
          />
        </>
      )}
    </>
  )
}
