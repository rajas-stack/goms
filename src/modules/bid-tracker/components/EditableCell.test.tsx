import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { NO_LOOKUPS, resolveColumns, type EntityLookups, type GridColumnMeta } from '../gridColumns'
import { EditableCell } from './EditableCell'

const column = (id: string): GridColumnMeta => resolveColumns([]).find((c) => c.id === id)!

function renderCell(col: GridColumnMeta, value: unknown, extra: { lookups?: EntityLookups; row?: { stateCode: number | null } } = {}) {
  const onCommit = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EditableCell col={col} value={value} display={String(value ?? '')} onCommit={onCommit} {...extra} />
    </QueryClientProvider>,
  )
  return onCommit
}

describe('EditableCell', () => {
  beforeEach(async () => {
    await resetLocalData()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 35, width: 300, height: 35, toJSON: () => ({}) })
  })

  it('Next Action: Enter adds a point, Ctrl+Enter saves the lines as plain text', async () => {
    const onCommit = renderCell(column('nextActionNote'), 'Call client')
    await userEvent.click(screen.getByRole('button', { name: 'Edit Next Action' }))
    const box = screen.getByRole('textbox', { name: 'Next Action' })
    await userEvent.type(box, '{Enter}Send revised BOQ')
    expect(onCommit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onCommit).toHaveBeenCalledWith('Call client\nSend revised BOQ')
  })

  it('date & time: reads dd-mm-yyyy with seconds, keeps a date typed alone date-only, and offers a calendar', async () => {
    const col = column('general:queriesDeadline')
    const onCommit = renderCell(col, '')
    await userEvent.click(screen.getByRole('button', { name: `Edit ${col.header}` }))
    expect(screen.getByRole('button', { name: `Pick ${col.header} from a calendar` })).toBeInTheDocument()
    const dateInput = screen.getByRole('textbox', { name: col.header })
    let typed = ''
    for (const character of '09-10-2026 00:00:00') {
      typed += character
      await userEvent.type(dateInput, character)
      expect(dateInput, `The date draft must stay as typed: ${typed}`).toHaveValue(typed)
    }
    await userEvent.type(dateInput, '{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-09T00:00')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: `Edit ${col.header}` }))
    await userEvent.type(screen.getByRole('textbox', { name: col.header }), '09-10-2026{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-09')
  })

  it('General multi-select: keeps a value that is not in the master, and stores one value per line', async () => {
    const lookups = { ...NO_LOOKUPS, masters: { requirements: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] } }
    const col = column('general:scopeOfWork')
    const onCommit = renderCell(col, 'Legacy item\nA', { lookups })
    await userEvent.click(screen.getByRole('button', { name: `Edit ${col.header}` }))
    const list = await screen.findByRole('listbox', { name: `${col.header} options` })
    expect(within(list).getByRole('checkbox', { name: 'Legacy item' })).toBeChecked()
    await userEvent.click(within(list).getByRole('checkbox', { name: 'B' }))
    await userEvent.click(within(list).getByRole('button', { name: 'Done' }))
    expect(onCommit).toHaveBeenCalledWith('A\nB\nLegacy item')
  })

  it('adds a typed value to the column’s master and ticks it at once', async () => {
    const lookups = { ...NO_LOOKUPS, masters: { requirements: [{ value: 'A', label: 'A' }] } }
    const col = column('general:scopeOfWork')
    const onCommit = renderCell(col, '', { lookups })
    await userEvent.click(screen.getByRole('button', { name: `Edit ${col.header}` }))
    await userEvent.type(screen.getByRole('textbox', { name: `Search ${col.header}` }), 'Data Lake')
    await userEvent.click(screen.getByRole('option', { name: '+ Add "Data Lake"' }))
    const list = screen.getByRole('listbox', { name: `${col.header} options` })
    await waitFor(() => expect(within(list).getByRole('checkbox', { name: 'Data Lake' })).toBeChecked())
    expect((await repository.listMaster('requirements')).map((r) => [r.code, r.name])).toContainEqual(['data-lake', 'Data Lake'])
    await userEvent.click(within(list).getByRole('button', { name: 'Done' }))
    expect(onCommit).toHaveBeenCalledWith('Data Lake')
  })

  it('City: picks from the row’s State, takes a typed city, and needs a State first', async () => {
    const onCommit = renderCell(column('city'), '', { row: { stateCode: 7 } }) // Delhi
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search City' }), 'new')
    await userEvent.click(screen.getByRole('option', { name: 'New Delhi' }))
    expect(onCommit).toHaveBeenLastCalledWith('New Delhi')
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search City' }), 'Dwarka{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('Dwarka')
  })

  it('City without a State says so and offers nothing to pick', async () => {
    renderCell(column('city'), '', { row: { stateCode: null } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }))
    expect(screen.getByText(/Choose the State first/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search City' }), 'Pune')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('every State / UT is in the local states list (Delhi included)', async () => {
    const names = (await repository.listStates()).map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining(['Delhi', 'Ladakh', 'Puducherry', 'Chandigarh', 'Jammu and Kashmir']))
    expect(names).toHaveLength(37) // 36 States / UTs + Central Ministries
  })
})
