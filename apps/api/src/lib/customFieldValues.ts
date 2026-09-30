// Shared by the bidCustomFields router and bids.listForGrid (spec §8.1): the
// SELECT list that reads a typed value row back as JS values, and the mapper
// from a row to the single `CustomValue` for its field's type.
import type { CustomFieldType, CustomValue } from '@goms/domain'

/** pg returns DATE as a local-midnight JS Date and NUMERIC as a string, so
 *  both are converted in SQL to the shapes the API promises: a `YYYY-MM-DD`
 *  string and a JS number. Prefix with a table alias if needed. */
export const CUSTOM_VALUE_COLUMNS =
  `value_text, value_number::float8 AS value_number, to_char(value_date, 'YYYY-MM-DD') AS value_date, value_bool`

export function customValueFromRow(dataType: CustomFieldType, row: any): CustomValue {
  switch (dataType) {
    case 'number': return row.value_number ?? null
    case 'date': return row.value_date ?? null
    case 'boolean': return row.value_bool ?? null
    default: return row.value_text ?? null
  }
}

/** The four typed columns for one value, exactly one non-null. */
export function customValueColumns(dataType: CustomFieldType, value: Exclude<CustomValue, null>) {
  return {
    text: dataType === 'text' || dataType === 'select' ? String(value) : null,
    number: dataType === 'number' ? Number(value) : null,
    date: dataType === 'date' ? String(value) : null,
    bool: dataType === 'boolean' ? Boolean(value) : null,
  }
}

export function auditText(value: CustomValue): string {
  return value === null ? '' : String(value)
}
