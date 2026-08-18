// scripts/seed/sql-utils.ts

export function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** NULL means "no value" and '' means "empty text" — they are not
 *  interchangeable. Every seeded NOT NULL text column here defaults to ''
 *  (e.g. employees.email), so collapsing '' to NULL would violate that
 *  constraint on every vacant/blank field. Only actual null/undefined
 *  becomes SQL NULL. */
export function sqlVal(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return sqlStr(value)
}

/** For text[] columns. Postgres array literal, e.g. '{a,b,c}'. */
export function sqlTextArray(values: string[]): string {
  if (values.length === 0) return "'{}'"
  return `ARRAY[${values.map(sqlStr).join(', ')}]`
}

export function insertStatement(table: string, columns: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  if (rows.length === 0) return ''
  const values = rows.map((row) => `  (${row.map(sqlVal).join(', ')})`).join(',\n')
  return `insert into public.${table} (${columns.join(', ')}) values\n${values};\n`
}
