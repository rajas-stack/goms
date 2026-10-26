import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  states: { data: [] as unknown[], isLoading: false },
  queue: { data: [] as unknown[], isLoading: false },
  boqs: { data: [] as unknown[], isLoading: false },
  documents: { data: [] as unknown[] },
  org: { data: [] as unknown[] },
  sales: { data: [] as unknown[] },
  insights: { data: undefined as unknown },
}))
vi.mock('@/lib/api', () => ({
  useStates: () => mocks.states, useBidActionQueue: () => mocks.queue, useOrgPeople: () => mocks.org,
  useSalesPersons: () => mocks.sales, useInsights: () => mocks.insights,
}))
vi.mock('@/modules/commercial-calculator/api', () => ({ useBoqs: () => mocks.boqs }))
vi.mock('@/modules/document-maker/api', () => ({ useMakerDocuments: () => mocks.documents }))
vi.mock('@/modules/bid-tracker/enabled', () => ({ isBidTrackerEnabled: () => true }))
vi.mock('@/lib/auth', () => ({ useAuthUser: () => ({ user: { displayName: 'Rajas Saji', email: 'rajas@amnex.com', photoUrl: null, emailVerified: true }, loading: false }) }))
import { Home } from './Home'
import { INDIA_STATES } from '@/features/home/indiaStates'

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>)
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

beforeEach(() => {
  mocks.states = { data: [], isLoading: false }
  mocks.queue = { data: [], isLoading: false }
  mocks.boqs = { data: [], isLoading: false }
  mocks.documents = { data: [] }
  mocks.org = { data: [] }
  mocks.sales = { data: [] }
  mocks.insights = { data: undefined }
})

describe('Home', () => {
  it('greets the signed-in person by first name under a level-one heading', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Good (morning|afternoon|evening), Rajas/)
  })

  it('says so when nothing needs attention', () => {
    renderHome()
    expect(screen.getByText('Nothing needs you today.')).toBeInTheDocument()
  })

  it('lists what needs attention, most urgent first, with status, module and date', () => {
    mocks.queue = { isLoading: false, data: [
      { followUpId: 'soon', bidId: 'b2', bidCode: 'B-2', stageKey: 'submitted', opportunityName: 'NIC Kerala', dueDate: day(3), note: 'bid closes', assigneeId: 'sp1', attentionFlag: 'dueSoon' },
      { followUpId: 'late', bidId: 'b1', bidCode: 'B-1', stageKey: 'solutioning', opportunityName: 'Bihar CCTV', dueDate: day(-2), note: 'EMD payment', assigneeId: null, attentionFlag: 'overdue' },
    ] }
    mocks.boqs = { isLoading: false, data: [{ id: 'q1', boqNumber: 'BOQ-7', opportunityName: 'Odisha', customerName: '', status: 'under_review' }] }
    mocks.sales = { data: [{ id: 'sp1', name: 'Anil Kumar' }] }
    renderHome()
    const section = screen.getByRole('region', { name: 'Needs attention' })
    const rows = within(section).getAllByRole('link')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Overdue')
    expect(rows[0]).toHaveTextContent('Bihar CCTV: EMD payment, 2 days overdue')
    expect(rows[0]).toHaveAttribute('href', '/live-bids/bid/b1')
    expect(rows[1]).toHaveTextContent('Due soon')
    expect(within(rows[1]).getByText('AK')).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Waiting')
    expect(rows[2]).toHaveTextContent('BOQ-7 (Odisha) is waiting for approval')
    expect(within(section).getByText('1 overdue · 1 due soon · 1 waiting')).toBeInTheDocument()
  })

  it('shows a card per module with live numbers, each linking to its module', () => {
    mocks.states = { isLoading: false, data: [{ code: INDIA_STATES[0].code, name: 'X', departments: 1, offices: 2, employees: 3 }, { code: INDIA_STATES[1].code, name: 'Y', departments: 0, offices: 0, employees: 0 }] }
    mocks.boqs = { isLoading: false, data: [
      { id: 'a', boqNumber: 'A', opportunityName: '', customerName: '', status: 'approved' },
      { id: 'b', boqNumber: 'B', opportunityName: '', customerName: '', status: 'draft' },
      { id: 'c', boqNumber: 'C', opportunityName: '', customerName: '', status: 'draft' },
    ] }
    mocks.org = { data: [
      { id: 'o1', name: 'Asha Rao', status: 'active', level: 0, departments: ['Leadership'] },
      { id: 'o2', name: 'Ravi Iyer', status: 'active', level: 1, departments: ['Pre-Sales'] },
      { id: 'o3', name: 'Gone Person', status: 'inactive', level: 2, departments: ['Pre-Sales'] },
    ] }
    mocks.documents = { data: [
      { id: 'd1', title: 'Odisha BOQ v3', fileType: 'xlsx', updatedAt: '2026-10-15T10:00:00Z' },
      { id: 'd2', title: 'Old letter', fileType: 'docx', updatedAt: '2026-09-01T10:00:00Z' },
    ] }
    mocks.insights = { data: { metrics: { pipeline: 184.4, active: 12 }, stages: [{ key: 'solutioning', label: 'Solutioning', count: 4 }, { key: 'goApproved', label: 'Go Approved', count: 9 }], trend: [{ key: '1', label: 'May 26', value: 5 }, { key: '2', label: 'Jun 26', value: 9 }] } }
    renderHome()
    const card = (name: string) => within(screen.getByRole('region', { name: 'The app' })).getByRole('link', { name: new RegExp(name) })
    expect(card('Account Mapping')).toHaveAttribute('href', '/map')
    expect(card('Account Mapping')).toHaveTextContent('1 of 36 states')
    expect(card('Commercial Calculator')).toHaveTextContent('2 open BOQs')
    expect(card('Commercial Calculator')).toHaveTextContent('1 of 3 approved')
    expect(card('Opportunity')).toHaveTextContent('12 open bids')
    expect(card('Opportunity')).toHaveTextContent('Solutioning 4')
    expect(card('Opportunity')).not.toHaveTextContent('Go Approved') // closed stages are not "open"
    expect(card('Document maker')).toHaveTextContent('2 files')
    expect(card('Insights')).toHaveTextContent('₹184 Cr pipeline')
    expect(card('Teams')).toHaveTextContent('2 people') // the inactive person is not counted
    // side column: latest document first, headcount, month bars
    expect(screen.getByText('Odisha BOQ v3')).toBeInTheDocument()
    expect(screen.getByText('headcount').previousSibling).toHaveTextContent('2')
    expect(screen.getByRole('img', { name: /May 26: 5 crore/ })).toBeInTheDocument()
  })

  it('has no map card on the page (coverage lives on the Account Mapping card)', () => {
    renderHome()
    expect(screen.queryByText(/states and UTs covered/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Account Mapping/ })).toHaveAttribute('href', '/map')
  })
})
