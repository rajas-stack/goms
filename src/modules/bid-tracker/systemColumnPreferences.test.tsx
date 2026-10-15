import { beforeEach, expect, it } from 'vitest'
import { readSystemColumns, saveSystemColumns } from './systemColumnPreferences'

beforeEach(() => localStorage.clear())
it('retains removed column markers per sheet and view, including their restore positions', () => {
  const columns = ['opportunityName', '~hidden:city', '~hidden:custom:campaign_note', 'bidCode']
  saveSystemColumns('campaign', 'allBids', columns)
  expect(readSystemColumns('campaign', 'allBids')).toEqual(columns)
  expect(readSystemColumns('pipeline', 'allBids')).toBeUndefined()
  expect(readSystemColumns('campaign', 'myBids')).toBeUndefined()
})
it('ignores damaged preferences and supports restoring all columns', () => {
  localStorage.setItem('gorms:grid-columns:local:campaign:allBids', '{broken')
  expect(readSystemColumns('campaign', 'allBids')).toBeUndefined()
  saveSystemColumns('campaign', 'allBids', ['city'])
  expect(readSystemColumns('campaign', 'allBids')).toEqual(['city'])
})
