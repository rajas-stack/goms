import { expect, test, vi } from 'vitest'
import { applyHeaderLabels, loadHeaderLabels, withHeaderLabel } from './headerLabels'
import type { GridColumnMeta } from './gridColumns'

const col = (id: string, header: string) => ({ id, header, group: 'identity', type: 'text' }) as GridColumnMeta

test('renames a column for display only, and a blank name restores the default', () => {
  const renamed = withHeaderLabel({}, 'gemTenderId', '  GeM Tender No. ')
  expect(renamed).toEqual({ gemTenderId: 'GeM Tender No.' })
  const columns = applyHeaderLabels([col('gemTenderId', 'Tender ID'), col('city', 'City')], renamed)
  expect(columns.map((c) => [c.id, c.header])).toEqual([['gemTenderId', 'GeM Tender No.'], ['city', 'City']])
  expect(withHeaderLabel(renamed, 'gemTenderId', '   ')).toEqual({})
})

test('ignores corrupt stored labels', () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
  localStorage.setItem('goms:bidGrid:headerLabels', JSON.stringify({ a: 'Ok', b: 5, c: '' }))
  expect(loadHeaderLabels()).toEqual({ a: 'Ok' })
  localStorage.setItem('goms:bidGrid:headerLabels', '[1,2]')
  expect(loadHeaderLabels()).toEqual({})
})
