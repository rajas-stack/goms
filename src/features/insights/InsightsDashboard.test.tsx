import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { computeInsights, type InsightRecord, type InsightsFilters } from '@goms/domain'
const mocks = vi.hoisted(() => ({ refetch: vi.fn(), import: vi.fn(), export: vi.fn(), query: vi.fn(), state: 'ready', deny: '' }))
vi.mock('@/app/AppLayout', () => ({ useShell: () => ({ openImport: mocks.import }) }))
vi.mock('@/lib/csv', async original => ({ ...await original<typeof import('@/lib/csv')>(), downloadCsv: mocks.export }))
vi.mock('@/lib/rbacTree/access', () => ({ useNodeFilter: () => (id: string) => id !== mocks.deny }))
vi.mock('@/app/routes/RelationshipAnalytics', () => ({ RelationshipAnalytics: () => <div>Original relationship analytics</div> }))
vi.mock('@/lib/api', () => ({ useInsights: (filters: InsightsFilters, enabled: boolean) => { mocks.query(filters, enabled); return { data: computeInsights(mocks.state === 'empty' ? [] : records, filters, '2026-10-15'), isLoading: mocks.state === 'loading', isError: mocks.state === 'error', isFetching: false, refetch: mocks.refetch } } }))
import { Insights } from './InsightsDashboard'
import { money, stateName } from './InsightCharts'
const records: InsightRecord[] = [
  { id: 'bid-a', opportunityId: 'opp-a', name: 'AI Sangrah', department: 'GIL', stateCode: 24, vertical: 'Data & AI', stageKey: 'submitted', opportunityStageKey: 'submitted', sheet: 'bidTracker', status: 'active', attentionFlag: 'overdue', createdAt: '2026-10-01', closedOn: null, dueAt: '2026-10-02', valueCr: 10, owner: 'Sales Owner', presales: 'Presales Owner', team: 'Bid Owner', competitors: ['Rival'] },
  { id: 'bid-b', opportunityId: 'opp-b', name: 'GIS Platform', department: 'ITE&C', stateCode: 27, vertical: 'GIS', stageKey: 'qualification', opportunityStageKey: 'qualified', sheet: 'bidTracker', status: 'active', attentionFlag: 'onTrack', createdAt: '2026-09-01', closedOn: null, dueAt: '2026-12-01', valueCr: 20, owner: 'Sales Owner', presales: 'Presales Owner', team: 'Bid Owner', competitors: [] },
]
const boot = (path = '/insights') => render(<MemoryRouter initialEntries={[path]}><Insights/></MemoryRouter>)
beforeEach(() => { vi.clearAllMocks(); mocks.state = 'ready'; mocks.deny = ''; records.splice(2); localStorage.setItem('goms.insights.sampleData', '0') })
describe('Insights screenshot coverage', () => {
  it('renders all four real headline metrics and every overview panel', () => {
    expect(money(.005)).toBe('\u20b90.005 Cr'); expect(stateName('__others')).toBe('Others')
    boot()
    for (const name of ['Total Pipeline', 'Weighted Pipeline', 'Bid Win Rate', 'Active Opportunities']) expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
    for (const name of ['Opportunity Pipeline by Stage', 'Pipeline by Vertical', 'Pipeline by Department', 'Opportunity Trend', 'Geographic Distribution', 'Recent Opportunities', 'Key Insights']) expect(screen.getByRole('region', { name })).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Headline statistics' })).getByText('\u20b930 Cr')).toBeVisible()
  })
  it.each([['Sales', 'Opportunities by Sales Owner'], ['Presales', 'Presales Opportunity Load'], ['Bids', 'Bid Attention'], ['Revenue', 'Won Opportunity Value'], ['Competitors', 'Recorded Competitor Exposure'], ['Team', 'Bid Team Workload'], ['Forecast', 'Weighted Forecast by Due Quarter']])('opens the working %s view', async (tab, title) => {
    boot(); await userEvent.click(within(screen.getByRole('navigation', { name: 'Insights views' })).getByRole('button', { name: tab })); expect(screen.getByRole('region', { name: title })).toBeVisible()
  })
  it('preserves the existing relationship analytics view', async () => {
    boot(); await userEvent.click(screen.getByRole('button', { name: 'Relationship Analytics' })); expect(screen.getByText('Original relationship analytics')).toBeVisible()
  })
  it('filters actual statistics by vertical, state, search and clear', async () => {
    boot(); await userEvent.selectOptions(screen.getByLabelText('Insights vertical'), 'GIS')
    expect(within(screen.getByRole('region', { name: 'Headline statistics' })).getByText('\u20b920 Cr')).toBeVisible()
    await userEvent.selectOptions(screen.getByLabelText('Insights state'), '24')
    expect(screen.getAllByText('No matching records').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByLabelText('Clear insights filters'))
    await userEvent.type(screen.getByLabelText('Search insights'), 'AI Sangrah')
    expect(within(screen.getByRole('region', { name: 'Recent Opportunities' })).getByRole('link', { name: 'AI Sangrah' })).toBeVisible()
  })
  it('links recent opportunities and status to the exact Bid Tracker Overview', () => {
    boot(); const recent = within(screen.getByRole('region', { name: 'Recent Opportunities' }))
    expect(recent.getByRole('link', { name: 'AI Sangrah' })).toHaveAttribute('href', '/bid-tracker/bid/bid-a?tab=overview')
    expect(recent.getByRole('link', { name: 'Overdue' })).toHaveAttribute('href', '/bid-tracker/bid/bid-a?tab=overview')
  })
  it('takes recent opportunities from Bid Tracker, not Pipeline or Campaign', () => {
    records.push({ ...records[0], id: 'campaign-row', opportunityId: 'campaign-opp', name: 'Campaign only', sheet: 'campaign' })
    records.push({ ...records[0], id: 'pipeline-row', opportunityId: 'pipeline-opp', name: 'Pipeline only', sheet: 'pipeline-funnel' })
    boot(); const recent = within(screen.getByRole('region', { name: 'Recent Opportunities' }))
    expect(recent.queryByRole('link', { name: 'Campaign only' })).not.toBeInTheDocument()
    expect(recent.queryByRole('link', { name: 'Pipeline only' })).not.toBeInTheDocument()
    expect(recent.getByRole('link', { name: 'AI Sangrah' })).toBeVisible()
  })
  it('opens chart-source records, View All, row actions and key insights', async () => {
    boot(); await userEvent.click(screen.getByRole('button', { name: /^Total Pipeline/ }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Total Pipeline' })).toBeVisible()); await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'View All' })); await waitFor(() => expect(screen.getByRole('dialog', { name: 'All opportunities' })).toBeVisible())
    await userEvent.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Actions for AI Sangrah' })); expect(screen.getByRole('link', { name: 'Open Competition' })).toHaveAttribute('href', '/bid-tracker/bid/bid-a?tab=competition')
  })
  it('changes monthly/quarterly and value/count modes, and exports filtered safe CSV', async () => {
    boot(); await userEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Trend measure' })).getByRole('button', { name: 'Count' }))
    expect(screen.getByRole('img', { name: 'Opportunity trend by count' })).toBeVisible()
    await userEvent.selectOptions(screen.getByLabelText('Insights vertical'), 'GIS'); await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(mocks.export).toHaveBeenCalledOnce(); expect(mocks.export.mock.calls[0][1]).toContain('GIS Platform'); expect(mocks.export.mock.calls[0][1]).not.toContain('AI Sangrah')
    await userEvent.click(screen.getByRole('button', { name: 'Import' })); expect(mocks.import).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByLabelText('Refresh insights')); expect(mocks.refetch).toHaveBeenCalledOnce()
  })
  it.each(['loading', 'error', 'empty'])('handles the %s state without invented records', state => { mocks.state = state; boot(); expect(screen.getByTestId('insights-page')).toBeVisible(); if (state === 'loading') expect(screen.getByRole('status')).toBeVisible(); if (state === 'error') expect(screen.getByRole('alert')).toBeVisible(); if (state === 'empty') expect(screen.getAllByText('No matching records').length).toBeGreaterThan(0) })
  it('does not render a permission-denied tab', () => { mocks.deny = 'accountMapping.insights.forecast'; boot(); expect(screen.queryByRole('button', { name: 'Forecast' })).not.toBeInTheDocument() })
  it('isolates sample data, disables live requests/import and restores live data', async () => {
    boot('/insights?demo=1')
    expect(screen.getByRole('switch', { name: 'Use sample data' })).toBeChecked()
    expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), false)
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Refresh insights')); expect(mocks.refetch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Export' })); expect(mocks.export.mock.calls[0][0]).toContain('insights-sample-')
    await userEvent.click(screen.getByRole('switch', { name: 'Use sample data' }))
    expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), true)
    expect(within(screen.getByRole('region', { name: 'Headline statistics' })).getByText('\u20b930 Cr')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })
  it('previews sample records without linking to nonexistent real bids', async () => {
    boot('/insights?demo=1')
    const recent = within(screen.getByRole('region', { name: 'Recent Opportunities' }))
    expect(recent.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(recent.getByRole('button', { name: 'AI Sangrah - 2nd call' }))
    const preview = within(screen.getByRole('dialog', { name: 'AI Sangrah - 2nd call' }))
    await waitFor(() => expect(preview.getByText('Overdue')).toBeVisible())
    await userEvent.click(preview.getByRole('button', { name: 'General' })); expect(preview.getByText('Sales owner')).toBeVisible()
    await userEvent.click(preview.getByRole('button', { name: 'Competition' })); expect(preview.getByText('Example Systems')).toBeVisible()
  })
  it('restores sample selection on a sidebar-style visit and honors an explicit live URL', () => {
    localStorage.setItem('goms.insights.sampleData', '1')
    const first = boot()
    expect(screen.getByRole('switch', { name: 'Use sample data' })).toBeChecked()
    first.unmount(); boot('/insights?demo=0')
    expect(screen.getByRole('switch', { name: 'Use sample data' })).not.toBeChecked()
    expect(localStorage.getItem('goms.insights.sampleData')).toBe('0')
  })
  it('starts the requested visual review with clearly labeled samples when no preference exists', () => {
    localStorage.removeItem('goms.insights.sampleData'); boot()
    expect(screen.getByRole('switch', { name: 'Use sample data' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), false)
  })
  it('uses the two-series reference legend without permitting a blank chart', async () => {
    boot(); const legend = within(screen.getByRole('group', { name: 'Stage measures' }))
    expect(legend.queryByRole('button', { name: 'Both' })).not.toBeInTheDocument()
    const value = legend.getByRole('button', { name: /Value/ }), count = legend.getByRole('button', { name: 'Count' })
    await userEvent.click(count); expect(count).toHaveAttribute('aria-pressed', 'false'); expect(value).toBeDisabled()
    await userEvent.click(count); await userEvent.click(value)
    expect(value).toHaveAttribute('aria-pressed', 'false'); expect(count).toBeDisabled()
  })
})
