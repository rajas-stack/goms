import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/components/ui/Toast'
import { ContactFields, isContactParty, type ContactDraft } from '@/features/communication/ContactFields'
import { useContactMutations } from '@/features/communication/api'
import { useWorkspace } from '@/features/workspace/context'
import { useOrgPersonMutations } from '@/lib/api'
import { normalizeEmail } from '@/lib/inputNormalization'
import type { CategoryOption } from './directoryEntries'

/** New people start at this level; Employee Master moves them (same default as "Add to employees" there). */
const DEFAULT_LEVEL = 4
const INTERNAL = 'internal'

/** One form for every person: pick what they are (Amnex employee, Departmental, OEM, Competitor, …) and the form asks
 *  for what that category needs — an Amnex department, or the company from that category's own list.
 *  An Amnex employee is created without an email: the email gives sign-in and a role, so it stays a System Admin
 *  change in Employee Master. Nothing here creates an account or grants a role. */
export function NewContactDialog({ initialCategory, internalLabel, internalOptions, externalOptions, canInternal, canExternal, onClose }: {
  /** 'internal' or an external category (contact party); '' picks the first one the user may create. */
  initialCategory: string
  internalLabel: string
  internalOptions: CategoryOption[]
  externalOptions: CategoryOption[]
  canInternal: boolean
  canExternal: boolean
  onClose: () => void
}) {
  const ws = useWorkspace()
  const toast = useToast()
  const org = useOrgPersonMutations()
  const contacts = useContactMutations()
  const categories = [...(canInternal ? [{ value: INTERNAL, label: internalLabel }] : []), ...(canExternal ? externalOptions : [])]
  const [category, setCategory] = useState(categories.some((c) => c.value === initialCategory) ? initialCategory : categories[0]?.value ?? '')
  const [department, setDepartment] = useState(internalOptions[0]?.value ?? '')
  const [name, setName] = useState('')
  const [designation, setDesignation] = useState('')
  const [contact, setContact] = useState<ContactDraft>({ name: '', email: '', organization: '', departmentId: null, party: 'external' })
  const [error, setError] = useState<string | null>(null)
  const pending = org.create.isPending || contacts.create.isPending
  const internal = category === INTERNAL

  const chooseCategory = (next: string) => { setCategory(next); setContact((c) => ({ ...c, organization: '', departmentId: null })) } // a company of another category never carries over

  const save = async () => {
    setError(null)
    try {
      if (internal) {
        if (!name.trim()) { setError('Name is required.'); return }
        const created = await org.create.mutateAsync({ name: name.trim(), designation: designation.trim(), level: DEFAULT_LEVEL, departments: department ? [department] : [], managerId: null })
        toast(`Added ${created.name}`)
        ws.select('orgPerson', created.id)
      } else {
        const email = normalizeEmail(contact.email, true)
        if (!email.includes('@')) { setError('Enter the contact’s email address.'); return }
        if (!contact.name.trim()) { setError('Name is required.'); return }
        if (!isContactParty(category)) { setError('Choose a category.'); return }
        if (!contact.organization.trim()) { setError('Choose their company.'); return }
        if (category === 'clientDepartment' && !contact.departmentId) { setError('Choose the client department.'); return }
        const created = await contacts.create.mutateAsync({ email, name: contact.name.trim(), party: category, organization: contact.organization.trim(), departmentId: category === 'clientDepartment' ? contact.departmentId : null })
        toast(`Added ${created.name}`)
        ws.select('contact', created.id)
      }
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this contact.') }
  }

  return (
    <Dialog
      open onClose={onClose} title="New contact"
      footer={<>
        <IconButton icon="X" label="Cancel" variant="secondary" onClick={onClose} />
        <IconButton icon="Check" label={pending ? 'Adding…' : 'Add contact'} variant="primary" disabled={pending || !category} onClick={() => void save()} />
      </>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Category">
            <Select aria-label="New contact category" value={category} onChange={(e) => chooseCategory(e.target.value)}>
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
        {internal ? <>
          <Field label="Full name" required><Input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Designation"><Input aria-label="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} /></Field>
          <Field label="Department">
            <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {internalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <p className="self-end text-[11px] text-muted">
            Starts at L{DEFAULT_LEVEL}, no manager, no email — set those in <Link to="/settings/masters/employees" className="underline">Employee Master</Link>.
          </p>
        </> : isContactParty(category) && (
          <div className="grid gap-3 sm:col-span-2">
            <ContactFields isNew showCategory={false} value={{ ...contact, party: category }} onChange={setContact} />
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
    </Dialog>
  )
}
