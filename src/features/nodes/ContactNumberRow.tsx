import { useEffect, useMemo, useState } from 'react'
import { Field, Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { Icon } from '@/components/ui/Icon'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { citiesForDistrict, citiesInState, stdCodeForCity } from '@/data/std-codes'
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
 *  City/Town's shape depends on how many cities the STD dataset
 *  (`std-codes.ts`) maps to the selected district — see `handleDistrictSelect`:
 *    - 0 mapped cities: free-text City input, free-text STD input. Never
 *      blocks entry — the dataset is a lookup aid, not a whitelist, so a
 *      district it hasn't reached yet just means hand entry, not an error.
 *    - 1 mapped city: unambiguous, so City and STD both auto-fill (still
 *      hand-editable — nothing here is locked, since the partial dataset
 *      can itself be wrong for a given row).
 *    - 2+ mapped cities: City becomes a searchable Combobox scoped to
 *      *this district's own* dataset rows only (never another district's
 *      same-named city — the option list is always `citiesForDistrict(lgd)`
 *      for the currently selected district), so picking one is unambiguous
 *      and always resolves via `stdCodeForCity` to auto-fill STD. */
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

  // Picking a district still auto-fills City/STD when the dataset maps
  // exactly one city to it (nothing to actually choose, so no reason to make
  // the user look it up/type it by hand) — but never requires a city to
  // exist in the dataset at all: the STD-code dataset is a lookup aid, not a
  // whitelist, so any other case (zero or multiple mapped cities) just
  // leaves City/STD blank and freely hand-editable rather than blocking
  // anything.
  function handleDistrictSelect(districtNodeId: string) {
    const district = districts.find((d) => d.id === districtNodeId)
    const lgd = district?.code ? Number(district.code) : null
    const seeded = lgd != null ? citiesForDistrict(lgd) : []
    const city = seeded.length === 1 ? seeded[0].city : ''
    onChange({ districtNodeId, city, stdCode: seeded.length === 1 ? seeded[0].stdCode : '' })
  }

  const districtLgd = (() => {
    const district = districts.find((d) => d.id === entry.districtNodeId)
    return district?.code ? Number(district.code) : null
  })()
  const districtCities = districtLgd != null ? citiesForDistrict(districtLgd) : []

  // City-first search (Approach A): a second, parallel entry point into the
  // same District/City/STD fields above — for a user who knows the city
  // ("Bhubaneswar") but not its administrative district ("Khordha"). Scoped
  // to this row's own State, and further filtered to LGD codes that
  // actually resolve to a real district node under it, so a dataset row
  // whose districtLgdCode doesn't match any real district here never
  // surfaces as a pickable (and unresolvable) option. Grouped by exact city
  // text: a name that's unambiguous within this state shows plainly; one
  // that legitimately recurs across two of this state's districts (real,
  // if rare, in the seeded dataset — e.g. Maharashtra's "Karjat") shows each
  // candidate labeled by its own district, so picking is still one
  // unambiguous action rather than a guess.
  const stateName = states.find((s) => s.code === rowStateCode)?.name
  const realDistrictLgds = new Set(districts.map((d) => Number(d.code)))
  const cityOptions: ComboboxOption[] = useMemo(() => {
    const candidates = (stateName ? citiesInState(stateName) : []).filter((e) => realDistrictLgds.has(e.districtLgdCode))
    const countByCity = new Map<string, number>()
    for (const c of candidates) countByCity.set(c.city, (countByCity.get(c.city) ?? 0) + 1)
    return candidates.map((c) => ({
      value: `${c.districtLgdCode}::${c.city}`,
      label: (countByCity.get(c.city) ?? 0) > 1 ? `${c.city} — ${c.district} district` : c.city,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateName, districts])
  const [citySearchValue, setCitySearchValue] = useState('')

  function handleCitySearchSelect(value: string) {
    const sep = value.indexOf('::')
    const lgd = Number(value.slice(0, sep))
    const city = value.slice(sep + 2)
    const district = districts.find((d) => Number(d.code) === lgd)
    if (!district) return
    onChange({ districtNodeId: district.id, city, stdCode: stdCodeForCity(lgd, city) ?? '' })
    setCitySearchValue('')
  }

  // Typing/picking a city that matches this district's dataset entry
  // auto-fills STD (the whole point of Requirement 1) — an unmatched city
  // (not in the partial dataset) simply leaves STD as-is for hand entry,
  // never blocking or guessing.
  function handleCityChange(city: string) {
    const matched = districtLgd != null ? stdCodeForCity(districtLgd, city) : undefined
    onChange(matched ? { city, stdCode: matched } : { city })
  }

  // Landline and mobile are different domestic dialing contexts (STD-code
  // dialing vs. +91 international) — switching type clears the
  // type-specific fields rather than reinterpreting stale digits under the
  // new format. State is not cleared: it's asked *before* Type, not
  // downstream of it, so it stays valid across a type change.
  function handleTypeChange(type: ContactNumberType) {
    onChange({ type, districtNodeId: '', city: '', stdCode: '', number: '' })
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
          <div className="w-52">
            <Field label={`Search city ${n}`} hint="Optional — resolves District & STD">
              <Combobox
                value={citySearchValue}
                onChange={handleCitySearchSelect}
                options={cityOptions}
                placeholder="Search a city…"
                aria-label={`Search city ${n}`}
              />
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
          <div className="w-44">
            <Field label={`City/Town ${n}`}>
              {districtCities.length > 1 ? (
                <Combobox
                  value={entry.city}
                  onChange={handleCityChange}
                  options={districtCities.map((c) => ({ value: c.city, label: c.city }))}
                  placeholder="Select a city…"
                  aria-label={`City/Town ${n}`}
                />
              ) : (
                <Input
                  value={entry.city}
                  onChange={(e) => handleCityChange(e.target.value)}
                  placeholder="e.g. Bhubaneswar"
                />
              )}
            </Field>
          </div>
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
