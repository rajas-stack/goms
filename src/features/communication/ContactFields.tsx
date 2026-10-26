import { COMMUNICATION_PARTY_LABELS, CONTACT_PARTIES, type CommunicationContact, type ContactParty } from '@goms/domain'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input, Select } from '@/components/ui/Field'
import { useCompetitorMutations, useCompetitors } from '@/features/competitors/api'
import { useClientDepartmentOptions } from '@/features/masters/useMasterOptions'
import { useMasterMutations, useMasters } from '@/modules/commercial-calculator/api'
import { useAllowed } from '@/lib/permissions'

export type ContactDraft = Pick<CommunicationContact, 'name' | 'email' | 'organization' | 'departmentId'> & { party: ContactParty }
type Company = Pick<ContactDraft, 'organization' | 'departmentId'>

export const isContactParty = (party: string): party is ContactParty => (CONTACT_PARTIES as readonly string[]).includes(party)

/** Fields of one address-book contact (Settings › Masters › Email Contacts and the Directory). The email is the contact's
 *  identity, so it is only typed when the contact is new. The category decides where the company comes from. */
export function ContactFields({ value, onChange, isNew = false, showCategory = true, parties = CONTACT_PARTIES, partyLabel }: {
  value: ContactDraft
  onChange: (next: ContactDraft) => void
  isNew?: boolean
  /** False when the caller already offers the category (the Directory's New contact). */
  showCategory?: boolean
  parties?: readonly ContactParty[]
  partyLabel?: (party: ContactParty) => string
}) {
  return <>
    <Field label="Email" required={isNew}><Input type="email" aria-label="Email" required={isNew} readOnly={!isNew} value={value.email} onChange={event => onChange({ ...value, email: event.target.value })} /></Field>
    <Field label="Name" required><Input aria-label="Name" required value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} /></Field>
    {showCategory && <Field label="Category"><Select aria-label="Category" value={value.party} onChange={event => onChange({ ...value, party: event.target.value as ContactParty, organization: '', departmentId: null })}>{parties.map(party => <option key={party} value={party}>{partyLabel?.(party) ?? COMMUNICATION_PARTY_LABELS[party]}</option>)}</Select></Field>}
    <CompanyField party={value.party} value={value} onChange={company => onChange({ ...value, ...company })} />
  </>
}

/** Where a contact of each category works, picked from the list that already names those companies:
 *  Departmental → a client department (Account Mapping), Competitor → Settings › Competitors,
 *  OEM / Consortium partner → Settings › Masters › OEM Companies / Consortium Partners. Anything else is typed.
 *  A company missing from its list can be added from here; it then exists for everyone.
 *  shortcut: the contact stores the company NAME (communication_contacts.organization), so renaming a company in its list does not rename it here; store its id if renames become common. */
export function CompanyField({ party, value, onChange }: { party: ContactParty; value: Company; onChange: (next: Company) => void }) {
  if (party === 'clientDepartment') return <DepartmentCompany value={value} onChange={onChange} />
  if (party === 'competitor') return <CompetitorCompany value={value} onChange={onChange} />
  if (party === 'oem') return <MasterCompany masterKey="oemCompanies" label="OEM company" value={value} onChange={onChange} />
  if (party === 'consortium') return <MasterCompany masterKey="consortiumPartners" label="Consortium partner company" value={value} onChange={onChange} />
  return <Field label="Organization" required><Input aria-label="Organization" required value={value.organization} onChange={event => onChange({ organization: event.target.value, departmentId: null })} /></Field>
}

/** A contact saved before its company was listed (or after it was retired) still shows that company. */
const withCurrent = (names: string[], current: string) =>
  (current && !names.includes(current) ? [current, ...names] : names).map(n => ({ value: n, label: n }))

function DepartmentCompany({ value, onChange }: { value: Company; onChange: (next: Company) => void }) {
  const { data: departments = [] } = useClientDepartmentOptions()
  return (
    <Field label="Client department" required>
      <Combobox
        aria-label="Client department" value={value.departmentId ?? ''} placeholder="Choose a department"
        options={departments.map(d => ({ value: d.id, label: d.name }))}
        onChange={id => onChange({ departmentId: id || null, organization: departments.find(d => d.id === id)?.name ?? '' })}
      />
    </Field>
  )
}

function CompetitorCompany({ value, onChange }: { value: Company; onChange: (next: Company) => void }) {
  const { data: competitors = [] } = useCompetitors()
  const { create } = useCompetitorMutations()
  const canAdd = useAllowed('bid.columns', 'create') // same right as Settings › Competitors › Add
  return (
    <Field label="Competitor company" required>
      <Combobox
        aria-label="Competitor company" value={value.organization} placeholder="Choose or type a competitor"
        options={withCurrent(competitors.map(c => c.name), value.organization)}
        onChange={name => onChange({ organization: name, departmentId: null })}
        onCreate={canAdd ? async name => (await create.mutateAsync({ name })).name : undefined}
      />
    </Field>
  )
}

function MasterCompany({ masterKey, label, value, onChange }: { masterKey: 'oemCompanies' | 'consortiumPartners'; label: string; value: Company; onChange: (next: Company) => void }) {
  const { data: rows = [] } = useMasters(masterKey)
  const { create } = useMasterMutations(masterKey)
  const canAdd = useAllowed('am.contacts', 'create')
  const options = withCurrent(rows.filter(r => r.active).map(r => r.name), value.organization)
  return (
    <Field label={label} required>
      <Combobox
        aria-label={label} value={value.organization} placeholder={`Choose or type ${label.toLowerCase()}`} options={options}
        onChange={name => onChange({ organization: name, departmentId: null })}
        onCreate={canAdd ? async name => (await create.mutateAsync({ code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company', name, description: '' })).name : undefined}
      />
    </Field>
  )
}
