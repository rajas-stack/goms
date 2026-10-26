import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { OrgPerson } from '@/data/org-structure'
import { planOrgImport, readOrgImportSheet, runOrgImport, type OrgImportRow } from './orgImport'

const person = (id: string, name: string, level: number, over: Partial<OrgPerson> = {}): OrgPerson =>
  ({ id, name, designation: '', level, departments: [], managerId: null, email: '', status: 'active', createdAt: '2026-01-01', ...over })
const row = (line: number, name: string, over: Partial<OrgImportRow> = {}): OrgImportRow =>
  ({ line, name, designation: '', level: 'L2', departments: '', managerName: '', email: '', ...over })
const DEPARTMENTS = ['Pre-Sales', 'Legal', 'Bid Management']
const plan = (rows: OrgImportRow[], existing: OrgPerson[] = [], emailEditable = true) => planOrgImport(rows, existing, DEPARTMENTS, { emailEditable })

describe('readOrgImportSheet', () => {
  it('finds columns by header name in any order and skips blank rows', () => {
    const csv = 'Level,Name,Reports to,Departments\nL1,Ravi Iyer,Asha Rao,pre-sales; Legal\n,,,\n2,Meera,Ravi Iyer,\n'
    expect(readOrgImportSheet(csv)).toEqual([
      { line: 2, name: 'Ravi Iyer', designation: '', level: 'L1', departments: 'pre-sales; Legal', managerName: 'Asha Rao', email: '' },
      { line: 4, name: 'Meera', designation: '', level: '2', departments: '', managerName: 'Ravi Iyer', email: '' },
    ])
  })
  it('reads an .xlsx workbook the same way', () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Name', 'Designation', 'Level'], ['Asha Rao', 'Chairman', 'L0']]), 'People')
    const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    expect(readOrgImportSheet(data)).toEqual([{ line: 2, name: 'Asha Rao', designation: 'Chairman', level: 'L0', departments: '', managerName: '', email: '' }])
  })
  it('reads the template column order when there is no header row', () => {
    expect(readOrgImportSheet('Asha Rao,Chairman,L0,Legal,,\n')[0]).toMatchObject({ name: 'Asha Rao', designation: 'Chairman', level: 'L0', departments: 'Legal' })
  })
})

describe('planOrgImport', () => {
  it('accepts a valid row, canonicalising level and department', () => {
    const [item] = plan([row(2, 'Ravi Iyer', { level: 'l1', departments: 'pre-sales; Legal', managerName: 'asha rao' })], [person('a', 'Asha Rao', 0)])
    expect(item).toMatchObject({ status: 'ok', level: 1, departments: ['Pre-Sales', 'Legal'], problems: [] })
  })
  it('rejects a missing name, a bad level, an unknown department and a bad email', () => {
    const items = plan([row(2, ''), row(3, 'A', { level: 'L9' }), row(4, 'B', { departments: 'Marketing' }), row(5, 'C', { email: 'nope' })])
    expect(items.map((i) => i.status)).toEqual(['error', 'error', 'error', 'error'])
    expect(items[2].problems[0]).toMatch(/Unknown department "Marketing"/)
  })
  it('skips people already in the org and repeats in the file', () => {
    const items = plan([row(2, 'asha rao', { level: 'L0' }), row(3, 'New One'), row(4, 'new  one')], [person('a', 'Asha Rao', 0)])
    expect(items.map((i) => i.status)).toEqual(['skip', 'ok', 'skip'])
  })
  it('matches the manager among existing people and earlier rows, and enforces levels', () => {
    const items = plan([
      row(2, 'Top', { level: 'L0' }),
      row(3, 'Mid', { level: 'L1', managerName: 'Top' }),
      row(4, 'Peer', { level: 'L1', managerName: 'Mid' }),
      row(5, 'Orphan', { level: 'L2', managerName: 'Nobody' }),
    ])
    expect(items.map((i) => i.status)).toEqual(['ok', 'ok', 'error', 'error'])
    expect(items[2].problems[0]).toMatch(/can only report to someone above L1/)
    expect(items[3].problems[0]).toMatch(/not in the org or this file/)
  })
  it('refuses a report to a manager whose own row has an error', () => {
    const items = plan([row(2, 'Boss', { level: 'L1', departments: 'Marketing' }), row(3, 'Staff', { level: 'L2', managerName: 'Boss' })])
    expect(items.map((i) => i.status)).toEqual(['error', 'error'])
  })
  it('drops the email with a note when the user cannot set it', () => {
    const [item] = plan([row(2, 'Ravi', { email: 'ravi@amnex.com' })], [], false)
    expect(item).toMatchObject({ status: 'ok', email: '' })
    expect(item.notes[0]).toMatch(/System Admins/)
  })
})

describe('runOrgImport', () => {
  it('creates people top-down so each manager exists first, passing the new id', async () => {
    const calls: Array<{ name: string; managerId: string | null }> = []
    const create = async (input: { name: string; managerId: string | null }) => { calls.push({ name: input.name, managerId: input.managerId }); return person(`id-${input.name}`, input.name, 0) }
    const items = plan([row(2, 'Staff', { level: 'L2', managerName: 'Boss' }), row(3, 'Boss', { level: 'L1', managerName: 'Asha Rao' })], [person('a', 'Asha Rao', 0)])
    const results = await runOrgImport(items, [person('a', 'Asha Rao', 0)], create as never)
    expect(calls).toEqual([{ name: 'Boss', managerId: 'a' }, { name: 'Staff', managerId: 'id-Boss' }])
    expect(results.every((r) => r.ok)).toBe(true)
  })
  it('reports a refused row and does not create the people who report to them', async () => {
    const create = async (input: { name: string }) => { if (input.name === 'Boss') throw new Error('Refused.'); return person('x', input.name, 0) }
    const items = plan([row(2, 'Boss', { level: 'L1' }), row(3, 'Staff', { level: 'L2', managerName: 'Boss' }), row(4, 'Other', { level: 'L2' })])
    const results = await runOrgImport(items, [], create as never)
    expect(results.map((r) => [r.name, r.ok])).toEqual([['Boss', false], ['Staff', false], ['Other', true]])
    expect(results.find((r) => r.name === 'Staff')?.message).toMatch(/Boss could not be created/)
  })
})
