import { describe, expect, it } from 'vitest'
import { GRID_GROUPS, buildLookups, formatValueText, optionsOf, resolveColumns } from './gridColumns'

const master = (name: string, displayOrder: number, active = true) => ({ name, description: '', active, displayOrder })

describe('Scope of Work group: Requirement and Products', () => {
  const all = resolveColumns([])
  const col = (id: string) => all.find((c) => c.id === id)!

  it('sits right after Identity, in the grid and its header groups', () => {
    expect(GRID_GROUPS.slice(0, 3).map((g) => g.label)).toEqual(['Identity', 'Scope of Work', 'Client'])
    const groups = all.map((c) => c.group).filter((g, i, list) => list.indexOf(g) === i)
    expect(groups.slice(0, 3)).toEqual(['identity', 'scope', 'client'])
    expect(all.filter((c) => c.group === 'scope').map((c) => c.header)).toEqual(['Requirement', 'Products'])
  })

  it('are multi-selects picking from (and adding to) their Live Bids masters', () => {
    expect(col('general:scopeOfWork')).toMatchObject({ type: 'multiselect', editable: 'general', createMaster: 'requirements' })
    expect(col('general:products')).toMatchObject({ type: 'multiselect', editable: 'general', createMaster: 'bidProducts' })
    const lookups = buildLookups({ persons: [], departments: [], states: [], masters: {
      requirements: [master('ITMS', 1), master('CCTV', 0), master('Old', 2, false)], bidProducts: [master('LocoMate', 0)],
    } })
    expect(optionsOf(col('general:scopeOfWork'), lookups).map((o) => o.value)).toEqual(['CCTV', 'ITMS'])
    expect(optionsOf(col('general:products'), lookups).map((o) => o.label)).toEqual(['LocoMate'])
    // Values are kept one per line in the General document.
    expect(formatValueText(col('general:scopeOfWork'), 'CCTV\nITMS')).toBe('CCTV, ITMS')
  })

  it('Procuring Authority picks a department and stores its name', () => {
    const lookups = buildLookups({ persons: [], states: [], departments: [{ id: 'd-1', name: 'Transport Dept', stateCode: null }] })
    expect(col('general:procuringAuthority').pick).toBe('departmentName')
    expect(optionsOf(col('general:procuringAuthority'), lookups)).toEqual([{ value: 'Transport Dept', label: 'Transport Dept' }])
  })
})
