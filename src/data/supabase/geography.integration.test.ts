import { describe, expect, it } from 'vitest'
import { getState, geoRoot, childCounts, listStates } from './geography'

describe('geography (Supabase integration)', () => {
  it('geoRoot returns the India country node', async () => {
    const root = await geoRoot()
    expect(root?.name).toBe('India')
    expect(root?.typeKey).toBe('country')
  })

  it('listStates returns all 36 states/UTs, name-sorted', async () => {
    const states = await listStates()
    expect(states).toHaveLength(36)
    const sorted = [...states].sort((a, b) => a.name.localeCompare(b.name))
    expect(states.map((s) => s.code)).toEqual(sorted.map((s) => s.code))
  })

  it('getState resolves a real state by LGD code', async () => {
    const states = await listStates()
    const target = states[0]
    const found = await getState(target.code)
    expect(found?.name).toBe(target.name)
  })

  it('childCounts returns district counts keyed by state id', async () => {
    const root = await geoRoot()
    const counts = await childCounts(root!.id)
    expect(Object.keys(counts).length).toBe(36)
    expect(Object.values(counts).every((c) => c >= 0)).toBe(true)
  })
})
