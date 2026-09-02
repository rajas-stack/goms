import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { DepartmentFields } from './DepartmentFields'
import type { HierNode } from '@/lib/types'

// EmployeePicker/SalesTeamPicker's own popover/typeahead mechanics are
// unrelated to what this suite tests (the State/District/City + contact
// numbers block) and hard to drive headlessly — replaced with bare
// controlled inputs, mirroring EmployeeFormDialog.test.tsx's approach.
vi.mock('@/features/employees/EmployeePicker', () => ({
  EmployeePicker: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <input aria-label="Department head" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('@/features/employees/SalesTeamPicker', () => ({
  SalesTeamPicker: ({ value, onChange, disabled }: { value: string; onChange: (email: string) => void; disabled?: boolean }) => (
    <input aria-label="sales-team-picker" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
  ),
}))

const STATE_NODE_ODISHA: HierNode = {
  id: 'state-odisha', domain: 'geo', typeKey: 'state', parentId: 'country-1',
  stateCode: 5, name: 'Odisha', code: null, sortOrder: 0, metadata: {}, status: 'active',
}
const DISTRICT_KHORDHA: HierNode = {
  id: 'dist-khordha', domain: 'geo', typeKey: 'district', parentId: 'state-odisha',
  stateCode: 5, name: 'Khordha', code: '386', sortOrder: 0, metadata: {}, status: 'active',
}
const DISTRICT_PURI: HierNode = {
  id: 'dist-puri', domain: 'geo', typeKey: 'district', parentId: 'state-odisha',
  stateCode: 5, name: 'Puri', code: '387', sortOrder: 0, metadata: {}, status: 'active',
}

const NODES_BY_ID: Record<string, HierNode> = {
  'state-odisha': STATE_NODE_ODISHA,
  'dist-khordha': DISTRICT_KHORDHA,
  'dist-puri': DISTRICT_PURI,
}

function stubApiHooks() {
  vi.spyOn(api, 'useStates').mockReturnValue(
    { data: [{ code: 5, name: 'Odisha', departments: 0, offices: 0, employees: 0 }] } as unknown as ReturnType<typeof api.useStates>,
  )
  vi.spyOn(api, 'useStateNode').mockImplementation(
    (code: number) => ({ data: code === 5 ? STATE_NODE_ODISHA : null } as unknown as ReturnType<typeof api.useStateNode>),
  )
  vi.spyOn(api, 'useNode').mockImplementation(
    (id: string | null) => ({ data: id ? NODES_BY_ID[id] ?? null : null } as unknown as ReturnType<typeof api.useNode>),
  )
  vi.spyOn(api, 'useChildren').mockImplementation(
    (parentId: string | null) => ({
      data: parentId === 'state-odisha' ? [DISTRICT_KHORDHA, DISTRICT_PURI] : [],
    } as unknown as ReturnType<typeof api.useChildren>),
  )
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
}

function Harness({ initialMeta = {} }: { initialMeta?: Record<string, string> }) {
  const [meta, setMeta] = useState<Record<string, string>>(initialMeta)
  return (
    <DepartmentFields
      meta={meta}
      setMeta={setMeta}
      onShortNameChange={() => {}}
      employees={[]}
    />
  )
}

function renderFields(initialMeta: Record<string, string> = {}) {
  return render(<Harness initialMeta={initialMeta} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DepartmentFields — Contact numbers (State/District/City picker + STD auto-populate)', () => {
  it('selecting a State populates the District dropdown with that state\'s districts', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await user.selectOptions(screen.getByLabelText('State'), 'Odisha')

    const districtSelect = await screen.findByLabelText('District')
    await waitFor(() => {
      expect(within(districtSelect as HTMLElement).getByText('Khordha')).toBeInTheDocument()
      expect(within(districtSelect as HTMLElement).getByText('Puri')).toBeInTheDocument()
    })
  })

  it('picking the seeded Bhubaneswar/Khordha example auto-populates STD code 0674', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await user.selectOptions(screen.getByLabelText('State'), 'Odisha')
    await waitFor(() => expect(screen.getByLabelText('District')).not.toBeDisabled())
    await user.selectOptions(screen.getByLabelText('District'), 'Khordha')

    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    const row = screen.getByTestId('contact-number-row-0')
    await user.type(within(row).getByLabelText('City/Town 1'), 'Bhubaneswar')

    await waitFor(() => expect(within(row).getByLabelText('STD code 1')).toHaveValue('0674'))
  })

  it('typing a city name not in the seed data is still accepted as free text, with STD code left blank', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await user.selectOptions(screen.getByLabelText('State'), 'Odisha')
    await waitFor(() => expect(screen.getByLabelText('District')).not.toBeDisabled())
    await user.selectOptions(screen.getByLabelText('District'), 'Khordha')

    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    const row = screen.getByTestId('contact-number-row-0')
    await user.type(within(row).getByLabelText('City/Town 1'), 'Cuttack')

    expect(within(row).getByLabelText('City/Town 1')).toHaveValue('Cuttack')
    expect(within(row).getByLabelText('STD code 1')).toHaveValue('')
  })

  it('"+ Add Contact Number" adds a new empty row, and removing a row works', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    expect(screen.queryByTestId('contact-number-row-0')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    expect(screen.getByTestId('contact-number-row-0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    expect(screen.getByTestId('contact-number-row-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove contact number 1' }))
    expect(screen.queryByTestId('contact-number-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('contact-number-row-0')).toBeInTheDocument()
  })

  it('each row accepts a mobile or a landline number via PhoneInput mode="mobileOrLandline"', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    const row = screen.getByTestId('contact-number-row-0')
    const numberInput = within(row).getByLabelText('Phone number (mobile or STD + landline)')

    await user.type(numberInput, '9876543210')
    expect(numberInput).toHaveValue('9876543210')

    await user.clear(numberInput)
    await user.type(numberInput, '06742345678')
    expect(numberInput).toHaveValue('06742345678')
  })
})
