import { expect, test } from 'vitest'
import { BUILTIN_DIRECTORY_RANGES } from '@goms/domain'
import { backfillDirectoryIds } from './directoryNumbers'
import type { Employee } from '@/lib/types'

const emp = (id: string, extra: Partial<Employee> = {}) => ({ id, vacant: false, ...extra }) as Employee

test('numbers filled people in order, skips vacant seats, keeps existing numbers', () => {
  const ranges = BUILTIN_DIRECTORY_RANGES.map(r => (r.categoryKey === 'clientDepartment' ? { ...r, nextValue: 1003 } : r))
  const { employees, ranges: out } = backfillDirectoryIds(
    [emp('a', { directoryNumber: 1001 }), emp('b'), emp('seat', { vacant: true }), emp('c')], ranges, ['internal', 'department', 'govt'],
  )
  expect(employees.map(e => e.directoryNumber ?? null)).toEqual([1001, 1003, null, 1004])
  expect(out.find(r => r.categoryKey === 'clientDepartment')?.nextValue).toBe(1005)
  expect(out.find(r => r.categoryKey === 'govt')).toMatchObject({ rangeStart: 26001, rangeEnd: 31000 })
})

test('starts from the built-in ranges when none are stored yet', () => {
  const { employees, ranges } = backfillDirectoryIds([emp('a')], [], [])
  expect(employees[0].directoryNumber).toBe(1001)
  expect(ranges).toHaveLength(5)
})

test('starts after the highest number already held when the counter is missing or behind', () => {
  const { employees, ranges } = backfillDirectoryIds([emp('a', { directoryNumber: 1500 }), emp('b')], [], [])
  expect(employees.map(e => e.directoryNumber)).toEqual([1500, 1501])
  expect(ranges.find(r => r.categoryKey === 'clientDepartment')?.nextValue).toBe(1502)
})
