import { useMemo } from 'react'
import { getField, type CellValue, type DataRow, type DatasetDef, type FieldDef, type FilterOp, type QueryFilter } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { OP_LABEL } from './labels'

/** Filters on fields of the chosen source only. Value inputs follow the field type; text fields suggest real values. */

function opsFor(field: FieldDef): FilterOp[] {
  if (field.type === 'boolean') return ['isTrue', 'isFalse']
  if (field.type === 'date' || field.type === 'number' || field.type === 'currency') return ['between', 'gte', 'lte', 'eq', 'empty', 'notEmpty']
  if (field.type === 'enum') return ['eq', 'neq', 'in', 'nin', 'empty', 'notEmpty']
  return ['eq', 'neq', 'contains', 'in', 'empty', 'notEmpty']
}

const NO_VALUE: FilterOp[] = ['empty', 'notEmpty', 'isTrue', 'isFalse']
const asList = (v: QueryFilter['value']): CellValue[] => (Array.isArray(v) ? [...v] : v === undefined || v === null ? [] : [v as CellValue])

export function FilterEditor({ dataset, filters, rows, onChange }: { dataset: DatasetDef; filters: readonly QueryFilter[]; rows?: readonly DataRow[]; onChange: (f: QueryFilter[]) => void }) {
  const fields = dataset.fields
  const update = (i: number, next: QueryFilter) => onChange(filters.map((f, j) => (j === i ? next : f)))
  const add = () => { const f = fields[0]; onChange([...filters, { field: f.key, op: opsFor(f)[0] }]) }
  return (
    <div className="studio-field">
      <span>Filters</span>
      {filters.map((filter, i) => {
        const field = getField(dataset, filter.field) ?? fields[0]
        return (
          <div key={i} className="studio-row" role="group" aria-label={`Filter ${i + 1}`}>
            <select className="studio-select" aria-label="Filter field" value={field.key} onChange={(e) => { const f = getField(dataset, e.target.value)!; update(i, { field: f.key, op: opsFor(f)[0] }) }}>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select className="studio-select" aria-label="Filter condition" value={filter.op} onChange={(e) => update(i, { field: filter.field, op: e.target.value as FilterOp })}>
              {opsFor(field).map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
            </select>
            {!NO_VALUE.includes(filter.op) && <ValueInput field={field} filter={filter} rows={rows} onChange={(value) => update(i, { ...filter, value })} />}
            <button type="button" className="studio-icon-btn" aria-label={`Remove filter ${i + 1}`} onClick={() => onChange(filters.filter((_, j) => j !== i))}><Icon name="X" size={14} /></button>
          </div>
        )
      })}
      <button type="button" className="studio-btn" onClick={add} disabled={filters.length >= 16}><Icon name="Plus" size={14} />Add filter</button>
    </div>
  )
}

function ValueInput({ field, filter, rows, onChange }: { field: FieldDef; filter: QueryFilter; rows?: readonly DataRow[]; onChange: (v: QueryFilter['value']) => void }) {
  const listId = `values-${field.key}`
  const known = useMemo(() => [...new Set((rows ?? []).map((r) => r[field.key]).filter((v): v is string => typeof v === 'string' && v !== ''))].sort().slice(0, 200), [rows, field.key])
  const values = asList(filter.value)
  const inputType = field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'currency' ? 'number' : 'text'
  const parse = (raw: string): CellValue => (inputType === 'number' ? (raw === '' ? null : Number(raw)) : raw)
  if (filter.op === 'between') {
    return (
      <>
        <input className="studio-input" type={inputType} aria-label="From" value={String(values[0] ?? '')} onChange={(e) => onChange([parse(e.target.value), values[1] ?? null])} />
        <input className="studio-input" type={inputType} aria-label="To" value={String(values[1] ?? '')} onChange={(e) => onChange([values[0] ?? null, parse(e.target.value)])} />
      </>
    )
  }
  if (field.enumValues && (filter.op === 'eq' || filter.op === 'neq')) {
    return (
      <select className="studio-select" aria-label="Filter value" value={String(values[0] ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.enumValues.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  if (filter.op === 'in' || filter.op === 'nin') {
    return <input className="studio-input" aria-label="Filter values (comma separated)" placeholder={field.enumValues ? field.enumValues.map((o) => o.value).join(', ') : 'a, b, c'} value={values.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
  }
  return (
    <>
      <input className="studio-input" type={inputType} aria-label="Filter value" list={inputType === 'text' ? listId : undefined} value={String(values[0] ?? '')} onChange={(e) => onChange(parse(e.target.value))} />
      {inputType === 'text' && <datalist id={listId}>{known.map((v) => <option key={v} value={v} />)}</datalist>}
    </>
  )
}
