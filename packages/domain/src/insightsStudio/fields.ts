import { daysBetween, isoDay } from './time.js'
import type { DataRow, EnumOption, FieldDef, FieldSemantic, FieldType } from './types.js'

/** Small builders so each data source reads as a list of fields rather than object noise. */

type Extra = Partial<Omit<FieldDef, 'key' | 'label' | 'type' | 'role'>>

export const dim = (key: string, label: string, extra: Extra = {}): FieldDef => ({ key, label, type: 'string', role: 'dimension', ...extra })
export const dateDim = (key: string, label: string, extra: Extra = {}): FieldDef => ({ key, label, type: 'date', role: 'dimension', ...extra })
export const boolDim = (key: string, label: string, extra: Extra = {}): FieldDef => ({ key, label, type: 'boolean', role: 'dimension', ...extra })
export const enumDim = (key: string, label: string, enumValues: readonly EnumOption[], extra: Extra = {}): FieldDef =>
  ({ key, label, type: 'enum', role: 'dimension', enumValues, ...extra })
export const num = (key: string, label: string, extra: Extra = {}): FieldDef => ({ key, label, type: 'number', role: 'measure', ...extra })
export const money = (key: string, label: string, extra: Extra = {}): FieldDef => ({ key, label, type: 'currency', role: 'measure', ...extra })

export const tagged = (semantic: FieldSemantic): Extra => ({ semantic })
export const breakdown: Extra = { breakdown: true }

/** Options from a `[value, label]` list. */
export const options = (pairs: readonly (readonly [string, string])[]): EnumOption[] => pairs.map(([value, label]) => ({ value, label }))


/** Days since `from` (age). */
export const ageDays = (key: string, label: string, from: string): FieldDef =>
  num(key, label, { description: `Days since ${from}`, derive: (row, ctx) => daysBetween(row[from], ctx.today) })

/** Days until `to` (negative once it has passed). */
export const daysUntil = (key: string, label: string, to: string): FieldDef =>
  num(key, label, { description: `Days until ${to}`, derive: (row, ctx) => daysBetween(ctx.today, row[to]) })

/** True when the `due` date has passed and the row is still open (`isOpen` decides). */
export const overdue = (key: string, label: string, due: string, isOpen: (row: DataRow) => boolean): FieldDef =>
  boolDim(key, label, {
    description: `${due} is before today and the record is still open`,
    derive: (row, ctx) => { const day = isoDay(row[due]); return day !== null && isOpen(row) && day < ctx.today },
  })


export function fieldTypeIsNumeric(type: FieldType): boolean {
  return type === 'number' || type === 'currency'
}
