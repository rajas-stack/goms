import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Meetings } from './Meetings'
import type { Employee, HierNode, SalesPerson, SalesPosting, TimelineEvent } from '@/lib/types'

// jsdom's 0-height scroll container makes the real virtualizer render no rows;
// this suite tests the filtering feeding the list, so every row is rendered.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 64, size: 64 })),
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}))

const emp = (id: string, name: string): Employee => ({
  id, code: id, name, designation: 'Officer', email: '', phone: '', company: '', address: '', website: '',
  photoUrl: null, orgNodeId: 'n', managerId: null, vacant: false, connected: false,
  relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
  importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
  charges: [], visitingCards: [], metadata: {}, status: 'active',
})
const dept = (id: string, name: string, stateCode: number): HierNode => ({
  id, domain: 'org', typeKey: 'department', parentId: null, stateCode, name, code: null, sortOrder: 0, metadata: {}, status: 'active',
})
const sp = (id: string, name: string, email: string): SalesPerson => ({
  id, employeeCode: '', name, officialEmail: email, personalEmail: '', mobile: '', altMobile: '', joinedOn: null,
  leftOn: null, status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
})
const post = (personId: string, designation: string, managerId: string | null): SalesPosting => ({
  id: `p-${personId}`, salesPersonId: personId, designation, tierKey: 'accountManager', managerId, gmOverrideId: null,
  office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial', reason: '', createdAt: '', createdBy: null,
})
const att = (id: string, name: string) => ({ salesPersonId: id, name })
const evt = (o: Partial<TimelineEvent> & { id: string; title: string }): TimelineEvent =>
  ({ employeeId: 'e1', type: 'meeting', date: '2026-09-01', note: '', source: 'manual', ...o })

const SALES = [
  { p: sp('jay', 'Jayendrasinh Puwar', 'jayendra@amnex.com'), d: 'Sales Head', m: null },
  { p: sp('rohit', 'Rohit Tiku', 'rohitt@amnex.com'), d: 'Regional Head', m: 'jay' },
  { p: sp('vishal', 'Vishal Sharma', 'vishal4@amnex.com'), d: 'Account Manager', m: 'rohit' },
  { p: sp('sunil', 'Sunil Kumar Sharma', 'sunilkumar@amnex.com'), d: 'Regional Manager & Head', m: 'jay' },
  { p: sp('ketan', 'Ketan Thakkar', 'ketant@amnex.com'), d: 'Account Manager', m: 'sunil' },
  { p: sp('prash', 'Prashanth Reddy', 'prashanth@amnex.com'), d: 'BU Sales Agriculture', m: 'jay' },
]

// m1 Gujarat/MeitY/North · m2 Maharashtra/Health/West+BU · m3 Gujarat/MeitY/North+West · m4 Maharashtra/Health/no attendees
const EVENTS: TimelineEvent[] = [
  evt({ id: 'm1', title: 'Kickoff Alpha', employeeId: 'e1', attendees: [att('vishal', 'Vishal Sharma')] }),
  evt({ id: 'm2', title: 'Budget Beta', employeeId: 'e2', attendees: [att('ketan', 'Ketan Thakkar'), att('prash', 'Prashanth Reddy')] }),
  evt({ id: 'm3', title: 'Review Gamma', employeeId: 'e1', attendees: [att('ketan', 'Ketan Thakkar'), att('vishal', 'Vishal Sharma')] }),
  evt({ id: 'm4', title: 'Standup Delta', employeeId: 'e2', agenda: 'zeta-agenda' }),
]

function stub(events: TimelineEvent[] = EVENTS) {
  const q = <T,>(data: T) => ({ data }) as never
  vi.spyOn(api, 'useAllEmployees').mockReturnValue(q([emp('e1', 'Anita Desai'), emp('e2', 'Bhavin Shah')]))
  vi.spyOn(api, 'useEmployeeDepartments').mockReturnValue(q({
    e1: { id: 'd1', name: 'MeitY' }, e2: { id: 'd2', name: 'Health' },
  }))
  vi.spyOn(api, 'useDepartments').mockReturnValue(q([dept('d1', 'MeitY', 24), dept('d2', 'Health', 27)]))
  vi.spyOn(api, 'useStates').mockReturnValue(q([
    { code: 24, name: 'Gujarat' }, { code: 27, name: 'Maharashtra' },
  ]))
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue(q(events))
  vi.spyOn(api, 'useSalesPersons').mockReturnValue(q(SALES.map((s) => s.p)))
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue(q(Object.fromEntries(SALES.map((s) => [s.p.id, post(s.p.id, s.d, s.m)]))))
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    addTimelineEvent: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
}

const TITLES = ['Kickoff Alpha', 'Budget Beta', 'Review Gamma', 'Standup Delta']
function visibleTitles() {
  return TITLES.filter((t) => screen.queryByText(t))
}

function setup() {
  const user = userEvent.setup()
  render(<MemoryRouter><Meetings /></MemoryRouter>)
  async function pick(filterLabel: string, option: string | RegExp) {
    await user.click(screen.getByRole('combobox', { name: filterLabel }))
    await user.click(await screen.findByRole('option', { name: option }))
  }
  return { user, pick }
}

beforeEach(() => { stub(); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('Meetings — Create Meeting', () => {
  it('shows a primary + Create Meeting action that opens the existing timeline-event dialog', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /create meeting/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Log to timeline' })
    // The reused dialog starts on its employee-picker step (no pre-selected person).
    expect(within(dialog).getByText('Choose who this is for')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Search a person…')).toBeInTheDocument()
  })
})

describe('Meetings — toolbar', () => {
  it('offers Department, State, Account Manager, BU Sales, Region, Date and Time from/to — and no People filter', () => {
    setup()
    for (const name of ['Filter by department', 'Filter by state', 'Filter by account manager', 'Filter by BU sales', 'Filter by region']) {
      expect(screen.getByRole('combobox', { name })).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Date')).toBeInTheDocument()
    expect(screen.getByLabelText('Time from')).toBeInTheDocument()
    expect(screen.getByLabelText('Time to')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search meetings/i })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter by person' })).toBeNull()
  })

  it('populates dropdowns from existing data', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'Filter by state' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Gujarat', 'Maharashtra'])
    await user.keyboard('{Escape}')
    // The State popover animates out after Escape; until it has left the DOM its options would be
    // read as the next dropdown's. Wait for it, so each assertion sees only its own control's options.
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0))
    await user.click(screen.getByRole('combobox', { name: 'Filter by region' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Rohit Tiku (North)', 'Sunil Kumar Sharma (West)',
    ])
  })
})

describe('Meetings — filters', () => {
  it('shows every meeting with no filter', () => {
    setup()
    expect(visibleTitles()).toEqual(TITLES)
  })

  it('Department filter', async () => {
    const { pick } = setup()
    await pick('Filter by department', 'MeitY')
    expect(visibleTitles()).toEqual(['Kickoff Alpha', 'Review Gamma'])
  })

  it('State filter', async () => {
    const { pick } = setup()
    await pick('Filter by state', 'Maharashtra')
    expect(visibleTitles()).toEqual(['Budget Beta', 'Standup Delta'])
  })

  it('Account Manager filter matches any attendee with that designation', async () => {
    const { pick } = setup()
    await pick('Filter by account manager', 'Vishal Sharma')
    expect(visibleTitles()).toEqual(['Kickoff Alpha', 'Review Gamma'])
  })

  it('Account Manager options are Account Managers only', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'Filter by account manager' }))
    // Each option also carries the person's avatar (initials), so read the label span.
    expect((await screen.findAllByRole('option')).map((o) => o.lastElementChild?.textContent)).toEqual(['Ketan Thakkar', 'Vishal Sharma'])
  })

  it('BU Sales filter', async () => {
    const { pick } = setup()
    await pick('Filter by BU sales', 'Prashanth Reddy')
    expect(visibleTitles()).toEqual(['Budget Beta'])
  })

  it('Region filter — a multi-region meeting appears under each of its regions', async () => {
    const { pick } = setup()
    await pick('Filter by region', /West/)
    expect(visibleTitles()).toEqual(['Budget Beta', 'Review Gamma'])
    await pick('Filter by region', /North/)
    expect(visibleTitles()).toEqual(['Kickoff Alpha', 'Review Gamma'])
  })

  it('combined filters narrow together (Department + State + Account Manager + Region)', async () => {
    const { pick } = setup()
    await pick('Filter by department', 'MeitY')
    await pick('Filter by state', 'Gujarat')
    await pick('Filter by account manager', 'Ketan Thakkar')
    await pick('Filter by region', /West/)
    expect(visibleTitles()).toEqual(['Review Gamma'])
  })

  it('contradictory filters show a no-match state, and Clear filters restores everything', async () => {
    const { user, pick } = setup()
    await pick('Filter by department', 'Health')
    await pick('Filter by account manager', 'Vishal Sharma')
    expect(visibleTitles()).toEqual([])
    expect(screen.getByText(/no meetings match/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(visibleTitles()).toEqual(TITLES)
  })

  it('date and time filters still work', async () => {
    stub([
      evt({ id: 'a', title: 'Kickoff Alpha', date: '2026-09-01', time: '10:00' }),
      evt({ id: 'b', title: 'Budget Beta', date: '2026-09-01', time: '15:00' }),
      evt({ id: 'c', title: 'Review Gamma', date: '2026-09-02', time: '10:00' }),
    ])
    const { user } = setup()
    await user.type(screen.getByLabelText('Date'), '2026-09-01')
    await user.type(screen.getByLabelText('Time from'), '09:00')
    await user.type(screen.getByLabelText('Time to'), '12:00')
    expect(visibleTitles()).toEqual(['Kickoff Alpha'])
  })
})

describe('Meetings — search', () => {
  it('matches meeting title', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'budget')
    expect(visibleTitles()).toEqual(['Budget Beta'])
  })

  it.each([
    ['agenda text', 'zeta-agenda', ['Standup Delta']],
    ['the contact person', 'anita', ['Kickoff Alpha', 'Review Gamma']],
    ['department name', 'health', ['Budget Beta', 'Standup Delta']],
    ['an attendee (account manager) name', 'vishal', ['Kickoff Alpha', 'Review Gamma']],
  ])('matches %s', async (_what, query, expected) => {
    const { user } = setup()
    await user.type(screen.getByRole('searchbox', { name: /search meetings/i }), query)
    expect(visibleTitles()).toEqual(expected)
  })

  it('combines with filters instead of replacing them', async () => {
    const { user, pick } = setup()
    await user.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'vishal')
    expect(visibleTitles()).toEqual(['Kickoff Alpha', 'Review Gamma'])
    await pick('Filter by region', /West/)
    expect(visibleTitles()).toEqual(['Review Gamma'])
    await pick('Filter by state', 'Maharashtra')
    expect(visibleTitles()).toEqual([])
  })
})
