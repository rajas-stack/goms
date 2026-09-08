import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { DepartmentFields } from './DepartmentFields'
import { serializeContactNumbers } from './contact-numbers'
import type { HierNode } from '@/lib/types'

// EmployeePicker/SalesTeamPicker's own popover/typeahead mechanics are
// unrelated to what this suite tests (the per-row contact numbers block)
// and hard to drive headlessly — replaced with bare controlled inputs,
// mirroring EmployeeFormDialog.test.tsx's approach.
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
const STATE_NODE_GUJARAT: HierNode = {
  id: 'state-gujarat', domain: 'geo', typeKey: 'state', parentId: 'country-1',
  stateCode: 7, name: 'Gujarat', code: null, sortOrder: 0, metadata: {}, status: 'active',
}
// Gujarat's own district — has zero seeded cities in the fixture above, used
// only to prove a State switch actually clears everything downstream.
const DISTRICT_GANDHINAGAR: HierNode = {
  id: 'dist-gandhinagar', domain: 'geo', typeKey: 'district', parentId: 'state-gujarat',
  stateCode: 7, name: 'Gandhinagar', code: '388', sortOrder: 0, metadata: {}, status: 'active',
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
  'state-gujarat': STATE_NODE_GUJARAT,
  'dist-khordha': DISTRICT_KHORDHA,
  'dist-puri': DISTRICT_PURI,
  'dist-gandhinagar': DISTRICT_GANDHINAGAR,
}

function stubApiHooks() {
  vi.spyOn(api, 'useStates').mockReturnValue(
    {
      data: [
        { code: 5, name: 'Odisha', departments: 0, offices: 0, employees: 0 },
        { code: 7, name: 'Gujarat', departments: 0, offices: 0, employees: 0 },
      ],
    } as unknown as ReturnType<typeof api.useStates>,
  )
  vi.spyOn(api, 'useStateNode').mockImplementation((code: number) => ({
    data: code === 5 ? STATE_NODE_ODISHA : code === 7 ? STATE_NODE_GUJARAT : null,
  } as unknown as ReturnType<typeof api.useStateNode>))
  vi.spyOn(api, 'useNode').mockImplementation(
    (id: string | null) => ({ data: id ? NODES_BY_ID[id] ?? null : null } as unknown as ReturnType<typeof api.useNode>),
  )
  vi.spyOn(api, 'useChildren').mockImplementation((parentId: string | null) => ({
    data:
      parentId === 'state-odisha' ? [DISTRICT_KHORDHA, DISTRICT_PURI]
        : parentId === 'state-gujarat' ? [DISTRICT_GANDHINAGAR]
          : [],
  } as unknown as ReturnType<typeof api.useChildren>))
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

// jurisdictionStateCode 21 deliberately does not resolve to any mocked
// state node — new rows land with State unset, same as a department whose
// jurisdiction isn't (yet) a real state in this fixture, so most tests
// below can drive State/Type/District/City by hand without an auto-default
// getting in the way. The dedicated "auto-populates from jurisdiction"
// tests pass a real, resolvable code (5 = Odisha) instead.

async function addRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
}

/** Selects a district's city from the searchable City/Town Combobox — never
 *  types the city directly, matching the required flow (a user must pick
 *  from the STD-code dataset, not free-type). */
async function pickCity(user: ReturnType<typeof userEvent.setup>, rowLabel: string, cityName: string) {
  await user.click(screen.getByRole('combobox', { name: new RegExp(rowLabel, 'i') }))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${cityName}$`, 'i') }))
}

/** Drives row 1 all the way to "District picked, no city chosen yet" —
 *  the common starting point for several tests below. */
async function addRowThroughDistrict(user: ReturnType<typeof userEvent.setup>, districtName = 'Khordha') {
  await addRow(user)
  await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
  await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')
  await user.selectOptions(screen.getByLabelText('District 1'), districtName)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DepartmentFields — per-row contact numbers (State -> Type -> District -> City -> STD -> Number)', () => {
  describe('the complete reveal sequence', () => {
    it('a brand-new row starts showing only State', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)

      expect(screen.getByLabelText('State 1')).toBeInTheDocument()
      expect(screen.queryByLabelText('Type 1')).not.toBeInTheDocument()
    })

    it('picking a State reveals Type', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')

      expect(await screen.findByLabelText('Type 1')).toBeInTheDocument()
      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
    })

    it('picking Type=Mobile reveals only the mobile number field, no District/City/STD', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Phone number (10 digits)')).toBeInTheDocument()
    })

    it('picking Type=Landline reveals District next; City/STD/Number stay hidden until District is picked', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(await screen.findByLabelText('District 1')).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Local/EPBX number')).not.toBeInTheDocument()
    })

    it('picking a multi-city District reveals City, with STD/Number still hidden until a City is picked', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')

      expect(await screen.findByRole('combobox', { name: /City\/Town 1/i })).toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Local/EPBX number')).not.toBeInTheDocument()
    })

    it('picking a City reveals STD (auto-filled) and Local number', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await pickCity(user, 'City/Town 1', 'Cityville')

      expect(screen.getByLabelText('STD code 1')).toHaveValue('0999')
      expect(screen.getByLabelText('Local/EPBX number')).toBeInTheDocument()
    })
  })

  describe('one-city auto-selection', () => {
    it('auto-fills City and STD the instant a single-city District is picked, no dropdown click needed', async () => {
      stubApiHooks()
      // Override the shared fixture's citiesForDistrict just for this test
      // via a district whose LGD (386) already maps to two cities in the
      // top-level mock — instead, point Puri (387) at a single-city result
      // by re-mocking std-codes for this one test.
      const stdCodes = await import('@/data/std-codes')
      vi.spyOn(stdCodes, 'citiesForDistrict').mockImplementation((lgd: number) =>
        lgd === 387 ? [{ state: 'Odisha', district: 'Puri', districtLgdCode: 387, city: 'Puri Town', stdCode: '06752', source: 'test', verificationLevel: 'verified' }] : [])
      vi.spyOn(stdCodes, 'stdCodeForCity').mockImplementation((lgd: number, city: string) =>
        lgd === 387 && city === 'Puri Town' ? '06752' : undefined)

      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')
      await user.selectOptions(screen.getByLabelText('District 1'), 'Puri')

      expect(await screen.findByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Puri Town')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('06752')
    })
  })

  it('a district with no seeded cities yet shows an empty city picker instead of crashing', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    await addRowThroughDistrict(user, 'Puri')
    await user.click(screen.getByRole('combobox', { name: /City\/Town 1/i }))

    expect(await screen.findByText('No matches')).toBeInTheDocument()
  })

  it('changing the picked City updates the STD code correctly', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    await addRowThroughDistrict(user, 'Khordha')
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

    await pickCity(user, 'City/Town 1', 'Cityville')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0999')
  })

  describe('State/District cascading resets', () => {
    it('changing District clears City/STD/Number', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await pickCity(user, 'City/Town 1', 'Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      await user.selectOptions(screen.getByLabelText('District 1'), 'Puri')

      expect(screen.getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('')
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
    })

    it('changing State clears Type/District/City/STD/Number — Type re-reveals immediately (reset to unset) since it comes right after State', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await pickCity(user, 'City/Town 1', 'Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      await user.selectOptions(screen.getByLabelText('State 1'), 'Gujarat')

      expect(await screen.findByLabelText('State 1')).toHaveValue('7')
      expect(screen.getByLabelText('Type 1')).toHaveValue('')
      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
    })
  })

  describe('Landline/EPBX vs Mobile switching', () => {
    it('switching an in-progress Landline row to Mobile clears District/City/STD/Number and shows the +91 field', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await pickCity(user, 'City/Town 1', 'Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      const row = screen.getByTestId('contact-number-row-0')
      expect(within(row).getByText('+91')).toBeInTheDocument()
      const mobileInput = within(row).getByLabelText('Phone number (10 digits)')
      await user.type(mobileInput, '9876543210')
      expect(mobileInput).toHaveValue('9876543210')
      // State survives the type switch — it's asked before Type, not downstream of it.
      expect(screen.getByLabelText('State 1')).toHaveValue('5')
    })

    it('switching a Mobile row back to Landline starts District/City/STD fresh (empty), not reusing stale mobile digits', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')
      await user.type(screen.getByLabelText('Phone number (10 digits)'), '9876543210')

      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(await screen.findByLabelText('District 1')).toHaveValue('')
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
    })

    it('a Mobile number validates as exactly 10 digits (unchanged PhoneInput behavior)', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')
      const mobileInput = screen.getByLabelText('Phone number (10 digits)')

      await user.type(mobileInput, '98765')
      expect(mobileInput).toHaveValue('98765')
      await user.type(mobileInput, '43210')
      expect(mobileInput).toHaveValue('9876543210')
    })

    it('a landline local number field caps at 8 digits', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await pickCity(user, 'City/Town 1', 'Bhubaneswar')
      const numberInput = screen.getByLabelText('Local/EPBX number')

      await user.type(numberInput, '123456789')
      expect(numberInput).toHaveValue('12345678')
    })
  })

  it('does not commit typed text as the city — only picking an option from the dropdown changes the selection', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    await addRowThroughDistrict(user, 'Khordha')
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')

    const combo = screen.getByRole('combobox', { name: /City\/Town 1/i })
    await user.click(combo)
    await user.type(combo, 'something totally unmatched')
    await user.keyboard('{Escape}')

    expect(combo).toHaveValue('Bhubaneswar')
    expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')
  })

  it('"+ Add Contact Number" adds a new row, and removing a row works', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    expect(screen.queryByTestId('contact-number-row-0')).not.toBeInTheDocument()

    await addRow(user)
    expect(screen.getByTestId('contact-number-row-0')).toBeInTheDocument()

    await addRow(user)
    expect(screen.getByTestId('contact-number-row-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove contact number 1' }))
    expect(screen.queryByTestId('contact-number-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('contact-number-row-0')).toBeInTheDocument()
  })

  it('multiple contact rows operate independently, including different states/districts', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    await addRow(user)
    await addRow(user)

    const row0 = screen.getByTestId('contact-number-row-0')
    const row1 = screen.getByTestId('contact-number-row-1')

    await user.selectOptions(within(row0).getByLabelText('State 1'), 'Odisha')
    await user.selectOptions(within(row0).getByLabelText('Type 1'), 'Landline / EPBX')
    await user.selectOptions(within(row0).getByLabelText('District 1'), 'Khordha')
    await pickCity(user, 'City/Town 1', 'Bhubaneswar')

    await user.selectOptions(within(row1).getByLabelText('State 2'), 'Gujarat')
    await user.selectOptions(within(row1).getByLabelText('Type 2'), 'Mobile')
    await user.type(within(row1).getByLabelText('Phone number (10 digits)'), '9876543210')

    expect(within(row0).getByLabelText('STD code 1')).toHaveValue('0674')
    expect(within(row0).getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
    expect(within(row1).getByLabelText('State 2')).toHaveValue('7')
    expect(within(row1).getByLabelText('Phone number (10 digits)')).toHaveValue('9876543210')
    expect(within(row1).queryByLabelText('District 2')).not.toBeInTheDocument()
  })

  describe('auto-populating State from the department jurisdiction', () => {
    it('a new row starts with State already set to a real jurisdiction (no re-pick needed)', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      // jurisdictionStateCode 5 resolves to Odisha in the fixture — mirrors
      // creating/editing a department that's actually seated in Odisha.
      render(<Harness jurisdictionStateCode={5} />)

      await addRow(user)

      expect(await screen.findByLabelText('State 1')).toHaveValue('5')
      // Type is already revealed too — the user lands straight on the next
      // real decision, never an empty "select a state" step.
      expect(screen.getByLabelText('Type 1')).toBeInTheDocument()
    })

    it('a new row starts fully unset for an unresolvable/unknown jurisdiction — the user picks State by hand', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)

      expect(screen.getByLabelText('State 1')).toHaveValue('')
      expect(screen.queryByLabelText('Type 1')).not.toBeInTheDocument()
    })

    it('Central Ministries departments skip State/District entirely — Type shows immediately', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={0} />)

      await addRow(user)

      expect(screen.queryByLabelText('State 1')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Type 1')).toBeInTheDocument()
    })

    it('a Central Ministries Landline row uses free-text City/STD (no dataset-linked picker, since there is no district)', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={0} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /City\/Town 1/i })).not.toBeInTheDocument()
      const cityInput = screen.getByLabelText('City/Town 1')
      await user.type(cityInput, 'New Delhi')
      expect(cityInput).toHaveValue('New Delhi')
      await user.type(screen.getByLabelText('STD code 1'), '011')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('011')
    })
  })

  describe('legacy migration on load', () => {
    it("an entry with its own stateNodeId/districtNodeId loads exactly as saved", async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactNumbers: serializeContactNumbers([
          { type: 'landline', stateNodeId: 'state-odisha', districtNodeId: 'dist-khordha', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
        ]),
      }} />)

      const row = screen.getByTestId('contact-number-row-0')
      expect(await within(row).findByLabelText('State 1')).toHaveValue('5')
      expect(within(row).getByLabelText('District 1')).toHaveValue('dist-khordha')
      expect(within(row).getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
      expect(within(row).getByLabelText('STD code 1')).toHaveValue('0674')
      expect(within(row).getByLabelText('Local/EPBX number')).toHaveValue('2345678')
    })

    it('an entry saved before per-row geography existed inherits the department\'s old section-level State/District', async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactStateNodeId: 'state-odisha',
        contactDistrictNodeId: 'dist-khordha',
        // Raw legacy JSON predating stateNodeId/districtNodeId entirely.
        contactNumbers: '[{"type":"landline","city":"Bhubaneswar","stdCode":"0674","number":"2345678"}]',
      }} />)

      const row = screen.getByTestId('contact-number-row-0')
      expect(await within(row).findByLabelText('State 1')).toHaveValue('5')
      expect(within(row).getByLabelText('District 1')).toHaveValue('dist-khordha')
      expect(within(row).getByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
    })

    it('loads an existing department\'s saved landline and mobile rows correctly, each independently', async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactNumbers: serializeContactNumbers([
          { type: 'landline', stateNodeId: 'state-odisha', districtNodeId: 'dist-khordha', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
          { type: 'mobile', stateNodeId: 'state-gujarat', districtNodeId: '', city: '', stdCode: '', number: '+91 9876543210' },
        ]),
      }} />)

      const row0 = screen.getByTestId('contact-number-row-0')
      expect(await within(row0).findByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Bhubaneswar')
      expect(within(row0).getByLabelText('STD code 1')).toHaveValue('0674')
      expect(within(row0).getByLabelText('Local/EPBX number')).toHaveValue('2345678')

      const row1 = screen.getByTestId('contact-number-row-1')
      expect(within(row1).getByLabelText('State 2')).toHaveValue('7')
      expect(within(row1).getByLabelText('Type 2')).toHaveValue('mobile')
      expect(within(row1).getByLabelText('Phone number (10 digits)')).toHaveValue('9876543210')
    })

    it('displays a legacy landline number that still carries a stray "+91 " prefix without it', async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactNumbers: serializeContactNumbers([
          { type: 'landline', stateNodeId: 'state-odisha', districtNodeId: 'dist-khordha', city: 'Bhubaneswar', stdCode: '0674', number: '+91 2345678' },
        ]),
      }} />)

      expect(await screen.findByLabelText('Local/EPBX number')).toHaveValue('2345678')
    })

    it("an old record's city that isn't in the current dataset still displays, with STD left editable", async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactNumbers: serializeContactNumbers([
          { type: 'landline', stateNodeId: 'state-odisha', districtNodeId: 'dist-khordha', city: 'Not Yet Mapped Town', stdCode: '', number: '' },
        ]),
      }} />)

      expect(await screen.findByRole('combobox', { name: /City\/Town 1/i })).toHaveValue('Not Yet Mapped Town')

      const user = userEvent.setup()
      const stdInput = screen.getByLabelText('STD code 1')
      expect(stdInput).toHaveValue('')
      await user.type(stdInput, '0674')
      expect(stdInput).toHaveValue('0674')
    })
  })
})
