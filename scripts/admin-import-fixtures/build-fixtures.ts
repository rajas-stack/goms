import * as XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(import.meta.dirname, 'out')

function writeWorkbook(path: string, sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new()
  for (const [title, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), title)
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}

mkdirSync(join(OUT_DIR, 'round1'), { recursive: true })
mkdirSync(join(OUT_DIR, 'round2'), { recursive: true })

// --- Round 1: baseline ---
writeWorkbook(join(OUT_DIR, 'round1', 'org-and-employees.xlsx'), {
  'Organization Hierarchy': [
    ['Node Type', 'Name', 'Code', 'Parent Code', 'State Code', 'Status'],
    ['department', 'QA Import Dept', 'QAIMP-DEPT', '', '', 'active'],
  ],
  Employees: [
    ['Employee Code', 'Name', 'Designation', 'Email', 'Phone', 'Org Node Code', 'Manager Employee Code', 'Vacant', 'Status', 'Department Head Of'],
    ['QAIMP-E1', 'Anita Rao', 'Officer', '', '', 'QAIMP-DEPT', '', false, 'active', ''],
    ['QAIMP-E2', '', 'Manager', '', '', 'QAIMP-DEPT', '', true, 'active', ''],
  ],
})
writeWorkbook(join(OUT_DIR, 'round1', 'sales-roster.xlsx'), {
  'Sales Persons': [
    ['Official Email', 'Name', 'Personal Email', 'Mobile', 'Alt Mobile', 'Joined On', 'Status'],
    ['qaimp.sales@example.com', 'QA Import Sales Person', '', '', '', '2026-01-01', 'active'],
  ],
  Postings: [
    ['Sales Person Email', 'Designation', 'Tier Key', 'Manager Email', 'Office', 'Start Date', 'Reason'],
    ['qaimp.sales@example.com', 'RM', 'rm', '', 'QA Import Office', '2026-01-01', 'initial posting'],
  ],
})
writeWorkbook(join(OUT_DIR, 'round1', 'presales.xlsx'), {
  'Pre-Sales': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['QAIMP-PS1', 'QA Import Pre-Sales Exec', 'QA fixture pre-sales executive.', true, 0],
  ],
})

// --- Round 2: the mutations §11 asks for ---
writeWorkbook(join(OUT_DIR, 'round2', 'org-and-employees.xlsx'), {
  'Organization Hierarchy': [
    ['Node Type', 'Name', 'Code', 'Parent Code', 'State Code', 'Status'],
    // department rename
    ['department', 'QA Import Dept (Renamed)', 'QAIMP-DEPT', '', '', 'active'],
  ],
  Employees: [
    ['Employee Code', 'Name', 'Designation', 'Email', 'Phone', 'Org Node Code', 'Manager Employee Code', 'Vacant', 'Status', 'Department Head Of'],
    // promotion + manager change (E1 now reports to E2) + department-head assignment (E1 heads QAIMP-DEPT)
    ['QAIMP-E1', 'Anita Rao', 'Senior Officer', '', '', 'QAIMP-DEPT', 'QAIMP-E2', false, 'active', 'QAIMP-DEPT'],
    ['QAIMP-E2', '', 'Manager', '', '', 'QAIMP-DEPT', '', true, 'active', ''],
    // new hire alongside a (still) vacant seat
    ['QAIMP-E3', 'New Hire', 'Officer', '', '', 'QAIMP-DEPT', 'QAIMP-E1', false, 'active', ''],
  ],
})
writeWorkbook(join(OUT_DIR, 'round2', 'sales-roster.xlsx'), {
  'Sales Persons': [
    ['Official Email', 'Name', 'Personal Email', 'Mobile', 'Alt Mobile', 'Joined On', 'Status'],
    ['qaimp.sales@example.com', 'QA Import Sales Person', '', '', '', '2026-01-01', 'active'],
  ],
  Postings: [
    ['Sales Person Email', 'Designation', 'Tier Key', 'Manager Email', 'Office', 'Start Date', 'Reason'],
    // sales-team membership change (tier bump) + posting change (new office) as a new dated posting
    ['qaimp.sales@example.com', 'GM', 'gm', '', 'QA Import Office (New)', '2026-02-01', 'promotion + office change'],
  ],
})

console.log('Fixtures written to', OUT_DIR)
