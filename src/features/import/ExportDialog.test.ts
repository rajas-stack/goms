import { describe, expect, it } from 'vitest'
import { peopleRows, type Ctx } from './ExportDialog'
import type { Employee, HierNode } from '@/lib/types'

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Existing Person', designation: 'Officer',
    email: 'existing@gov.in', phone: '+91 9876543210', company: '', address: 'Stale Personal Address',
    website: 'https://stale.example.com',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: true,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

function makeDepartment(overrides: Partial<HierNode> = {}): HierNode {
  return {
    id: 'dept-1', domain: 'org', typeKey: 'department', parentId: null, stateCode: 5,
    name: 'Health Department', code: null, sortOrder: 0, metadata: {}, status: 'active',
    ...overrides,
  }
}

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    states: [], departments: [], employees: [], employeeDepartments: {}, events: [], opportunities: [],
    ...overrides,
  }
}

describe('ExportDialog — peopleRows Address/Website (item 4: inherits from the Department)', () => {
  it('exports the Department\'s office address/website, not the employee\'s own (possibly stale) fields', () => {
    const dept = makeDepartment({ metadata: { officeAddress: '1 Department Road', website: 'https://dept.example.gov.in' } })
    const emp = makeEmployee()
    const ctx = makeCtx({
      departments: [dept],
      employees: [emp],
      employeeDepartments: { [emp.id]: { id: dept.id, name: dept.name } },
    })

    const rows = peopleRows(ctx)
    const header = rows[0]
    const row = rows[1]
    expect(row[header.indexOf('Address')]).toBe('1 Department Road')
    expect(row[header.indexOf('Website')]).toBe('https://dept.example.gov.in')
  })

  it('falls back to the employee\'s own field only when the department has none set', () => {
    const dept = makeDepartment({ metadata: {} })
    const emp = makeEmployee()
    const ctx = makeCtx({
      departments: [dept],
      employees: [emp],
      employeeDepartments: { [emp.id]: { id: dept.id, name: dept.name } },
    })

    const rows = peopleRows(ctx)
    const header = rows[0]
    const row = rows[1]
    expect(row[header.indexOf('Address')]).toBe('Stale Personal Address')
    expect(row[header.indexOf('Website')]).toBe('https://stale.example.com')
  })
})
