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
