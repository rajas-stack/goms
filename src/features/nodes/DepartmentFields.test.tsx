import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { DepartmentFields } from './DepartmentFields'
import { serializeContactNumbers } from './contact-numbers'
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

// Deterministic, self-contained STD-code fixture — decoupled from
// src/data/std-codes.ts's real (partial, ever-expanding) dataset so this
// suite doesn't depend on what happens to be seeded for any particular real
// district. Khordha (LGD 386) gets two cities so city-switch/STD-switch and
// multi-row-independence are actually exercisable; Puri (387) gets none, to
// cover the "district with no seeded cities yet" case.
vi.mock('@/data/std-codes', () => ({
  citiesForDistrict: (lgd: number) => {
    if (lgd !== 386) return []
    return [
      { state: 'Odisha', district: 'Khordha', districtLgdCode: 386, city: 'Bhubaneswar', stdCode: '0674', source: 'test', verificationLevel: 'verified' },
      { state: 'Odisha', district: 'Khordha', districtLgdCode: 386, city: 'Cityville', stdCode: '0999', source: 'test', verificationLevel: 'verified' },
    ]
  },
  stdCodeForCity: (lgd: number, city: string) => {
    if (lgd !== 386) return undefined
    return { Bhubaneswar: '0674', Cityville: '0999' }[city]
  },
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

function Harness({ initialMeta = {}, jurisdictionStateCode = 21 }: { initialMeta?: Record<string, string>; jurisdictionStateCode?: number }) {
  const [meta, setMeta] = useState<Record<string, string>>(initialMeta)
  return (
    <DepartmentFields
      meta={meta}
      setMeta={setMeta}
      onShortNameChange={() => {}}
      employees={[]}
      jurisdictionStateCode={jurisdictionStateCode}
    />
  )
}

function renderFields(initialMeta: Record<string, string> = {}) {
  return render(<Harness initialMeta={initialMeta} />)
}

/** Selects a district's city from the searchable City/Town Combobox — never
 *  types the city directly, matching the required flow (a user must pick
 *  from the STD-code dataset, not free-type). */
async function pickCity(user: ReturnType<typeof userEvent.setup>, rowLabel: string, cityName: string) {
  await user.click(screen.getByRole('combobox', { name: new RegExp(rowLabel, 'i') }))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${cityName}$`, 'i') }))
}

async function selectKhordha(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('State'), 'Odisha')
  await waitFor(() => expect(screen.getByLabelText('District')).not.toBeDisabled())
  await user.selectOptions(screen.getByLabelText('District'), 'Khordha')
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

  it('selecting a District filters City/Town to that district\'s seeded cities', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await user.click(screen.getByRole('combobox', { name: /City\/Town 1/i }))

    expect(await screen.findByRole('option', { name: 'Bhubaneswar' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Cityville' })).toBeInTheDocument()
  })

  it('a district with no seeded cities yet shows an empty city picker instead of crashing', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await user.selectOptions(screen.getByLabelText('State'), 'Odisha')
    await waitFor(() => expect(screen.getByLabelText('District')).not.toBeDisabled())
    await user.selectOptions(screen.getByLabelText('District'), 'Puri')
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await user.click(screen.getByRole('combobox', { name: /City\/Town 1/i }))

    expect(await screen.findByText('No matches')).toBeInTheDocument()
    // STD code stays present, empty, and freely editable — no crash either way.
    expect(screen.getByLabelText('STD code 1')).toHaveValue('')
  })

  it('picking a seeded city auto-populates its STD code', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')

    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')
  })

  it('changing the picked City updates the STD code correctly', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

    await pickCity(user, 'City/Town 1', 'Cityville')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0999')
  })

  it('changing the District clears the previous row\'s City and STD code', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

    await user.selectOptions(screen.getByLabelText('District'), 'Puri')

    expect(screen.getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('')
  })

  it('an existing record\'s city that isn\'t in the current dataset still displays, with STD left editable', async () => {
    stubApiHooks()
    renderFields({
      contactStateNodeId: 'state-odisha',
      contactDistrictNodeId: 'dist-khordha',
      contactNumbers: serializeContactNumbers([{ type: 'landline', city: 'Not Yet Mapped Town', stdCode: '', number: '' }]),
    })

    expect(await screen.findByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Not Yet Mapped Town')

    const user = userEvent.setup()
    const stdInput = screen.getByLabelText('STD code 1')
    expect(stdInput).toHaveValue('')
    await user.type(stdInput, '0674')
    expect(stdInput).toHaveValue('0674')
  })

  it('does not commit typed text as the city — only picking an option from the dropdown changes the selection', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')

    const combo = screen.getByRole('combobox', { name: /City\/Town 1/i })
    await user.click(combo)
    await user.type(combo, 'something totally unmatched')
    await user.keyboard('{Escape}')

    // Typing alone (no option clicked) never sticks — the last real
    // selection is still what's committed once the popover closes.
    expect(combo).toHaveValue('Bhubaneswar')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')
  })

  it('"+ Add Contact Number" adds a new empty (landline) row, and removing a row works', async () => {
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

  it('multiple contact rows pick their City/STD independently', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    renderFields()

    await selectKhordha(user)
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
    await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))

    await pickCity(user, 'City/Town 1', 'Bhubaneswar')
    await pickCity(user, 'City/Town 2', 'Cityville')

    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')
    expect(screen.getByLabelText('STD code 2')).toHaveValue('0999')
    expect(screen.getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
    expect(screen.getByRole('combobox', { name: /City\/Town 2/i })).toHaveValue('Cityville')
  })

  describe('Landline/EPBX vs Mobile — separate dialing contexts, never combined', () => {
    it('a Landline/EPBX row shows City/Town, STD code and a local number field with no +91 badge', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      renderFields()

      await selectKhordha(user)
      await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
      const row = screen.getByTestId('contact-number-row-0')

      expect(within(row).getByLabelText('Type 1')).toHaveValue('landline')
      expect(within(row).getByRole('combobox', { name: /City\/Town 1/i })).toBeInTheDocument()
      expect(within(row).getByLabelText('STD code 1')).toBeInTheDocument()
      const numberInput = within(row).getByLabelText('Local/EPBX number')
      expect(numberInput).toBeInTheDocument()
      expect(within(row).queryByText('+91')).not.toBeInTheDocument()

      await user.type(numberInput, '2345678')
      expect(numberInput).toHaveValue('2345678')
    })

    it('a landline local number field caps at 8 digits, independent of the STD code field', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      renderFields()

      await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
      const numberInput = screen.getByLabelText('Local/EPBX number')

      // isValidPhone('123', 'landlineLocal') is false (below the 6-digit
      // floor) and isValidPhone('2345678', ...) is true — covered directly
      // in PhoneInput.test.ts; here we only check this field accepts and
      // caps local-number-length input, unaffected by the STD field beside it.
      await user.type(numberInput, '123456789')
      expect(numberInput).toHaveValue('12345678')

      await user.clear(numberInput)
      await user.type(numberInput, '2345678')
      expect(numberInput).toHaveValue('2345678')
    })

    it('switching a row to Mobile hides City/STD and shows a +91-prefixed 10-digit field instead', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      renderFields()

      await selectKhordha(user)
      await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
      await pickCity(user, 'City/Town 1', 'Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')

      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      const row = screen.getByTestId('contact-number-row-0')
      expect(within(row).getByText('+91')).toBeInTheDocument()
      const mobileInput = within(row).getByLabelText('Phone number (10 digits)')

      await user.type(mobileInput, '9876543210')
      expect(mobileInput).toHaveValue('9876543210')
    })

    it('a Mobile number validates as exactly 10 digits', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      renderFields()

      await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')
      const mobileInput = screen.getByLabelText('Phone number (10 digits)')

      await user.type(mobileInput, '98765')
      expect(mobileInput).toHaveValue('98765')

      await user.type(mobileInput, '43210')
      expect(mobileInput).toHaveValue('9876543210')
    })
  })

  it('loads an existing department\'s saved landline and mobile rows correctly', async () => {
    stubApiHooks()
    renderFields({
      contactStateNodeId: 'state-odisha',
      contactDistrictNodeId: 'dist-khordha',
      contactNumbers: serializeContactNumbers([
        { type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
        { type: 'mobile', city: '', stdCode: '', number: '+91 9876543210' },
      ]),
    })

    const row0 = screen.getByTestId('contact-number-row-0')
    expect(await within(row0).findByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
    expect(within(row0).getByLabelText('STD code 1')).toHaveValue('0674')
    expect(within(row0).getByLabelText('Local/EPBX number')).toHaveValue('2345678')

    const row1 = screen.getByTestId('contact-number-row-1')
    expect(within(row1).getByLabelText('Type 2')).toHaveValue('mobile')
    expect(within(row1).getByLabelText('Phone number (10 digits)')).toHaveValue('9876543210')
  })

  it('displays a legacy landline record whose stored number still carries a stray "+91 " prefix without it', async () => {
    // Before this redesign, PhoneInput always showed a +91 badge even for a
    // landline row, so an older record may have "+91 <digits>" saved as its
    // `number` — the field must still render the bare local digits, not the
    // stale prefix, and stay editable.
    stubApiHooks()
    renderFields({
      contactStateNodeId: 'state-odisha',
      contactDistrictNodeId: 'dist-khordha',
      contactNumbers: serializeContactNumbers([{ type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '+91 2345678' }]),
    })

    expect(await screen.findByLabelText('Local/EPBX number')).toHaveValue('2345678')
  })

  it('hides the State/District pickers for a Central Ministries department (jurisdictionStateCode 0) — 2026-09-03', () => {
    stubApiHooks()
    render(<Harness jurisdictionStateCode={0} />)
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('District')).not.toBeInTheDocument()
  })

  it('still shows the State/District pickers for a real state', () => {
    stubApiHooks()
    render(<Harness jurisdictionStateCode={21} />)
    expect(screen.getByLabelText('State')).toBeInTheDocument()
    expect(screen.getByLabelText('District')).toBeInTheDocument()
  })
})
