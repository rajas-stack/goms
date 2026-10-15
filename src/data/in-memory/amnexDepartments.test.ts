import { describe, expect, it } from 'vitest'
import type { OrgPerson } from '../org-structure'
import {
  createDepartmentLocal, deleteDepartmentLocal, listDepartmentsLocal, renameDepartmentLocal, reorderDepartmentsLocal, seedDepartments,
} from './amnexDepartments'

const person = (id: string, departments: string[]): OrgPerson =>
  ({ id, name: id, designation: '', level: 3, departments, managerId: null, email: '', status: 'active', createdAt: '' })
const PEOPLE = [person('a', ['Pre-Sales', 'Ops']), person('b', ['ops'])]

describe('Amnex Departments (local mode)', () => {
  it('seeds the defaults plus departments employees already use, marking the role-deriving ones as system', () => {
    const list = listDepartmentsLocal({ departments: seedDepartments(PEOPLE), people: PEOPLE })
    expect(list.map((d) => d.name)).toEqual(['Leadership', 'Sales', 'Pre-Sales', 'Bid Management', 'Legal', 'Finance', 'Technology', 'Business Units', 'Ops'])
    expect(list.filter((d) => d.systemKey).map((d) => d.systemKey)).toEqual(['cxo', 'presales', 'bid', 'legal'])
    expect(list.find((d) => d.name === 'Ops')?.employeeCount).toBe(2)
  })

  it('refuses to rename or delete a system department, and duplicate names', () => {
    const departments = seedDepartments([])
    const legal = departments.find((d) => d.name === 'Legal')!
    expect(() => renameDepartmentLocal({ departments, people: [] }, legal.id, 'Law')).toThrow(/cannot be renamed or deleted/)
    expect(() => deleteDepartmentLocal({ departments, people: [] }, legal.id)).toThrow(/cannot be renamed or deleted/)
    expect(() => createDepartmentLocal(departments, ' sales ')).toThrow('"sales" is already a department.')
  })

  it('rename and delete rewrite employees without mutating the input', () => {
    const departments = seedDepartments(PEOPLE)
    const ops = departments.find((d) => d.name === 'Ops')!
    const renamed = renameDepartmentLocal({ departments, people: PEOPLE }, ops.id, 'Operations')
    expect(renamed.people.map((p) => p.departments)).toEqual([['Pre-Sales', 'Operations'], ['Operations']])
    expect(PEOPLE[0].departments).toEqual(['Pre-Sales', 'Ops'])
    const removed = deleteDepartmentLocal({ departments: renamed.departments, people: renamed.people }, ops.id)
    expect(removed.removedFromEmployees).toBe(2)
    expect(removed.people.map((p) => p.departments)).toEqual([['Pre-Sales'], []])
  })

  it('reorders by id list', () => {
    const departments = seedDepartments([])
    const ids = departments.map((d) => d.id).reverse()
    expect(listDepartmentsLocal({ departments: reorderDepartmentsLocal(departments, ids), people: [] })[0].name).toBe('Business Units')
  })
})
