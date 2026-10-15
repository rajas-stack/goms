import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { GlobalFab } from './GlobalFab'

// "Create Meeting" and "Log Interaction" were two GlobalFab menu items that
// both opened the exact same TimelineEventDialog/mutation, just with
// different typeFilter/initialType props forcing a curated type subset —
// merged into one "Add Meeting" entry that opens the dialog with the full
// type list instead. This covers the menu itself (no stale labels/handlers)
// and that the merged entry still reaches a working dialog with Meeting
// selectable, not any regression in the dialog's own save logic (covered
// separately in TimelineEventDialog.test.tsx).
const CANDIDATE = { id: 'emp-1', name: 'Priya Nair', designation: 'QA Analyst', vacant: false }

function stubApiHooks() {
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [CANDIDATE] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    addTimelineEvent: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
}

function renderFab() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/directory']}>
        <GlobalFab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  stubApiHooks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GlobalFab — Add Meeting consolidation', () => {
  it('offers a single "Add Meeting" entry, with no separate "Create Meeting"/"Log Interaction" items', async () => {
    const user = userEvent.setup()
    renderFab()

    await user.click(screen.getByRole('button', { name: 'Create new' }))

    expect(screen.getByRole('menuitem', { name: 'Add Meeting' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Create Meeting' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Log Interaction' })).not.toBeInTheDocument()
  })

  it('opens the shared timeline dialog on click, offering Meeting as a selectable type once a person is picked', async () => {
    const user = userEvent.setup()
    renderFab()

    await user.click(screen.getByRole('button', { name: 'Create new' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add Meeting' }))

    // employeeId is null from this entry point, so the dialog opens on its
    // person-search step first — same as before this change.
    expect(screen.getByText('Choose who this is for')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Search a person…'), 'Priya')
    await user.click(screen.getByText('Priya Nair'))

    const typeSelect = screen.getByLabelText(/^meeting type/i)
    expect(typeSelect).toHaveValue('meeting')
    expect(screen.getByRole('option', { name: 'Meeting' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Phone Call' })).toBeInTheDocument()
  })
})
