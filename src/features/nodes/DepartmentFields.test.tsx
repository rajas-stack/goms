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
// district. Khordha (LGD 386) and Gandhinagar (LGD 388) each map to two
// cities (so STD can't be auto-picked unambiguously — City becomes a
// restricted Combobox there, per Requirement 1's redesign); the two
// district's city lists are kept disjoint on purpose, to prove a
// dataset-backed city never leaks across districts. Puri (387) maps to
// none, to cover the "district with no seeded cities yet" case — the
// actual bug this suite guards against never blocking the STD/Local
// number fields.
const KHORDHA_CITIES = [
  { state: 'Odisha', district: 'Khordha', districtLgdCode: 386, city: 'Bhubaneswar', stdCode: '0674', source: 'test', verificationLevel: 'verified' as const },
  { state: 'Odisha', district: 'Khordha', districtLgdCode: 386, city: 'Cityville', stdCode: '0999', source: 'test', verificationLevel: 'verified' as const },
]
const GANDHINAGAR_CITIES = [
  { state: 'Gujarat', district: 'Gandhinagar', districtLgdCode: 388, city: 'Gandhinagar City', stdCode: '079', source: 'test', verificationLevel: 'verified' as const },
  { state: 'Gujarat', district: 'Gandhinagar', districtLgdCode: 388, city: 'Kalol', stdCode: '02764', source: 'test', verificationLevel: 'verified' as const },
]
function citiesFor(lgd: number) {
  if (lgd === 386) return KHORDHA_CITIES
  if (lgd === 388) return GANDHINAGAR_CITIES
  return []
}
// Odisha-only, test-fixture-only ambiguity: "Cityville" seeded under both
// Khordha and Puri, with different STD codes — proves the city-search
// field's district-labeled-candidates behavior without ever adding a
// synthetic duplicate to the real src/data/std-codes.ts dataset.
const PURI_CITIES = [
  { state: 'Odisha', district: 'Puri', districtLgdCode: 387, city: 'Cityville', stdCode: '06752', source: 'test', verificationLevel: 'verified' as const },
]
function citiesForState(state: string) {
  if (state === 'Odisha') return [...KHORDHA_CITIES, ...PURI_CITIES]
  if (state === 'Gujarat') return GANDHINAGAR_CITIES
  return []
}
vi.mock('@/data/std-codes', () => ({
  citiesForDistrict: (lgd: number) => citiesFor(lgd),
  stdCodeForCity: (lgd: number, city: string) => citiesFor(lgd).find((c) => c.city === city)?.stdCode,
  citiesInState: (state: string) => citiesForState(state),
}))

const STATE_NODE_ODISHA: HierNode = {
  id: 'state-odisha', domain: 'geo', typeKey: 'state', parentId: 'country-1',
  stateCode: 5, name: 'Odisha', code: null, sortOrder: 0, metadata: {}, status: 'active',
}
const STATE_NODE_GUJARAT: HierNode = {
  id: 'state-gujarat', domain: 'geo', typeKey: 'state', parentId: 'country-1',
  stateCode: 7, name: 'Gujarat', code: null, sortOrder: 0, metadata: {}, status: 'active',
}
// Gujarat's own district — maps to its own disjoint two-city set in the
// fixture above (Gandhinagar City/Kalol), used both to prove a State switch
// clears everything downstream, and to prove City combobox options never
// leak across districts (Khordha's cities must never appear here).
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
// below can drive State/Type/District by hand without an auto-default
// getting in the way. The dedicated "auto-populates from jurisdiction"
// tests pass a real, resolvable code (5 = Odisha) instead.

async function addRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '+ Add Contact Number' }))
}

/** Drives row 1 all the way to "District picked" — the common starting
 *  point for several tests below. */
async function addRowThroughDistrict(user: ReturnType<typeof userEvent.setup>, districtName = 'Khordha') {
  await addRow(user)
  await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
  await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')
  await user.selectOptions(screen.getByLabelText('District 1'), districtName)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DepartmentFields — per-row contact numbers (State -> Type -> District -> STD -> Number)', () => {
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
    })

    it('picking Type=Mobile reveals only the mobile number field, no District/City/STD', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('City/Town 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Phone number (10 digits)')).toBeInTheDocument()
    })

    it('picking Type=Landline reveals District, City/Town, STD, and Number together — City/Town starts as a state-wide search, District empty', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(await screen.findByLabelText('District 1')).toHaveValue('')
      const cityField = screen.getByRole('combobox', { name: 'City/Town 1' })
      expect(cityField).toHaveValue('')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
      expect(screen.getByLabelText('Number')).toHaveValue('')
    })

    it('picking a District switches City/Town from state-wide search into that district\'s own scoped list', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')

      expect(screen.getByLabelText('STD code 1')).toBeInTheDocument()
      expect(screen.getByLabelText('Number')).toBeInTheDocument()

      // Now scoped to Khordha only — Gandhinagar's cities must never appear.
      const cityCombobox = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityCombobox)
      expect(await screen.findByRole('option', { name: 'Bhubaneswar' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Gandhinagar City' })).not.toBeInTheDocument()
    })
  })

  describe('one-city auto-selection', () => {
    it('auto-fills City and STD the instant a single-city District is picked, no lookup needed — and both stay hand-editable', async () => {
      stubApiHooks()
      // Puri (387) maps to a single city in this test's own override.
      const stdCodes = await import('@/data/std-codes')
      vi.spyOn(stdCodes, 'citiesForDistrict').mockImplementation((lgd: number) =>
        lgd === 387 ? [{ state: 'Odisha', district: 'Puri', districtLgdCode: 387, city: 'Puri Town', stdCode: '06752', source: 'test', verificationLevel: 'verified' }] : [])

      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')
      await user.selectOptions(screen.getByLabelText('District 1'), 'Puri')

      // Unambiguous single-city district: a plain (not a combobox), pre-filled input.
      const cityInput = await screen.findByLabelText('City/Town 1')
      expect(cityInput).toHaveValue('Puri Town')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('06752')

      // Still hand-editable — the dataset is a lookup aid, never a lock.
      await user.clear(cityInput)
      await user.type(cityInput, 'Puri Town (renamed)')
      expect(cityInput).toHaveValue('Puri Town (renamed)')
    })
  })

  describe('multi-city district — City becomes a restricted combobox (Requirement 1 redesign)', () => {
    it('a district mapped to more than one city renders City as a combobox scoped to just that district\'s cities, with STD unset until one is picked', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')

      expect(screen.getByLabelText('STD code 1')).toHaveValue('')

      const cityCombobox = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityCombobox)
      expect(await screen.findByRole('option', { name: 'Bhubaneswar' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Cityville' })).toBeInTheDocument()
      // Never another district's cities.
      expect(screen.queryByRole('option', { name: 'Gandhinagar City' })).not.toBeInTheDocument()
    })

    it('selecting Bhubaneswar (the stakeholder-reported gap) auto-fills its STD code 0674', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')

      await user.click(screen.getByRole('combobox', { name: 'City/Town 1' }))
      await user.click(await screen.findByRole('option', { name: 'Bhubaneswar' }))

      expect(screen.getByRole('combobox', { name: 'City/Town 1' })).toHaveValue('Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')
    })

    it('City combobox options never leak across districts — Khordha and Gandhinagar each show only their own dataset cities', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await user.click(screen.getByRole('combobox', { name: 'City/Town 1' }))
      expect(await screen.findByRole('option', { name: 'Bhubaneswar' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Gandhinagar City' })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Kalol' })).not.toBeInTheDocument()

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 2'), 'Gujarat')
      await user.selectOptions(screen.getByLabelText('Type 2'), 'Landline / EPBX')
      await user.selectOptions(screen.getByLabelText('District 2'), 'Gandhinagar')

      await user.click(screen.getByRole('combobox', { name: 'City/Town 2' }))
      expect(await screen.findByRole('option', { name: 'Gandhinagar City' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Kalol' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Bhubaneswar' })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Cityville' })).not.toBeInTheDocument()
    })

    it('typing a city that matches no option never commits it and never sets a wrong STD', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')

      const cityCombobox = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityCombobox)
      await user.type(cityCombobox, 'Some Unlisted Town')

      expect(await screen.findByText('No matches')).toBeInTheDocument()
      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
    })
  })

  describe('city-first search via the single City/Town field (Approach A, single-control redesign)', () => {
    it('before a District is picked, City/Town is a state-wide search — typing alone never mutates District/STD', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      const cityField = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityField)
      await user.type(cityField, 'Bhub')

      expect(await screen.findByRole('option', { name: 'Bhubaneswar' })).toBeInTheDocument()
      // Typing alone — no option clicked yet — must not have resolved anything.
      expect(screen.getByLabelText('District 1')).toHaveValue('')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
    })

    it('selecting an unambiguous city resolves District, City, and STD together, atomically — District stays a normal, visible, editable select', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      const cityField = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityField)
      await user.click(await screen.findByRole('option', { name: 'Bhubaneswar' }))

      expect(screen.getByLabelText('District 1')).toHaveValue('dist-khordha')
      expect(screen.getByLabelText('District 1')).not.toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'City/Town 1' })).toHaveValue('Bhubaneswar')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      // District remains fully usable afterward — picking a different one by
      // hand still re-triggers the existing District->City logic unchanged,
      // and City/Town flips back into that new district's own scoped mode.
      await user.selectOptions(screen.getByLabelText('District 1'), 'Puri')
      expect(screen.getByLabelText('District 1')).toHaveValue('dist-puri')
      expect(screen.getByLabelText('City/Town 1')).toHaveValue('')
    })

    it('an ambiguous city name (recurring across two of this state\'s districts) lists each candidate labeled by district; picking one resolves atomically', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      const cityField = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityField)
      await user.type(cityField, 'Cityville')

      const khordhaOption = await screen.findByRole('option', { name: 'Cityville — Khordha district' })
      expect(screen.getByRole('option', { name: 'Cityville — Puri district' })).toBeInTheDocument()
      // Still nothing resolved while only candidates are showing.
      expect(screen.getByLabelText('District 1')).toHaveValue('')

      await user.click(khordhaOption)

      expect(screen.getByLabelText('District 1')).toHaveValue('dist-khordha')
      expect(screen.getByRole('combobox', { name: 'City/Town 1' })).toHaveValue('Cityville')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0999')
    })

    it('typing an unmatched query into the state-wide search shows "No matches" and leaves District/STD untouched', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      const cityField = screen.getByRole('combobox', { name: 'City/Town 1' })
      await user.click(cityField)
      await user.type(cityField, 'Some Unlisted Town')

      expect(await screen.findByText('No matches')).toBeInTheDocument()
      expect(screen.getByLabelText('District 1')).toHaveValue('')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
    })

    it('changing State after a city-search resolution still clears District/City/STD/Number downstream, same as the existing District path', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')
      await user.click(screen.getByRole('combobox', { name: 'City/Town 1' }))
      await user.click(await screen.findByRole('option', { name: 'Bhubaneswar' }))
      expect(screen.getByLabelText('STD code 1')).toHaveValue('0674')

      await user.selectOptions(screen.getByLabelText('State 1'), 'Gujarat')

      expect(await screen.findByLabelText('Type 1')).toHaveValue('')
      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('City/Town 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
    })
  })

  describe('zero-city district — City stays fully free-text (Requirement 1: never blocks entry)', () => {
    it('a district with no seeded cities allows City and STD to both be typed by hand', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Puri')

      const cityInput = await screen.findByLabelText('City/Town 1')
      expect(cityInput.tagName).toBe('INPUT')
      expect(cityInput).not.toHaveAttribute('role', 'combobox')

      await user.type(cityInput, 'Some Unlisted Town')
      expect(cityInput).toHaveValue('Some Unlisted Town')

      const stdInput = screen.getByLabelText('STD code 1')
      expect(stdInput).toHaveValue('')
      await user.type(stdInput, '06752')
      expect(stdInput).toHaveValue('06752')
    })
  })

  it('a district with no seeded cities at all still reveals STD/Local number — never blocks entry (the actual bug this fixes)', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    render(<Harness jurisdictionStateCode={21} />)

    await addRowThroughDistrict(user, 'Puri')

    const stdInput = await screen.findByLabelText('STD code 1')
    const numberInput = screen.getByLabelText('Number')
    expect(stdInput).toBeEnabled()
    expect(numberInput).toBeEnabled()

    await user.type(stdInput, '06752')
    await user.type(numberInput, '2345678')
    expect(stdInput).toHaveValue('06752')
    expect(numberInput).toHaveValue('2345678')
  })

  describe('State/District cascading resets', () => {
    it('changing District clears STD (a district-scoped lookup, no longer valid under the new district)', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await user.type(screen.getByLabelText('STD code 1'), '0674')

      await user.selectOptions(screen.getByLabelText('District 1'), 'Puri')

      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
    })

    it('changing State clears Type/District/STD/Number — Type re-reveals immediately (reset to unset) since it comes right after State', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await user.type(screen.getByLabelText('STD code 1'), '0674')

      await user.selectOptions(screen.getByLabelText('State 1'), 'Gujarat')

      expect(await screen.findByLabelText('State 1')).toHaveValue('7')
      expect(screen.getByLabelText('Type 1')).toHaveValue('')
      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
    })
  })

  describe('Landline/EPBX vs Mobile switching', () => {
    it('switching an in-progress Landline row to Mobile clears District/STD/Number and shows the +91 field', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRowThroughDistrict(user, 'Khordha')
      await user.type(screen.getByLabelText('STD code 1'), '0674')

      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('STD code 1')).not.toBeInTheDocument()
      const row = screen.getByTestId('contact-number-row-0')
      expect(within(row).getByText('+91')).toBeInTheDocument()
      const mobileInput = within(row).getByLabelText('Phone number (10 digits)')
      await user.type(mobileInput, '9876543210')
      expect(mobileInput).toHaveValue('9876543210')
      // State survives the type switch — it's asked before Type, not downstream of it.
      expect(screen.getByLabelText('State 1')).toHaveValue('5')
    })

    it('switching a Mobile row back to Landline starts District/STD fresh (empty), not reusing stale mobile digits', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={21} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('State 1'), 'Odisha')
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Mobile')
      await user.type(screen.getByLabelText('Phone number (10 digits)'), '9876543210')

      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(await screen.findByLabelText('District 1')).toHaveValue('')
      expect(screen.getByRole('combobox', { name: 'City/Town 1' })).toHaveValue('')
      expect(screen.getByLabelText('STD code 1')).toHaveValue('')
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
      const numberInput = screen.getByLabelText('Number')

      await user.type(numberInput, '123456789')
      expect(numberInput).toHaveValue('12345678')
    })
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
    await user.type(within(row0).getByLabelText('STD code 1'), '0674')

    await user.selectOptions(within(row1).getByLabelText('State 2'), 'Gujarat')
    await user.selectOptions(within(row1).getByLabelText('Type 2'), 'Mobile')
    await user.type(within(row1).getByLabelText('Phone number (10 digits)'), '9876543210')

    expect(within(row0).getByLabelText('STD code 1')).toHaveValue('0674')
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

    it('a Central Ministries Landline row uses free-text STD (no district to look it up from)', async () => {
      stubApiHooks()
      const user = userEvent.setup()
      render(<Harness jurisdictionStateCode={0} />)

      await addRow(user)
      await user.selectOptions(screen.getByLabelText('Type 1'), 'Landline / EPBX')

      expect(screen.queryByLabelText('District 1')).not.toBeInTheDocument()
      const stdInput = screen.getByLabelText('STD code 1')
      await user.type(stdInput, '011')
      expect(stdInput).toHaveValue('011')
      await user.type(screen.getByLabelText('Number'), '23456789')
      expect(screen.getByLabelText('Number')).toHaveValue('23456789')
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
      expect(within(row).getByLabelText('STD code 1')).toHaveValue('0674')
      expect(within(row).getByLabelText('Number')).toHaveValue('2345678')
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
      expect(within(row).getByLabelText('STD code 1')).toHaveValue('0674')
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
      expect(await within(row0).findByLabelText('STD code 1')).toHaveValue('0674')
      expect(within(row0).getByLabelText('Number')).toHaveValue('2345678')

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

      expect(await screen.findByLabelText('Number')).toHaveValue('2345678')
    })

    it("an old record's STD code loads and stays editable even under a district the current dataset maps differently", async () => {
      stubApiHooks()
      render(<Harness jurisdictionStateCode={21} initialMeta={{
        contactNumbers: serializeContactNumbers([
          { type: 'landline', stateNodeId: 'state-odisha', districtNodeId: 'dist-puri', city: 'Not Yet Mapped Town', stdCode: '06752', number: '2345678' },
        ]),
      }} />)

      const stdInput = await screen.findByLabelText('STD code 1')
      expect(stdInput).toHaveValue('06752')

      const user = userEvent.setup()
      await user.clear(stdInput)
      await user.type(stdInput, '06753')
      expect(stdInput).toHaveValue('06753')
    })
  })
})
