import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { TimelineEventDialog } from './TimelineEventDialog'

// Item 13: Agenda/Outcome/Next Steps are new optional fields on the
// "Log to timeline" form, alongside the existing Note field. This suite
// covers only the submit() payload wiring for the three new fields —
// everything else about the dialog (person picker, attendee list) is
// exercised implicitly by always passing a real employeeId.
const addTimelineMutateAsync = vi.fn().mockResolvedValue({})

function stubApiHooks() {
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    addTimelineEvent: { mutateAsync: addTimelineMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPersons>)
}

beforeEach(() => {
  stubApiHooks()
  sessionStorage.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TimelineEventDialog — Agenda/Outcome/Next Steps (Task 8.2)', () => {
  it('submits agenda, outcome, and nextSteps when all three are filled in', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/^title$/i), 'Budget review meeting')
    await user.type(screen.getByLabelText(/^agenda/i), 'Discuss Q1 budget')
    await user.type(screen.getByLabelText(/^outcome/i), 'Approved with revisions')
    await user.type(screen.getByLabelText(/^next steps/i), 'Send revised sheet by Friday')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(addTimelineMutateAsync).toHaveBeenCalledTimes(1)
    const payload = addTimelineMutateAsync.mock.calls[0][0]
    expect(payload.agenda).toBe('Discuss Q1 budget')
    expect(payload.outcome).toBe('Approved with revisions')
    expect(payload.nextSteps).toBe('Send revised sheet by Friday')
  })

  it('submits successfully with agenda/outcome/nextSteps left blank', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/^title$/i), 'Quick call')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(addTimelineMutateAsync).toHaveBeenCalledTimes(1)
    const payload = addTimelineMutateAsync.mock.calls[0][0]
    expect(payload.agenda).toBeUndefined()
    expect(payload.outcome).toBeUndefined()
    expect(payload.nextSteps).toBeUndefined()
  })
})

// Item 12 / Task 8.3: the attendee checkbox grid was replaced with a
// searchable MultiSelectDropdown that stores an ID-carrying {salesPersonId,
// name} snapshot per selection (rather than just the name), so a later
// rename/removal of that sales person doesn't retroactively change what this
// historical entry displays.
const SALES_PERSONS = [
  { id: 'sp-asha', name: 'Asha Rao' },
  { id: 'sp-vikram', name: 'Vikram Shah' },
]

function stubApiHooksWithRoster() {
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    addTimelineEvent: { mutateAsync: addTimelineMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: SALES_PERSONS } as unknown as ReturnType<typeof api.useSalesPersons>)
}

describe('TimelineEventDialog — attendee picker (Task 8.3)', () => {
  beforeEach(() => {
    stubApiHooksWithRoster()
  })

  it('typing in the picker filters the sales-team roster by name', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /search and select attendees/i }))
    await user.type(screen.getByPlaceholderText('Search sales team…'), 'asha')

    expect(screen.getByRole('checkbox', { name: 'Asha Rao' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Vikram Shah' })).not.toBeInTheDocument()
  })

  it('selecting multiple attendees shows them as chips; removing one via its × updates the selection', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /search and select attendees/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Asha Rao' }))
    await user.click(screen.getByRole('checkbox', { name: 'Vikram Shah' }))

    expect(screen.getByRole('button', { name: /remove asha rao/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove vikram shah/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove asha rao/i }))

    expect(screen.queryByRole('button', { name: /remove asha rao/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove vikram shah/i })).toBeInTheDocument()
  })

  it('never shows the "+ Add option" footer — attendees must come only from the roster', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /search and select attendees/i }))

    expect(screen.queryByRole('button', { name: /add option/i })).not.toBeInTheDocument()
  })

  it('submits the {salesPersonId, name} snapshot for each selected attendee', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /search and select attendees/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Asha Rao' }))
    await user.click(screen.getByRole('checkbox', { name: 'Vikram Shah' }))
    await user.type(screen.getByLabelText(/^title$/i), 'Quarterly review')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(addTimelineMutateAsync).toHaveBeenCalledTimes(1)
    const payload = addTimelineMutateAsync.mock.calls[0][0]
    expect(payload.attendees).toEqual([
      { salesPersonId: 'sp-asha', name: 'Asha Rao' },
      { salesPersonId: 'sp-vikram', name: 'Vikram Shah' },
    ])
  })

  it('displays a legacy plain-string attendee restored from a pre-picker draft read-only, without losing it', async () => {
    const draft = {
      savedAt: Date.now(),
      form: {
        type: 'meeting', title: 'Old in-progress draft', customLabel: '', date: '2026-01-01', time: '', note: '',
        attendees: ['Legacy Person'], agenda: '', outcome: '', nextSteps: '',
      },
    }
    sessionStorage.setItem('gorms:draft:timeline:emp-1', JSON.stringify(draft))

    render(<TimelineEventDialog open employeeId="emp-1" onClose={vi.fn()} />)

    expect(await screen.findByText(/legacy person/i)).toBeInTheDocument()
    // Not offered as a removable chip in the picker itself — it has no
    // salesPersonId to resolve to a roster selection.
    expect(screen.queryByRole('button', { name: /remove legacy person/i })).not.toBeInTheDocument()
  })
})
