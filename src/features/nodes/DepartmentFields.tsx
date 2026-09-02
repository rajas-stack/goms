import { useEffect, useState } from 'react'
import { Field, Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { SALES_ROLES } from './department-meta'
import { parseContactNumbers, serializeContactNumbers, type ContactNumberEntry } from './contact-numbers'
import { citiesForDistrict, stdCodeForCity } from '@/data/std-codes'
import { liveSalesRoster, resolveSalesChain } from '@/data/sales-hierarchy'
import { useChildren, useCurrentPostings, useNode, useSalesPersons, useStateNode, useStates } from '@/lib/api'
import type { Employee } from '@/lib/types'
import type { SalesTier } from '@/data/sales-team'

const DERIVED_SALES_ROLES: { tier: SalesTier; label: string }[] = [
  { tier: 'rm', label: 'RM' },
  { tier: 'gm', label: 'GM' },
  { tier: 'salesHead', label: 'Sales Head' },
]

/** Department-only form controls (short name, head, sales ownership),
 *  rendered by NodeFormDialog when the node being edited is a department.
 *  Everything is stored on the node's metadata so the HierNode shape is
 *  untouched. Works/opportunities are managed separately, from the
 *  department's details view — never inside this form. */
export function DepartmentFields({ meta, setMeta, onShortNameChange, employees, onCreateHead }: {
  meta: Record<string, string>
  setMeta: (updater: (m: Record<string, string>) => Record<string, string>) => void
  /** Short name has its own setter (rather than going through `set` below) so
   *  the parent can tell live auto-fill-from-name apart from a hand-typed
   *  value and stop overwriting once the user has typed one themselves. */
  onShortNameChange: (value: string) => void
  employees: Employee[]
  /** Lets the department-head field create a person who isn't in the system
   *  yet. Undefined while the department itself hasn't been saved (no
   *  org node to attach a new employee to). */
  onCreateHead?: (name: string, designation: string) => Promise<string>
}) {
  const set = (key: string, value: string) => setMeta((m) => ({ ...m, [key]: value }))
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const chain = resolveSalesChain(meta.salesGeo ?? '', liveSalesRoster(salesPersons, currentPostings))

  // --- Contact numbers: State -> District -> City/STD, plus a free-form
  // list of numbers (see contact-numbers.ts for why it's JSON-encoded). ---
  const { data: states = [] } = useStates()
  // `useStates()` returns {code, name} summaries, not real node ids — a
  // state select needs the underlying node id (to feed `useChildren` for its
  // districts), so `stateCode` is tracked locally and resolved to a node via
  // `useStateNode`, mirroring the pattern in StateWorkspace.tsx/HierarchyCanvas.tsx.
  const [stateCode, setStateCode] = useState<number | null>(null)
  // One-time hydration for an existing department: `metadata.contactStateNodeId`
  // already holds a node id, so look that node up directly to recover its
  // code for the <select>'s initial value.
  const { data: hydratedStateNode } = useNode(meta.contactStateNodeId || null)
  useEffect(() => {
    if (stateCode === null && hydratedStateNode?.stateCode != null) setStateCode(hydratedStateNode.stateCode)
  }, [hydratedStateNode, stateCode])
  const { data: pickedStateNode } = useStateNode(stateCode ?? -1)
  useEffect(() => {
    if (pickedStateNode && pickedStateNode.id !== meta.contactStateNodeId) {
      setMeta((m) => ({ ...m, contactStateNodeId: pickedStateNode.id, contactDistrictNodeId: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedStateNode])

  function handleStateSelect(value: string) {
    const code = value ? Number(value) : null
    setStateCode(code)
    if (code === null) setMeta((m) => ({ ...m, contactStateNodeId: '', contactDistrictNodeId: '' }))
  }

  const { data: stateChildren = [] } = useChildren(meta.contactStateNodeId || null)
  const districts = stateChildren.filter((n) => n.typeKey === 'district')
  const selectedDistrict = districts.find((d) => d.id === meta.contactDistrictNodeId)
  // A district HierNode's `code` is its LGD code (matches std-codes.ts's join key).
  const districtLgdCode = selectedDistrict?.code ? Number(selectedDistrict.code) : null
  const seededCities = districtLgdCode != null ? citiesForDistrict(districtLgdCode) : []

  const contactNumbers = parseContactNumbers(meta.contactNumbers)
  function updateContactNumbers(next: ContactNumberEntry[]) {
    setMeta((m) => ({ ...m, contactNumbers: serializeContactNumbers(next) }))
  }
  function addContactNumber() {
    updateContactNumbers([...contactNumbers, { city: '', stdCode: '', number: '' }])
  }
  function removeContactNumber(index: number) {
    updateContactNumbers(contactNumbers.filter((_, i) => i !== index))
  }
  function patchContactNumber(index: number, patch: Partial<ContactNumberEntry>) {
    updateContactNumbers(contactNumbers.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }
  // Auto-populates the STD code only on an actual seed-data match — an
  // unmatched (free-text) city leaves whatever STD code is already there
  // untouched, since it's still hand-editable and a partial retype of a
  // known city shouldn't wipe a value the user already entered.
  function handleCityChange(index: number, city: string) {
    const matched = districtLgdCode != null ? stdCodeForCity(districtLgdCode, city) : undefined
    patchContactNumber(index, matched ? { city, stdCode: matched } : { city })
  }

  return (
    <>
      <Field label="Short name">
        <Input value={meta.shortName ?? ''} onChange={(e) => onShortNameChange(e.target.value)} placeholder="e.g. RDD, NHI, GUDI" />
      </Field>

      <Field
        label="Department head"
        hint={onCreateHead ? undefined : 'Save the department first to add someone new as head.'}
      >
        <EmployeePicker
          candidates={employees}
          value={meta.deptHead ?? ''}
          onChange={(id) => set('deptHead', id)}
          onCreate={onCreateHead}
          createLabel={(name) => `Create new department head “${name}”`}
        />
      </Field>

      <div className="rounded-card border border-line bg-panel/40 p-4">
        <p className="mb-3 text-[13px] font-semibold text-ink-800">Contact numbers</p>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="State">
            <Select value={stateCode ?? ''} onChange={(e) => handleStateSelect(e.target.value)}>
              <option value="">Select a state…</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="District">
            <Select
              value={meta.contactDistrictNodeId ?? ''}
              onChange={(e) => set('contactDistrictNodeId', e.target.value)}
              disabled={!meta.contactStateNodeId}
            >
              <option value="">Select a district…</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-3">
          {contactNumbers.map((c, i) => {
            const invalid = !!c.number && !isValidPhone(c.number, 'mobileOrLandline')
            return (
              <div
                key={i}
                data-testid={`contact-number-row-${i}`}
                className="grid grid-cols-1 gap-3 rounded-lg border border-line/70 p-3 sm:grid-cols-[1.3fr_0.8fr_1.6fr_auto] sm:items-end"
              >
                <Field label={`City/Town ${i + 1}`}>
                  <Input
                    value={c.city}
                    onChange={(e) => handleCityChange(i, e.target.value)}
                    placeholder={seededCities[0]?.city ?? 'e.g. Bhubaneswar'}
                  />
                </Field>
                <Field label={`STD code ${i + 1}`}>
                  <Input
                    value={c.stdCode}
                    onChange={(e) => patchContactNumber(i, { stdCode: e.target.value })}
                    placeholder="e.g. 0674"
                  />
                </Field>
                <Field label={`Number ${i + 1}`}>
                  <PhoneInput
                    mode="mobileOrLandline"
                    value={c.number}
                    onChange={(v) => patchContactNumber(i, { number: v })}
                    invalid={invalid}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove contact number ${i + 1}`}
                  onClick={() => removeContactNumber(i)}
                >
                  <Icon name="X" size={16} />
                </Button>
              </div>
            )
          })}
          <Button type="button" variant="secondary" size="sm" onClick={addContactNumber}>
            + Add Contact Number
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-panel/40 p-4">
        <p className="mb-3 text-[13px] font-semibold text-ink-800">AMNEX sales ownership</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SALES_ROLES.map((r) => (
            <Field key={r.key} label={r.label}>
              <SalesTeamPicker value={meta[r.key] ?? ''} onChange={(email) => set(r.key, email)} />
            </Field>
          ))}
          {DERIVED_SALES_ROLES.map((r) => (
            <Field key={r.tier} label={r.label} hint="Auto-filled from Geo Sales">
              <SalesTeamPicker value={chain[r.tier]?.email ?? ''} onChange={() => {}} disabled />
            </Field>
          ))}
        </div>
      </div>
    </>
  )
}
