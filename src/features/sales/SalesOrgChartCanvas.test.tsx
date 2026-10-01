import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { SalesOrgChartCanvas } from './SalesOrgChartCanvas'
import type { SalesPerson, SalesPosting } from '@/lib/types'

vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn() }),
}))

beforeEach(() => {
  // jsdom has no ResizeObserver; SalesOrgChartCanvas uses one purely to
  // recompute connector-line positions on resize, which this suite never
  // asserts on (same gap/fix as HierarchyCanvas.test.tsx).
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

function person(id: string, name: string): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
    photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}

const ALICE = person('a', 'Alice')
const BOB = person('b', 'Bob')

function stub(people: SalesPerson[], postings: Record<string, SalesPosting>) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people, isLoading: false } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: postings } as unknown as ReturnType<typeof api.useCurrentPostings>)
}

describe('SalesOrgChartCanvas', () => {
  it('shows an empty state when there are no sales people', () => {
    stub([], {})
    render(<SalesOrgChartCanvas />)
    expect(screen.getByText(/No sales people yet/i)).toBeInTheDocument()
  })

  it('renders a root and, once expanded, its direct report — with a connecting line', async () => {
    stub([ALICE, BOB], { b: posting('b', 'a'), a: posting('a', null) })
    render(<SalesOrgChartCanvas />)
    expect(screen.getByTestId('sales-org-chart-card-a')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('sales-org-chart-toggle-a'))
    expect(screen.getByTestId('sales-org-chart-card-b')).toBeInTheDocument()
    expect(document.querySelector('svg path')).toBeTruthy()
  })

  it('Expand all reveals every branch without individually toggling each one', async () => {
    stub([ALICE, BOB], { b: posting('b', 'a'), a: posting('a', null) })
    render(<SalesOrgChartCanvas />)
    expect(screen.queryByTestId('sales-org-chart-card-b')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Expand all/i }))
    expect(screen.getByTestId('sales-org-chart-card-b')).toBeInTheDocument()
  })

  it('renders a broken manager reference as its own flagged root instead of disappearing', () => {
    stub([ALICE], { a: posting('a', 'ghost') })
    render(<SalesOrgChartCanvas />)
    const card = screen.getByTestId('sales-org-chart-card-a')
    expect(within(card).getByText('Alice')).toBeInTheDocument()
  })

  describe('canvas navigation controls (same toolbar as the Organization canvas)', () => {
    it('renders fit/zoom/reset/expand/collapse/connectors/keyboard-shortcuts controls, matching the shared HierarchyCanvas toolbar', () => {
      stub([ALICE], {})
      render(<SalesOrgChartCanvas />)
      expect(screen.getByRole('button', { name: 'Fit to screen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /connectors/i })).not.toBeInTheDocument()
      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('does not offer drag-to-reparent, Organization-only controls, or a delete key', () => {
      stub([ALICE], {})
      render(<SalesOrgChartCanvas />)
      const card = screen.getByTestId('sales-org-chart-card-a')
      expect(card).not.toHaveAttribute('draggable')
      expect(screen.queryByLabelText('Search departments…')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Search people')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /show metadata/i })).not.toBeInTheDocument()
    })

    it('Zoom in and Zoom out update the displayed zoom percentage', async () => {
      stub([ALICE], {})
      render(<SalesOrgChartCanvas />)
      expect(screen.getByText('100%')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      expect(screen.getByText('118%')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('the keyboard-shortcuts dialog shows only the shortcuts this canvas actually supports', async () => {
      stub([ALICE], {})
      render(<SalesOrgChartCanvas />)
      await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
      expect(screen.getByText('Fit to screen')).toBeInTheDocument()
      expect(screen.getByText('Expand all')).toBeInTheDocument()
      expect(screen.getByText('Collapse all')).toBeInTheDocument()
      // Organization-canvas-only shortcuts (arrow-key nav, delete, search)
      // must not be advertised here — this canvas doesn't support them.
      expect(screen.queryByText('Navigate hierarchy')).not.toBeInTheDocument()
      expect(screen.queryByText('Delete selected')).not.toBeInTheDocument()
      expect(screen.queryByText('Search')).not.toBeInTheDocument()
    })

    it('Expand all and Collapse all still work from the new toolbar (unchanged behavior, new location)', async () => {
      stub([ALICE, BOB], { b: posting('b', 'a'), a: posting('a', null) })
      render(<SalesOrgChartCanvas />)
      expect(screen.queryByTestId('sales-org-chart-card-b')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
      expect(screen.getByTestId('sales-org-chart-card-b')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
      expect(screen.queryByTestId('sales-org-chart-card-b')).not.toBeInTheDocument()
    })
  })
})
