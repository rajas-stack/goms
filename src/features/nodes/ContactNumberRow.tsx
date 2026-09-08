import { useEffect, useState } from 'react'
import { Field, Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { citiesForDistrict } from '@/data/std-codes'
import { useChildren, useNode, useStateNode } from '@/lib/api'
import type { ContactNumberEntry, ContactNumberType } from './contact-numbers'

interface Props {
  index: number
  entry: ContactNumberEntry
  states: { code: number; name: string }[]
  /** A Central Ministries department isn't seated in any one real
   *  state/district, so its contact numbers skip State/District entirely
   *  (straight to Type) rather than asking for a choice that doesn't apply —
   *  mirrors `jurisdictionStateCode === CENTRAL_STATE_CODE` in DepartmentFields.tsx. */
  skipGeography: boolean
  onChange: (patch: Partial<ContactNumberEntry>) => void
  onRemove: () => void
}

/** One contact-number row's own State → Type → (District → STD → Number)
 *  reveal flow. Split out from `DepartmentFields.tsx` because each row now
 *  owns its own geography (rows can be in different states/districts) —
 *  resolving a row's own district list needs its own `useChildren` call, and
 *  hooks can't be called a variable number of times inside a `.map()` in the
 *  parent; a subcomponent per row is what actually lets each row hold its
 *  own hook calls legally.
 *
 *  There is deliberately no City/Town field: the STD-code dataset
 *  (`std-codes.ts`) is a lookup aid, not a whitelist of valid cities, so a
 *  district with no (or several) mapped cities never blocks the STD/Local
 *  number fields — STD auto-fills only for the unambiguous one-city case
 *  (see `handleDistrictSelect` below) and stays hand-editable otherwise. */
export function ContactNumberRow({ index, entry, states, skipGeography, onChange, onRemove }: Props) {
  const n = index + 1

  // Resolve this row's own state's numeric code (for the <select>'s value)
  // from its stored node id — mirrors the department-jurisdiction lookup in
  // DepartmentFields.tsx, just scoped to this one row.
  const { data: rowStateNode } = useNode(entry.stateNodeId || null)
  const rowStateCode = rowStateNode?.stateCode ?? null

  // `useStates()` (in the parent) returns {code, name} summaries, not real
  // node ids — a state pick needs the underlying node id (to feed
  // `useChildren` for its districts), so the just-picked code is tracked
  // locally and resolved to a node via `useStateNode`, same pattern
  // DepartmentFields.tsx used before this row became independent.
  const [pendingStateCode, setPendingStateCode] = useState<number | null>(null)
  const { data: pickedStateNode } = useStateNode(pendingStateCode ?? -1)
  useEffect(() => {
    if (pickedStateNode && pickedStateNode.id !== entry.stateNodeId) {
      // A new State invalidates everything downstream of it.
      onChange({ stateNodeId: pickedStateNode.id, type: '', districtNodeId: '', city: '', stdCode: '', number: '' })
      setPendingStateCode(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedStateNode])

  function handleStateSelect(value: string) {
    setPendingStateCode(value ? Number(value) : null)
  }

  const { data: stateChildren = [] } = useChildren(entry.stateNodeId || null)
  const districts = stateChildren.filter((c) => c.typeKey === 'district')

  // Picking a district still auto-fills STD when the dataset maps exactly
  // one city to it (nothing to actually choose, so no reason to make the
  // user look it up/type it by hand) — but never requires a city to exist
  // in the dataset at all: the STD-code dataset is a lookup aid, not a
  // whitelist, so any other case (zero or multiple mapped cities) just
  // leaves STD blank and freely hand-editable rather than blocking anything.
  function handleDistrictSelect(districtNodeId: string) {
    const district = districts.find((d) => d.id === districtNodeId)
    const lgd = district?.code ? Number(district.code) : null
    const seeded = lgd != null ? citiesForDistrict(lgd) : []
    onChange({ districtNodeId, stdCode: seeded.length === 1 ? seeded[0].stdCode : '' })
  }

  // Landline and mobile are different domestic dialing contexts (STD-code
  // dialing vs. +91 international) — switching type clears the
  // type-specific fields rather than reinterpreting stale digits under the
  // new format. State is not cleared: it's asked *before* Type, not
  // downstream of it, so it stays valid across a type change.
  function handleTypeChange(type: ContactNumberType) {
    onChange({ type, districtNodeId: '', stdCode: '', number: '' })
  }

  const phoneMode = entry.type === 'mobile' ? 'mobile' : 'landlineLocal'
  const invalid = !!entry.number && !isValidPhone(entry.number, phoneMode)

  return (
    <div data-testid={`contact-number-row-${index}`} className="flex flex-col gap-3 rounded-lg border border-line/70 p-3">
      <div className="flex flex-wrap items-end gap-3">
        {!skipGeography && (
          <div className="w-40">
            <Field label={`State ${n}`}>
              <Select value={rowStateCode ?? ''} onChange={(e) => handleStateSelect(e.target.value)}>
                <option value="">Select a state…</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {(skipGeography || entry.stateNodeId) && (
          <div className="w-44">
            <Field label={`Type ${n}`}>
              <Select value={entry.type} onChange={(e) => handleTypeChange(e.target.value as ContactNumberType)}>
                <option value="">Select a type…</option>
                <option value="landline">Landline / EPBX</option>
                <option value="mobile">Mobile</option>
              </Select>
            </Field>
          </div>
        )}

        {entry.type === 'landline' && !skipGeography && (
          <div className="w-44">
            <Field label={`District ${n}`}>
              <Select value={entry.districtNodeId} onChange={(e) => handleDistrictSelect(e.target.value)}>
                <option value="">Select a district…</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Button type="button" variant="ghost" size="icon" aria-label={`Remove contact number ${n}`} onClick={onRemove}>
          <Icon name="X" size={16} />
        </Button>
      </div>

      {entry.type === 'landline' && skipGeography && (
        // Central Ministries has no state/district org node to derive a
        // district-scoped STD list from — STD stays hand-entered, exactly as
        // this always worked before the State/District dataset lookup
        // existed for real states.
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field label={`STD code ${n}`}>
              <Input value={entry.stdCode} onChange={(e) => onChange({ stdCode: e.target.value })} placeholder="e.g. 011" />
            </Field>
          </div>
          <div className="w-40">
            <Field label={`Number ${n}`}>
              <PhoneInput mode="landlineLocal" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
            </Field>
          </div>
        </div>
      )}

      {entry.type === 'landline' && !skipGeography && entry.districtNodeId && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field label={`STD code ${n}`}>
              <Input
                value={entry.stdCode}
                onChange={(e) => onChange({ stdCode: e.target.value })}
                placeholder="e.g. 0674"
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label={`Number ${n}`}>
              <PhoneInput mode="landlineLocal" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
            </Field>
          </div>
        </div>
      )}

      {entry.type === 'mobile' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label={`Mobile number ${n}`}>
              <PhoneInput mode="mobile" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}
