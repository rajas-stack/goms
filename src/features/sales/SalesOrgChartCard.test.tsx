import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalesOrgChartCard } from './SalesOrgChartCard'
import type { SalesPerson, SalesPosting } from '@/lib/types'

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const POSTING: SalesPosting = {
  id: 'post-1', salesPersonId: 'sp-alice', designation: 'Regional Manager', tierKey: 'rm',
  managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
  changeType: 'initial', reason: '', createdAt: '', createdBy: null,
}

function baseProps(overrides: Partial<Parameters<typeof SalesOrgChartCard>[0]> = {}) {
  return {
    person: ALICE, posting: POSTING, flagged: false, selected: false, expanded: false,
    canExpand: false, directReportCount: 0, onSelect: vi.fn(), onToggle: vi.fn(),
    ...overrides,
  }
}

describe('SalesOrgChartCard', () => {
  it('renders name, designation, email, and an initials-only avatar', () => {
    render(<SalesOrgChartCard {...baseProps()} />)
    expect(screen.getByText('Alice Anderson')).toBeInTheDocument()
    expect(screen.getByText('Regional Manager')).toBeInTheDocument()
    expect(screen.getByText('alice@amnex.com')).toBeInTheDocument()
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveTextContent('AA')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the photo as an image when photoUrl is set', () => {
    const withPhoto = { ...ALICE, photoUrl: 'data:image/png;base64,AAA=' }
    render(<SalesOrgChartCard {...baseProps({ person: withPhoto })} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn()
    render(<SalesOrgChartCard {...baseProps({ onSelect })} />)
    await userEvent.click(screen.getByText('Alice Anderson'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows an expand/collapse toggle only when it has direct reports, and does not also select', async () => {
    const onToggle = vi.fn()
    const onSelect = vi.fn()
    render(<SalesOrgChartCard {...baseProps({ canExpand: true, directReportCount: 3, onToggle, onSelect })} />)
    await userEvent.click(screen.getByTestId('sales-org-chart-toggle-sp-alice'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks a flagged (broken-reference) node distinctly', () => {
    render(<SalesOrgChartCard {...baseProps({ flagged: true })} />)
    expect(screen.getByTestId('sales-org-chart-card-sp-alice')).toHaveClass('border-dashed')
  })
})
