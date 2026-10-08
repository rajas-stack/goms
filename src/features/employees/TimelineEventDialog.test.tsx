import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { ALL_EVENT_TYPES, MEETING_LOG_TYPES } from '@/lib/timeline-meta'
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

})

// Task 8.4 (Item 14): editing an existing event pre-fills every field from
// the record (not from a draft) and calls updateTimelineEvent instead of
// addTimelineEvent on submit.
const updateTimelineMutateAsync = vi.fn().mockResolvedValue({})

function stubApiHooksForEdit() {
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    addTimelineEvent: { mutateAsync: addTimelineMutateAsync, isPending: false },
    updateTimelineEvent: { mutateAsync: updateTimelineMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: SALES_PERSONS } as unknown as ReturnType<typeof api.useSalesPersons>)
}

describe('TimelineEventDialog — edit mode (Task 8.4)', () => {
  beforeEach(() => {
    stubApiHooksForEdit()
  })

  const existingEvent = {
    id: 'evt-1', employeeId: 'emp-1', type: 'meeting' as const, title: 'Budget review',
    date: '2026-01-01', time: '14:00', note: 'Some note', source: 'manual' as const,
    attendees: ['Legacy Person', { salesPersonId: 'sp-asha', name: 'Asha Rao' }],
    agenda: 'Discuss Q1 budget', outcome: 'Approved with revisions', nextSteps: 'Send revised sheet by Friday',
  }

  it('pre-fills every field from the existing record, including a mixed legacy/new attendees case', async () => {
    render(<TimelineEventDialog open employeeId="emp-1" existingEvent={existingEvent} onClose={vi.fn()} />)

    expect(screen.getByLabelText(/^title$/i)).toHaveValue('Budget review')
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('01 Jan 2026') // the shared date field shows the stored 2026-01-01 readably
    expect(screen.getByLabelText(/^time$/i)).toHaveValue('14:00')
    expect(screen.getByLabelText(/^note/i)).toHaveValue('Some note')
    expect(screen.getByLabelText(/^agenda/i)).toHaveValue('Discuss Q1 budget')
    expect(screen.getByLabelText(/^outcome/i)).toHaveValue('Approved with revisions')
    expect(screen.getByLabelText(/^next steps/i)).toHaveValue('Send revised sheet by Friday')
    // Resolvable attendee shows as a removable picker chip…
    expect(screen.getByRole('button', { name: /remove asha rao/i })).toBeInTheDocument()
    // …the legacy plain-string one shows read-only via the same "Also:" line
    // Task 8.3 built for the draft-restore case.
    expect(screen.getByText(/legacy person/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove legacy person/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('calls updateTimelineEvent with the same id on save, not addTimelineEvent', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" existingEvent={existingEvent} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText(/^title$/i))
    await user.type(screen.getByLabelText(/^title$/i), 'Budget review v2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateTimelineMutateAsync).toHaveBeenCalledTimes(1)
    expect(addTimelineMutateAsync).not.toHaveBeenCalled()
    const call = updateTimelineMutateAsync.mock.calls[0][0]
    expect(call.id).toBe('evt-1')
    expect(call.patch.title).toBe('Budget review v2')
  })

  it('sends null (not omitted) for agenda/outcome/nextSteps when cleared, so the edit actually clears them', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" existingEvent={existingEvent} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText(/^agenda/i))
    await user.clear(screen.getByLabelText(/^outcome/i))
    await user.clear(screen.getByLabelText(/^next steps/i))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const call = updateTimelineMutateAsync.mock.calls[0][0]
    expect(call.patch.agenda).toBeNull()
    expect(call.patch.outcome).toBeNull()
    expect(call.patch.nextSteps).toBeNull()
  })

  // Bug fix (review of commit a30552d1): the Meeting type Select was fully
  // editable in Edit mode, and submit() included type/customLabel in the
  // patch sent to updateTimelineEvent. The Postgres router's zod patch shape
  // has no type/customLabel keys, so it silently STRIPS them, while the
  // in-memory backend's Object.assign(evt, patch) has no such filter and
  // silently APPLIES them — same user action, different result depending on
  // which backend is active. Fix: the Type field is immutable during Edit,
  // and type/customLabel are never included in the patch at all, regardless
  // of backend.
  it('renders the Meeting type Select as disabled while editing an existing event', () => {
    render(<TimelineEventDialog open employeeId="emp-1" existingEvent={existingEvent} onClose={vi.fn()} />)

    expect(screen.getByLabelText(/^meeting type/i)).toBeDisabled()
  })

  it('never sends type or customLabel in the patch on save, regardless of which backend is active', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" existingEvent={existingEvent} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText(/^title$/i))
    await user.type(screen.getByLabelText(/^title$/i), 'Budget review v2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const call = updateTimelineMutateAsync.mock.calls[0][0]
    expect(call.patch).not.toHaveProperty('type')
    expect(call.patch).not.toHaveProperty('customLabel')
  })
})

// GlobalFab's "Add Activity" and EmployeeDetails' "+ Add meeting" merged
// down to typeFilter differences on this one dialog (no more separate
// "Create Meeting"/"Log Interaction" flows) — this covers that each list
// still offers the right options and default, at the prop level rather than
// through either specific caller's own UI.
describe('TimelineEventDialog — unified type list (Add Activity consolidation)', () => {
  beforeEach(() => {
    stubApiHooks()
  })

  it('offers every type including Meeting, defaulting to Meeting, when given ALL_EVENT_TYPES (the FAB\'s "Add Activity")', () => {
    render(<TimelineEventDialog open employeeId="emp-1" typeFilter={ALL_EVENT_TYPES} onClose={vi.fn()} />)

    const select = screen.getByLabelText(/^meeting type/i)
    expect(select).toHaveValue('meeting')
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(optionLabels).toContain('Meeting')
    expect(optionLabels).toContain('Phone Call')
    expect(optionLabels).toContain('Email')
  })

  it('offers Meeting alongside the other contact types, still defaulting to In Person, from a profile\'s "+ Add meeting" (MEETING_LOG_TYPES)', () => {
    render(<TimelineEventDialog open employeeId="emp-1" typeFilter={MEETING_LOG_TYPES} onClose={vi.fn()} />)

    const select = screen.getByLabelText(/^meeting type/i)
    expect(select).toHaveValue('inPerson')
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(optionLabels).toContain('Meeting')
  })

  it('still honors an explicit initialType override for a future context-specific caller', () => {
    render(<TimelineEventDialog open employeeId="emp-1" typeFilter={ALL_EVENT_TYPES} initialType="call" onClose={vi.fn()} />)

    expect(screen.getByLabelText(/^meeting type/i)).toHaveValue('call')
  })

  it('can submit a new entry with type "meeting" through the unified type list', async () => {
    const user = userEvent.setup()
    render(<TimelineEventDialog open employeeId="emp-1" typeFilter={ALL_EVENT_TYPES} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/^title$/i), 'QA Sync')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(addTimelineMutateAsync).toHaveBeenCalledTimes(1)
    expect(addTimelineMutateAsync.mock.calls[0][0].type).toBe('meeting')
  })
})

describe('TimelineEventDialog — attendee picker draft-restore text (Task 8.3, unaffected)', () => {
  beforeEach(() => {
    stubApiHooksWithRoster()
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
