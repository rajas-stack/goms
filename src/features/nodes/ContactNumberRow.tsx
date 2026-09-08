import { useEffect, useState } from 'react'
import { Field, Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { citiesForDistrict, stdCodeForCity } from '@/data/std-codes'
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

/** One contact-number row's own State → Type → (District → City → STD →
 *  Number) reveal flow. Split out from `DepartmentFields.tsx` because each
 *  row now owns its own geography (rows can be in different states/
 *  districts) — resolving a row's own district/city list needs its own
 *  `useChildren` call, and hooks can't be called a variable number of times
 *  inside a `.map()` in the parent; a subcomponent per row is what actually
 *  lets each row hold its own hook calls legally. */
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
  const selectedDistrict = districts.find((d) => d.id === entry.districtNodeId)
  // A district HierNode's `code` is its LGD code (matches std-codes.ts's join key).
  const districtLgdCode = selectedDistrict?.code ? Number(selectedDistrict.code) : null
  const seededCities = districtLgdCode != null ? citiesForDistrict(districtLgdCode) : []

  function handleDistrictSelect(districtNodeId: string) {
    const district = districts.find((d) => d.id === districtNodeId)
    const lgd = district?.code ? Number(district.code) : null
    const seeded = lgd != null ? citiesForDistrict(lgd) : []
    // Only one city ever mapped for this district — nothing to actually
    // choose, so skip straight to it instead of making the user open a
    // dropdown with a single option in it.
    if (seeded.length === 1) {
      onChange({ districtNodeId, city: seeded[0].city, stdCode: seeded[0].stdCode })
    } else {
      onChange({ districtNodeId, city: '', stdCode: '' })
    }
  }

  // City is only ever picked from the STD-code dataset's dropdown (never
  // free-typed) — a match against the currently selected district is
  // guaranteed whenever the picked city came from `seededCities`. An old
  // record's city that predates the current (partial, expandable) dataset
  // is the only case where no match is found; that leaves the STD code as
  // whatever was already stored, still hand-editable.
  function handleCityChange(city: string) {
    const matched = districtLgdCode != null ? stdCodeForCity(districtLgdCode, city) : undefined
    onChange(matched ? { city, stdCode: matched } : { city, stdCode: entry.stdCode })
  }

  // Landline and mobile are different domestic dialing contexts (STD-code
  // dialing vs. +91 international) — switching type clears the
  // type-specific fields rather than reinterpreting stale digits under the
  // new format. State is not cleared: it's asked *before* Type, not
  // downstream of it, so it stays valid across a type change.
  function handleTypeChange(type: ContactNumberType) {
    onChange({ type, districtNodeId: '', city: '', stdCode: '', number: '' })
  }

  function cityOptionsFor(currentCity: string): ComboboxOption[] {
    const seeded = seededCities.map((e) => ({ value: e.city, label: e.city }))
    if (currentCity && !seeded.some((o) => o.value === currentCity)) {
      // An older record's city isn't in the current dataset — surface it
      // anyway so the form doesn't silently blank out a real stored value;
      // picking a different city replaces it normally.
      return [{ value: currentCity, label: currentCity }, ...seeded]
    }
    return seeded
  }

  const phoneMode = entry.type === 'mobile' ? 'mobile' : 'landlineLocal'
  const invalid = !!entry.number && !isValidPhone(entry.number, phoneMode)
  const cityPlaceholder =
    districtLgdCode == null
      ? 'Select a district above first'
      : seededCities.length === 0
        ? 'No cities in the dataset for this district yet'
        : 'Select a city…'

  return (
    <div data-testid={`contact-number-row-${index}`} className="flex flex-wrap items-end gap-3 rounded-lg border border-line/70 p-3">
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

      {entry.type === 'landline' && skipGeography && (
        // Central Ministries has no state/district org node to derive a
        // district-scoped city/STD list from — City stays free text and STD
        // stays hand-entered, exactly as this always worked before the
        // State/District-driven dataset picker existed for real states.
        <>
          <div className="min-w-56 flex-1">
            <Field label={`City/Town ${n}`}>
              <Input value={entry.city} onChange={(e) => onChange({ city: e.target.value })} placeholder="e.g. New Delhi" />
            </Field>
          </div>
          <div className="w-28">
            <Field label={`STD code ${n}`}>
              <Input value={entry.stdCode} onChange={(e) => onChange({ stdCode: e.target.value })} placeholder="e.g. 011" />
            </Field>
          </div>
          <div className="w-40">
            <Field label={`Local number ${n}`}>
              <PhoneInput mode="landlineLocal" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
            </Field>
          </div>
        </>
      )}

      {entry.type === 'landline' && !skipGeography && (
        <>
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

          {entry.districtNodeId && (
            <div className="min-w-56 flex-1">
              <Field label={`City/Town ${n}`}>
                <Combobox
                  value={entry.city}
                  onChange={handleCityChange}
                  options={cityOptionsFor(entry.city)}
                  placeholder={cityPlaceholder}
                />
              </Field>
            </div>
          )}

          {entry.districtNodeId && entry.city && (
            <>
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
                <Field label={`Local number ${n}`}>
                  <PhoneInput mode="landlineLocal" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
                </Field>
              </div>
            </>
          )}
        </>
      )}

      {entry.type === 'mobile' && (
        <div className="min-w-56 flex-1">
          <Field label={`Mobile number ${n}`}>
            <PhoneInput mode="mobile" value={entry.number} onChange={(v) => onChange({ number: v })} invalid={invalid} />
          </Field>
        </div>
      )}

      <Button type="button" variant="ghost" size="icon" aria-label={`Remove contact number ${n}`} onClick={onRemove}>
        <Icon name="X" size={16} />
      </Button>
    </div>
  )
}
