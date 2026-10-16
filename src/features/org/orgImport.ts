import * as XLSX from 'xlsx'
import { ORG_LEVELS, levelLabel, type OrgPerson } from '@/data/org-structure'

/** Bulk import of company-org people (org_people) from a CSV/Excel sheet. Pure logic: the dialog only picks the file, shows
 *  the plan and feeds `runOrgImport` the same `create` the Add form uses, so the server's rules (permissions, email binding,
 *  levels) still apply to every row. Managers are matched by name; rows are created top-down (level 0 first) so a manager
 *  always exists before the people reporting to them. */

export const ORG_IMPORT_HEADERS = ['Name', 'Designation', 'Level', 'Departments', 'Reports to', 'Email'] as const

export interface OrgImportRow { line: number; name: string; designation: string; level: string; departments: string; managerName: string; email: string }

export interface OrgImportItem {
  line: number
  name: string
  designation: string
  level: number
  departments: string[]
  managerName: string
  email: string
  /** ok: will be created. skip: already in the org or repeated in the file. error: fix the sheet and upload again. */
  status: 'ok' | 'skip' | 'error'
  problems: string[]
  notes: string[]
}

const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const HEADER_KEYS: Record<string, keyof Omit<OrgImportRow, 'line'>> = {
  name: 'name', 'full name': 'name', employee: 'name', designation: 'designation', title: 'designation', level: 'level',
  department: 'departments', departments: 'departments', 'reports to': 'managerName', manager: 'managerName', 'reporting to': 'managerName', email: 'email',
}

/** Reads the first sheet of an .xlsx/.xls/.csv upload. Columns are found by header name (any order); a sheet without a
 *  recognisable header row is read in the template's column order. */
export function readOrgImportSheet(input: ArrayBuffer | string): OrgImportRow[] {
  const workbook = typeof input === 'string' ? XLSX.read(input, { type: 'string' }) : XLSX.read(input, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, raw: false, defval: '' })
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
  const headerIndex = grid.findIndex((row) => row.some((cell) => HEADER_KEYS[norm(cell)] === 'name'))
  const columns: Partial<Record<keyof Omit<OrgImportRow, 'line'>, number>> = {}
  if (headerIndex >= 0) grid[headerIndex].forEach((cell, i) => { const key = HEADER_KEYS[norm(cell)]; if (key && columns[key] === undefined) columns[key] = i })
  else ORG_IMPORT_HEADERS.forEach((h, i) => { columns[HEADER_KEYS[norm(h)]] = i })
  const at = (row: string[], key: keyof Omit<OrgImportRow, 'line'>) => (columns[key] === undefined ? '' : row[columns[key]!] ?? '')
  return grid.flatMap((row, i) => {
    if (i <= headerIndex || row.every((cell) => !cell)) return []
    return [{ line: i + 1, name: at(row, 'name'), designation: at(row, 'designation'), level: at(row, 'level'), departments: at(row, 'departments'), managerName: at(row, 'managerName'), email: at(row, 'email') }]
  })
}

/** Template sheet as CSV rows (header plus one example per kind of row). */
export const orgImportTemplateRows = (): string[][] => [
  [...ORG_IMPORT_HEADERS],
  ['Asha Rao', 'Chairman', 'L0', 'Leadership', '', ''],
  ['Ravi Iyer', 'Director', 'L1', 'Pre-Sales; Bid Management', 'Asha Rao', 'ravi@amnex.com'],
]

export function planOrgImport(
  rows: readonly OrgImportRow[],
  existing: readonly OrgPerson[],
  departmentOptions: readonly string[],
  opts: { emailEditable: boolean },
): OrgImportItem[] {
  const departmentByKey = new Map(departmentOptions.map((d) => [norm(d), d]))
  const existingByName = new Map(existing.map((p) => [norm(p.name), p]))
  const levelOf = new Map<string, number>(existing.filter((p) => p.status === 'active').map((p) => [norm(p.name), p.level]))
  const items: OrgImportItem[] = rows.map((row) => {
    const problems: string[] = [], notes: string[] = []
    const name = row.name.trim().replace(/\s+/g, ' ')
    if (!name) problems.push('Name is required.')
    const levelMatch = /^l?\s*(\d+)$/i.exec(row.level.trim())
    const level = levelMatch ? Number(levelMatch[1]) : NaN
    if (!levelMatch || !(ORG_LEVELS as readonly number[]).includes(level)) problems.push(`Level must be ${levelLabel(0)} to ${levelLabel(ORG_LEVELS[ORG_LEVELS.length - 1])}.`)
    const departments: string[] = []
    for (const part of row.departments.split(/[;,|]/).map((d) => d.trim()).filter(Boolean)) {
      const known = departmentByKey.get(norm(part))
      if (!known) problems.push(`Unknown department "${part}" (add it under Amnex departments first).`)
      else if (!departments.includes(known)) departments.push(known)
    }
    const email = row.email.trim()
    if (email && !email.includes('@')) problems.push('Email needs an @.')
    else if (email && !opts.emailEditable) notes.push('Email ignored: only System Admins can set it.')
    return { line: row.line, name, designation: row.designation.trim(), level, departments, managerName: row.managerName.trim().replace(/\s+/g, ' '), email: opts.emailEditable ? email : '', status: problems.length ? 'error' : 'ok', problems, notes }
  })

  const seen = new Set<string>()
  for (const item of items) {
    if (item.status === 'error') continue
    const key = norm(item.name)
    if (existingByName.has(key)) { item.status = 'skip'; item.notes.push('Already in the org.'); continue }
    if (seen.has(key)) { item.status = 'skip'; item.notes.push('Repeated in the file; the first row is used.'); continue }
    seen.add(key); levelOf.set(key, item.level)
  }
  for (const item of items) {
    if (item.status !== 'ok' || !item.managerName) continue
    const managerLevel = levelOf.get(norm(item.managerName))
    if (managerLevel === undefined) item.problems.push(`Reports to "${item.managerName}", who is not in the org or this file.`)
    else if (managerLevel >= item.level) item.problems.push(`${levelLabel(item.level)} can only report to someone above ${levelLabel(item.level)}; "${item.managerName}" is ${levelLabel(managerLevel)}.`)
    if (item.problems.length) item.status = 'error'
  }
  // A manager that is itself rejected can't be reported to.
  const created = new Set(items.filter((i) => i.status === 'ok').map((i) => norm(i.name)))
  const blocked = new Set(items.filter((i) => i.status === 'error' && i.name).map((i) => norm(i.name)))
  for (const item of items) {
    const key = norm(item.managerName)
    if (item.status === 'ok' && item.managerName && !existingByName.has(key) && !created.has(key) && blocked.has(key)) {
      item.problems.push(`Reports to "${item.managerName}", whose own row has an error.`); item.status = 'error'
    }
  }
  return items
}

export interface OrgImportResult { line: number; name: string; ok: boolean; message?: string }

/** Creates the plan's `ok` rows top-down. A row whose manager failed is reported rather than created without them. */
export async function runOrgImport(
  plan: readonly OrgImportItem[],
  existing: readonly OrgPerson[],
  create: (input: { name: string; level: number; designation: string; departments: string[]; managerId: string | null; email?: string }) => Promise<OrgPerson>,
  onProgress?: (done: number, total: number) => void,
): Promise<OrgImportResult[]> {
  const idByName = new Map(existing.map((p) => [norm(p.name), p.id]))
  const todo = plan.filter((i) => i.status === 'ok').sort((a, b) => a.level - b.level || a.line - b.line)
  const failed = new Set<string>()
  const results: OrgImportResult[] = []
  for (const item of todo) {
    const managerKey = norm(item.managerName)
    if (item.managerName && failed.has(managerKey)) {
      failed.add(norm(item.name)); results.push({ line: item.line, name: item.name, ok: false, message: `Not created: ${item.managerName} could not be created.` })
    } else {
      try {
        const person = await create({ name: item.name, level: item.level, designation: item.designation, departments: item.departments, managerId: item.managerName ? idByName.get(managerKey) ?? null : null, ...(item.email ? { email: item.email } : {}) })
        idByName.set(norm(item.name), person.id); results.push({ line: item.line, name: item.name, ok: true })
      } catch (cause) {
        failed.add(norm(item.name)); results.push({ line: item.line, name: item.name, ok: false, message: cause instanceof Error ? cause.message : 'Could not be created.' })
      }
    }
    onProgress?.(results.length, todo.length)
  }
  return results
}
