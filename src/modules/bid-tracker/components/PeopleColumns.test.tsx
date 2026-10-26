import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import type { BidCustomField } from '@/lib/types'
import { NO_LOOKUPS, STANDARD_COLUMNS, customColumnMeta } from '../gridColumns'
import type { PeopleLookups } from '../peopleColumns'
import { ColumnsPanel } from './ColumnsPanel'
import { EditableCell } from './EditableCell'

const customPerson = customColumnMeta({ id: 'f1', key: 'oem_people', name: 'OEM people', dataType: 'person' } as BidCustomField)
const geoSales = STANDARD_COLUMNS.find((c) => c.id === 'geoSalesPersonId')!
const lookups = (configs: NonNullable<PeopleLookups['people']>['configs']): PeopleLookups => ({
  ...NO_LOOKUPS,
  persons: [
    { value: 'p1', label: 'Asha Rao', email: 'asha@amnex.com', isPerson: true },
    { value: 'p2', label: 'Ravi Shah', email: 'ravi@amnex.com', isPerson: true },
    { value: 'p3', label: 'Neha Kaul', email: 'neha@amnex.com', isPerson: true },
  ],
  states: [{ value: '27', label: 'Maharashtra' }],
  people: {
    configs,
    departmentsByEmail: new Map(),
    verticalsByEmail: new Map(),
    territoryByEmail: new Map([['asha@amnex.com', 'South'], ['ravi@amnex.com', 'North'], ['neha@amnex.com', null]]),
  },
})

describe('person cells use the People columns setup', () => {
  it('a custom person column set to Multiple picks several people and saves them as a list', async () => {
    const onCommit = vi.fn()
    render(<EditableCell col={customPerson} value="p1" display="Asha Rao" onCommit={onCommit}
      lookups={lookups({ [customPerson.id]: { verticals: [], departments: [], people: [], multiple: true } })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit OEM people' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Ravi Shah' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCommit).toHaveBeenCalledWith('["p1","p2"]')
  })

  it("a Sales roster column lists the row's territory and pan-India people only", async () => {
    render(<EditableCell col={geoSales} value={null} display="" onCommit={vi.fn()} row={{ stateCode: 27 }} lookups={lookups({})} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Geo-sales' }))
    const list = await screen.findByRole('listbox', { name: 'Geo-sales' })
    expect(within(list).getByRole('option', { name: /Asha Rao/ })).toBeInTheDocument() // South = Maharashtra's territory
    expect(within(list).getByRole('option', { name: /Neha Kaul/ })).toBeInTheDocument() // pan-India
    expect(within(list).queryByRole('option', { name: /Ravi Shah/ })).not.toBeInTheDocument() // North
  })
})

describe('Manage columns', () => {
  it('has no People columns gear: who a People column offers is chosen in Add column', () => {
    const all = [...STANDARD_COLUMNS, customPerson]
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={qc}><ColumnsPanel all={all} visible={all} onChange={vi.fn()} /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: 'People columns' })).not.toBeInTheDocument()
  })
})

describe('multi-person values round-trip in the local store', () => {
  beforeEach(async () => { await resetLocalData() })

  it('saves several people as a list, validates each, and filters by any of them', async () => {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Alpha', submissionDate: '2099-01-15' })
    const bid = await repository.createBid(opp.id)
    const p1 = await repository.createSalesPerson({ name: 'P One', officialEmail: 'p1@amnex.com', designation: 'RM', tierKey: 'rm' })
    const p2 = await repository.createSalesPerson({ name: 'P Two', officialEmail: 'p2@amnex.com', designation: 'RM', tierKey: 'rm' })
    const lead = await repository.createBidCustomField({ name: 'Leads', dataType: 'person' })

    await repository.setBidCustomValue(bid.id, lead.id, JSON.stringify([p1.id, p2.id]))
    expect((await repository.listBidCustomValues(bid.id)).leads).toBe(JSON.stringify([p1.id, p2.id]))
    const log = await repository.listAuditLogs({ entityType: 'bidCustomFieldValue', entityId: bid.id })
    expect(log.find((l) => l.field === 'leads')?.newValue).toBe('P One, P Two')
    const names = async () => (await repository.listBidsForGrid([{ field: 'custom:leads', operator: 'eq', value: p2.id }])).map((r) => r.opportunityName)
    expect(await names()).toEqual(['Alpha'])

    await expect(repository.setBidCustomValue(bid.id, lead.id, JSON.stringify([p1.id, 'nobody']))).rejects.toThrow(/person does not exist/)
    await repository.setBidCustomValue(bid.id, lead.id, JSON.stringify([p1.id]))
    expect((await repository.listBidCustomValues(bid.id)).leads).toBe(p1.id)
  })

  it('stores and clears a column setup', async () => {
    await repository.setPeopleColumnConfig('custom:leads', { verticals: ['Traffic '], departments: [' Sales '], people: ['x', 'x'], multiple: true })
    expect(await repository.listPeopleColumnConfigs()).toEqual({ 'custom:leads': { verticals: ['Traffic'], departments: ['Sales'], people: ['x'], multiple: true } })
    await repository.setPeopleColumnConfig('custom:leads', { verticals: [], departments: [], people: [], multiple: false })
    expect(await repository.listPeopleColumnConfigs()).toEqual({})
  })
})
