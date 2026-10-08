import { beforeAll, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpportunityTimeline } from './OpportunityTimeline'
import type { OpportunityTimeline as Timeline } from './types'

// jsdom has no PointerEvent: without one, testing-library builds a plain Event and drops clientX.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
})

const TODAY = '2026-01-20'
const timeline: Timeline = {
  opportunityId: 'opp1',
  startDate: '2026-01-01',
  endDate: '2026-03-02',
  milestones: [
    { id: 'solutioning', name: 'Solutioning', sequence: 1, plannedStart: '2026-01-01', plannedEnd: '2026-01-19', actualStart: '2026-01-01', actualEnd: '2026-01-12', status: 'COMPLETED', icon: 'Sparkles' },
    { id: 'qualification', name: 'Qualification', sequence: 2, plannedStart: '2026-01-19', plannedEnd: '2026-01-28', actualStart: '2026-01-12', status: 'IN_PROGRESS' },
    { id: 'preBidQueries', name: 'Pre-bid Queries', sequence: 3, plannedStart: '2026-01-28', plannedEnd: '2026-02-09', status: 'UPCOMING', issueCount: 3 },
    { id: 'commercialProposal', name: 'Commercial Proposal', sequence: 4, plannedStart: '2026-02-09', plannedEnd: '2026-02-27', status: 'UPCOMING' },
    { id: 'submitted', name: 'Submitted', sequence: 5, plannedStart: '2026-02-27', plannedEnd: '2026-03-02', status: 'UPCOMING' },
  ],
  events: [
    { id: 'e1', date: '2026-02-01', type: 'Query', severity: 'Low', title: 'Query one', status: 'Open', milestoneId: 'preBidQueries' },
    { id: 'e2', date: '2026-02-02', type: 'Delay', severity: 'High', title: 'Vendor quote late', status: 'Open', milestoneId: 'preBidQueries', owner: 'ops@amnex.com' },
    { id: 'e3', date: '2026-02-02', type: 'Clarification', severity: 'Medium', title: 'Scope clarification', status: 'Open', milestoneId: 'preBidQueries' },
    { id: 'e4', date: '2026-01-05', type: 'Submission Change', severity: 'Medium', title: 'Corrigendum #1', status: 'Resolved', milestoneId: 'solutioning' },
  ],
}

const frame = () => screen.getByTestId('timeline-frame')
const pxPerDay = () => Number(frame().dataset.pxPerDay)
const viewStart = () => Number(frame().dataset.viewStart)
const renderTimeline = (over: Partial<Timeline> = {}, isClosed?: boolean) =>
  render(<OpportunityTimeline timeline={{ ...timeline, ...over }} today={TODAY} isClosed={isClosed} />)


const openRange = async () => userEvent.click(screen.getByRole('button', { name: /^Visible range/ }))
const pickRange = async (label: string) => { await openRange(); await userEvent.click(screen.getByRole('menuitem', { name: label })) }
const plannedLeft = (name: string) => parseFloat(screen.getByRole('button', { name: new RegExp(`^${name} planned:`) }).style.left)

describe('OpportunityTimeline', () => {
  it('renders the header, stage cards, rows and legend', () => {
    renderTimeline()
    expect(screen.getByRole('heading', { name: 'Opportunity Timeline' })).toBeInTheDocument()
    expect(screen.getByText('Track planned vs actual progress across key stages')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Visible range 01 Jan 2026 to 02 Mar 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Solutioning: Completed/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Qualification: In progress/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Submitted: Upcoming/ })).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'Legend' })
    for (const label of ['Planned', 'Actual', 'Upcoming', 'Delayed', 'Milestone', 'Issue', 'Today']) expect(within(legend).getByText(label)).toBeInTheDocument()
    expect(screen.getByTestId('deadline-marker')).toHaveTextContent('02 MarDeadline')
    expect(screen.getByTestId('today-marker')).toHaveTextContent('Today20 Jan')
  })

  it('flags an estimated end date and a closed outcome', () => {
    renderTimeline({ endDateEstimated: true, outcome: 'Dropped' })
    expect(screen.getByText(/Deadline not set/)).toBeInTheDocument()
    expect(screen.getByText(/Closed · Dropped/)).toBeInTheDocument()
    expect(screen.getByTestId('deadline-marker')).toHaveTextContent('Est. end')
    expect(screen.queryByTestId('today-marker')).not.toBeInTheDocument()
  })

  it('places bars time-proportionally, not equally', () => {
    renderTimeline()
    const solToQual = plannedLeft('Qualification') - plannedLeft('Solutioning')
    const qualToPre = plannedLeft('Pre-bid Queries') - plannedLeft('Qualification')
    expect(solToQual / qualToPre).toBeCloseTo(18 / 9, 5)
  })

  it('shows actual bars, ongoing work and late running in the actual row', () => {
    render(<OpportunityTimeline timeline={timeline} today="2026-02-05" />)
    expect(screen.getByRole('button', { name: /^Solutioning actual: 01 Jan to 12 Jan, 11 days/ })).toBeInTheDocument()
    const ongoing = screen.getByRole('button', { name: /^Qualification actual: 12 Jan to today, 24 days so far/ })
    expect(ongoing.className).toContain('crimson')
  })

  it('changes the time scale from the range menu and returns with Full View', async () => {
    renderTimeline()
    await pickRange('1 week')
    expect(pxPerDay()).toBeCloseTo(960 / 7, 2)
    await pickRange('1 month')
    expect(pxPerDay()).toBeCloseTo(960 / 30, 2)
    await userEvent.click(screen.getByRole('button', { name: 'Full View' }))
    expect(screen.getByRole('button', { name: 'Full View' })).toHaveAttribute('aria-pressed', 'true')
    expect(pxPerDay()).toBeLessThan(960 / 30)
  })

  it('zooms around today when today is on screen', async () => {
    renderTimeline()
    await pickRange('1 week')
    expect(viewStart() + 3.5).toBeCloseTo(Date.UTC(2026, 0, 20) / 86_400_000, 3)
  })

  it('moves by 30 days per step at 1 month', async () => {
    renderTimeline()
    await pickRange('1 month')
    frame().focus()
    await userEvent.keyboard('{Home}')
    const before = viewStart()
    await openRange()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Later' }))
    expect(viewStart() - before).toBeCloseTo(30, 3)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Earlier' }))
    expect(viewStart()).toBeCloseTo(before, 3)
  })

  it('centres today and highlights the active stage', async () => {
    renderTimeline()
    await pickRange('Centre on today')
    expect(pxPerDay()).toBeCloseTo(960 / 30, 2)
    expect(viewStart() + 15).toBeCloseTo(Date.UTC(2026, 0, 20) / 86_400_000, 3)
    expect(screen.getByRole('button', { name: /^Qualification:/ }).className).toContain('ring-blue')
  })

  it('centres the end date for a closed opportunity', async () => {
    renderTimeline({}, true)
    await pickRange('Centre on today')
    expect(viewStart() + 30).toBeCloseTo(Date.UTC(2026, 2, 2) / 86_400_000 + 2, 3)
  })

  it('describes the active stage by default, and another stage when picked', async () => {
    renderTimeline()
    const detail = () => screen.getByTestId('stage-detail')
    expect(detail()).toHaveAccessibleName('Qualification details')
    expect(within(detail()).getByText('Expected End')).toBeInTheDocument()
    // Started a week before plan, and forecast to finish a week before plan too.
    expect(within(detail()).getAllByText('7 days early')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: /^Solutioning: Completed/ }))
    expect(detail()).toHaveAccessibleName('Solutioning details')
    expect(within(detail()).getByText('Actual End')).toBeInTheDocument()
    expect(within(detail()).getByText('12 Jan 2026')).toBeInTheDocument()
    expect(within(detail()).getByText('On time')).toBeInTheDocument()
    expect(within(detail()).getByText('7 days early')).toBeInTheDocument()
    expect(within(detail()).getByText('11 days')).toBeInTheDocument()
  })

  it('forecasts the end of a stage running late and shows the delay', () => {
    render(<OpportunityTimeline timeline={timeline} today="2026-03-05" />)
    const detail = screen.getByTestId('stage-detail')
    expect(within(detail).getByText('05 Mar 2026')).toBeInTheDocument()
    expect(within(detail).getByText('36 days delay')).toBeInTheDocument()
    expect(within(detail).getByText('52 days (ongoing)')).toBeInTheDocument()
  })

  it('opens a stage from its Gantt bar', async () => {
    renderTimeline()
    await userEvent.click(screen.getByRole('button', { name: /^Pre-bid Queries planned:/ }))
    expect(screen.getByTestId('stage-detail')).toHaveAccessibleName('Pre-bid Queries details')
    expect(within(screen.getByTestId('stage-detail')).getByText('Not started')).toBeInTheDocument()
  })

  it('shows the latest note with its author', () => {
    renderTimeline({ latestNote: { text: 'Commercials review with client pending.', at: '2026-01-19T05:50:00.000Z', author: 'Shubham Mehra', authorPerson: { name: 'Shubham Mehra', photoUrl: null } } })
    const detail = screen.getByTestId('stage-detail')
    expect(within(detail).getByText('Commercials review with client pending.')).toBeInTheDocument()
    expect(within(detail).getByText('Shubham Mehra')).toBeInTheDocument()
  })

  it('clusters nearby issues and opens the grouped list on click', async () => {
    renderTimeline()
    const cluster = screen.getByRole('button', { name: /^3 events around/ })
    expect(cluster).toHaveTextContent('3')
    await userEvent.click(cluster)
    const detail = screen.getByRole('region', { name: 'Timeline details' })
    expect(within(detail).getByText('3 events')).toBeInTheDocument()
    await userEvent.click(within(detail).getByRole('button', { name: /Vendor quote late/ }))
    expect(within(detail).getByText('Delay')).toBeInTheDocument()
    expect(within(detail).getByText('ops@amnex.com')).toBeInTheDocument()
    await userEvent.click(within(detail).getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Timeline details' })).not.toBeInTheDocument())
  })

  it('splits the cluster into single markers when zoomed in', async () => {
    renderTimeline()
    await pickRange('1 week')
    expect(screen.queryByRole('button', { name: /^3 events around/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Query: Query one/ })).toBeInTheDocument()
  })

  it('pans by dragging the viewport', async () => {
    renderTimeline()
    await pickRange('1 month')
    const before = viewStart()
    fireEvent.pointerDown(frame(), { clientX: 400, pointerId: 3, button: 0 })
    fireEvent.pointerMove(frame(), { clientX: 336, pointerId: 3 })
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    fireEvent.pointerUp(frame(), { clientX: 336, pointerId: 3 })
    await waitFor(() => expect(viewStart() - before).toBeCloseTo(64 / (960 / 30), 2))
  })

  it('pans with a horizontal wheel / trackpad gesture', async () => {
    renderTimeline()
    await pickRange('1 month')
    const before = viewStart()
    fireEvent.wheel(frame(), { deltaX: 64 })
    expect(viewStart() - before).toBeCloseTo(2, 3)
  })

  it('is keyboard accessible', async () => {
    renderTimeline()
    await pickRange('1 month')
    frame().focus()
    await userEvent.keyboard('{Home}')
    const before = viewStart()
    await userEvent.keyboard('{ArrowRight}')
    expect(viewStart() - before).toBeCloseTo(30, 3)
    await userEvent.keyboard('{End}')
    expect(viewStart()).toBeGreaterThan(before)
    screen.getByRole('button', { name: /^Solutioning: Completed/ }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('stage-detail')).toHaveAccessibleName('Solutioning details')
  })
})
