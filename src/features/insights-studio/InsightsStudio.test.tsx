import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { StudioMenu } from './StudioMenu'
import { VisualBuilderPage } from './pages/VisualBuilderPage'
import { ReportPage } from './pages/ReportPage'
import { ReportsPage } from './pages/ReportsPage'
import { DataSourcesPage } from './pages/DataSourcesPage'
import { VisualLibraryPage } from './pages/VisualLibraryPage'

function Where() { const l = useLocation(); return <output aria-label="location">{l.pathname}</output> }

function boot(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/insights" element={<StudioMenu />} />
          <Route path="/insights/studio/visuals" element={<VisualLibraryPage />} />
          <Route path="/insights/studio/visuals/new" element={<VisualBuilderPage />} />
          <Route path="/insights/studio/visuals/:id" element={<VisualBuilderPage />} />
          <Route path="/insights/studio/reports" element={<ReportsPage />} />
          <Route path="/insights/studio/reports/:id" element={<ReportPage />} />
          <Route path="/insights/data-sources" element={<DataSourcesPage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function seedSheets() {
  const a = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2026-08-01', vertical: 'Mobility', valueAmount: '12', valueUnit: 'cr' } as never)
  await repository.createBid(a.id, undefined, 'bidTracker')
  const b = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'City GIS', submissionDate: '2026-09-01', vertical: 'Mobility', valueAmount: '5', valueUnit: 'cr' } as never)
  await repository.createBid(b.id, undefined, 'campaign')
}

beforeEach(async () => { localStorage.clear(); await resetLocalData() })

describe('Insights Studio', () => {
  it('opens the studio from an icon-only gear with three options', async () => {
    boot('/insights')
    const gear = screen.getByRole('button', { name: 'Insights studio' })
    expect(gear).toHaveTextContent('')
    await userEvent.click(gear)
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Visualization components', 'Templates / Reports', 'Data sources'])
    await userEvent.click(items[1])
    expect(screen.getByLabelText('location')).toHaveTextContent('/insights/studio/reports')
  })

  it('asks for a data source first and then offers only that source’s fields (lineage)', async () => {
    await seedSheets()
    boot('/insights/studio/visuals/new')
    await userEvent.click(await screen.findByRole('button', { name: 'Use Live Bids' }))
    const groupBy = await screen.findByRole('combobox', { name: 'Group by' })
    const options = within(groupBy).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Opportunity stage')
    expect(options).not.toContain('Sheet')
    expect(await screen.findByText('1 of 1 records match')).toBeInTheDocument()
    await userEvent.selectOptions(groupBy, 'createdAt')
    expect(screen.getByRole('combobox', { name: 'Time grain' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Next: chart/ }))
    expect(screen.getByRole('note')).toHaveTextContent('Recommended: Line')
    const name = screen.getByRole('textbox', { name: 'Visual name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Live Bids trend')
    await userEvent.click(screen.getByRole('button', { name: /Save visual/ }))
    await waitFor(() => expect(screen.getByLabelText('location')).toHaveTextContent('/insights/studio/visuals'))
    const saved = await repository.listInsightVisuals()
    expect(saved).toHaveLength(1)
    expect(saved[0].spec.query.datasetId).toBe('opportunities.bidTracker')
    expect(await screen.findByRole('article', { name: 'Live Bids trend' })).toBeInTheDocument()
  })

  it('renders the built-in H1 Review template with its sections', async () => {
    await seedSheets()
    boot('/insights/studio/reports/builtin%3Ah1-review')
    expect(await screen.findByRole('heading', { name: 'H1 Review' })).toBeInTheDocument()
    for (const name of ['Pipeline', 'Campaign', 'Live bids', 'Orders due to close in H1', 'Orders closed in H1']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument()
    }
    for (const name of ['Open pipeline value', 'Live bids by stage', 'Orders due to close', 'Orders won (value)', 'Win rate']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('combobox', { name: 'Report period' })).toHaveValue('h1')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save as my report/ })).toBeInTheDocument()
  })

  it('adds, moves and removes widgets on a saved report', async () => {
    const report = await repository.createInsightReport({ name: 'My board', filters: { period: { kind: 'all' } }, widgets: [] })
    boot(`/insights/studio/reports/${report.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: /Add visual/ }))
    await userEvent.click(await screen.findByRole('listitem', { name: 'Add Open pipeline value' }))
    await userEvent.click(screen.getByRole('button', { name: /Add heading/ }))
    const grip = screen.getByRole('button', { name: /^Move Open pipeline value/ })
    grip.focus()
    await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowRight}{/Shift}')
    await userEvent.click(screen.getByRole('button', { name: 'Options for heading' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(async () => {
      const [saved] = await repository.listInsightReports()
      expect(saved.widgets).toEqual([expect.objectContaining({ kind: 'visual', visualId: 'builtin:pipeline-value', x: 1, y: 0, w: 4, h: 2 })])
    })
  })

  it('lists data sources with fields, live counts and a create-visual shortcut', async () => {
    boot('/insights/data-sources?source=employees')
    const detail = await screen.findByRole('region', { name: 'Employees' })
    expect(within(detail).getByRole('link', { name: /Create visual from this source/ })).toHaveAttribute('href', '/insights/studio/visuals/new?source=employees')
    expect(await within(detail).findByText(/employee records/)).toBeInTheDocument()
    expect(within(detail).getByRole('figure', { name: 'Employees by Team' })).toBeInTheDocument()
    expect(within(detail).getByRole('cell', { name: 'Reports to' })).toBeInTheDocument()
  })
})
