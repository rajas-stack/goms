import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { useEmployeeMutations, useEmployeesByState, useNode } from '@/lib/api'
import { isoToday } from '@/data/repository'
import { isValidEmail } from '@/lib/utils'
import { ManagerPicker } from './ManagerPicker'
import { SalesTeamPicker } from './SalesTeamPicker'
import type {
  Employee, HierNode, PreferredComm, RelationshipQuality, RelationshipStatus,
} from '@/lib/types'

interface Props {
  open: boolean
  orgNode: HierNode | null
  employee: Employee | null
  presetManagerId?: string
  reporteeMode?: 'manager' | 'junior' | null
  onClose: () => void
  onSaved: (id: string) => void
}

const STATUSES: RelationshipStatus[] = ['new', 'developing', 'engaged', 'dormant']
const QUALITIES: RelationshipQuality[] = ['excellent', 'good', 'neutral', 'weak', 'poor']
const COMMS: { value: PreferredComm; label: string }[] = [
  { value: '', label: '—' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'in-person', label: 'In person' },
  { value: 'sms', label: 'SMS' },
]

const EMPTY = {
  name: '', designation: '', email: '', phone: '', photoUrl: null as string | null, managerId: '',
  selectedPersonId: '',
  selectedPersonName: '',
  vacant: false,
  connected: true,
  relationshipStatus: 'new' as RelationshipStatus, relationshipQuality: 'neutral' as RelationshipQuality,
  relationshipType: '', introducedBy: '', importantContact: false, preferredComm: '' as PreferredComm,
  lastInteractionAt: '', followUpDate: '', notes: '',
  relationshipOwner: '',
}

export function EmployeeFormDialog({ open, orgNode, employee, presetManagerId, reporteeMode, onClose, onSaved }: Props) {
  const toast = useToast()
  const { create, update, addTimelineEvent } = useEmployeeMutations()
  const { data: employeeOrgNode } = useNode(employee?.orgNodeId ?? null)
  const postingNode = orgNode ?? employeeOrgNode ?? null
  const { data: peers = [] } = useEmployeesByState(postingNode?.stateCode ?? -1)
  const photoRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (!open) return
    if (employee) {
      setForm({
        name: employee.name, designation: employee.designation, email: employee.email,
        phone: employee.phone, photoUrl: employee.photoUrl, managerId: employee.managerId ?? '',
        vacant: employee.vacant,
        connected: employee.connected,
        relationshipStatus: employee.relationshipStatus, relationshipQuality: employee.relationshipQuality,
        relationshipType: employee.relationshipType, introducedBy: employee.introducedBy,
        importantContact: employee.importantContact, preferredComm: employee.preferredComm,
        lastInteractionAt: employee.lastInteractionAt ?? '', followUpDate: employee.followUpDate ?? '',
        notes: employee.notes,
        relationshipOwner: employee.metadata.relationshipOwner ?? '',
      })
    } else {
      setForm({ ...EMPTY, managerId: presetManagerId ?? '' })
    }
  }, [open, employee, presetManagerId])

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const managerChoices = peers.filter((p) => p.id !== employee?.id && !p.vacant)
  // Contact-field validity (only enforced for a filled — non-vacant — record).
  const emailValid = form.vacant || isValidEmail(form.email)
  const phoneValid = form.vacant || isValidPhone(form.phone)
  // A vacant seat only needs a title; a filled record needs a name + valid contacts.
  const canSubmit = reporteeMode
    ? (form.vacant ? !!form.designation.trim() : (!!form.selectedPersonId || !!form.selectedPersonName.trim()) && !!form.designation.trim())
    : (form.vacant ? !!form.designation.trim() : !!form.name.trim() && emailValid && phoneValid)
  const wasVacant = !!employee?.vacant
  const fillingVacancy = wasVacant && !form.vacant

  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, photoUrl: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  async function createReportee(name: string): Promise<string> {
    if (!postingNode) throw new Error('No posting to attach the new manager to')
    const created = await create.mutateAsync({
      name, designation: reporteeMode === 'manager' ? 'Manager' : 'Junior', email: '', phone: '', orgNodeId: postingNode.id, managerId: null,
    })
    toast(`Created new ${reporteeMode} ${name}`)
    return created.id
  }

  async function submit() {
    if (!canSubmit) return

    if (reporteeMode) {
      if (form.vacant) {
        if (!orgNode) return
        const created = await create.mutateAsync({
          name: '', designation: form.designation.trim(), email: '', phone: '',
          vacant: true, orgNodeId: orgNode.id, managerId: null,
        })
        onSaved(created.id)
      } else {
        const personId = form.selectedPersonId || await createReportee(form.selectedPersonName.trim())
        if (!personId) return
        await update.mutateAsync({
          id: personId,
          patch: { 
            designation: form.designation.trim(), 
            vacant: false,
            connected: form.connected,
            relationshipStatus: form.relationshipStatus, 
            relationshipQuality: form.relationshipQuality,
            relationshipType: form.relationshipType, 
            introducedBy: form.introducedBy,
            importantContact: form.importantContact, 
            preferredComm: form.preferredComm,
            lastInteractionAt: form.lastInteractionAt || null, 
            followUpDate: form.followUpDate || null,
            notes: form.notes,
            metadata: { ...(employee?.metadata ?? {}), relationshipOwner: form.relationshipOwner },
          },
        })
        onSaved(personId)
      }
      onClose()
      return
    }

    const patch = {
      name: form.vacant ? '' : form.name.trim(), designation: form.designation,
      email: form.vacant ? '' : form.email, phone: form.vacant ? '' : form.phone,
      photoUrl: form.vacant ? null : form.photoUrl,
      managerId: form.managerId || null,
      vacant: form.vacant,
      connected: form.vacant ? false : form.connected,
      relationshipStatus: form.relationshipStatus, relationshipQuality: form.relationshipQuality,
      relationshipType: form.relationshipType, introducedBy: form.introducedBy,
      importantContact: form.importantContact, preferredComm: form.preferredComm,
      lastInteractionAt: form.lastInteractionAt || null, followUpDate: form.followUpDate || null,
      notes: form.notes,
      metadata: { ...(employee?.metadata ?? {}), relationshipOwner: form.relationshipOwner },
    }
    if (employee) {
      await update.mutateAsync({ id: employee.id, patch })
      if (fillingVacancy) {
        await addTimelineEvent.mutateAsync({
          employeeId: employee.id, type: 'joined',
          title: `Assigned as ${form.designation || 'employee'}`, date: isoToday(), note: '',
        })
        toast(`Assigned ${form.name.trim()} to the position`)
      } else {
        toast(`Updated ${form.name.trim() || 'vacant position'}`)
      }
      onSaved(employee.id)
    } else if (orgNode) {
      const created = await create.mutateAsync({ ...patch, orgNodeId: orgNode.id })
      toast(form.vacant ? 'Added vacant position' : `Added ${form.name.trim()}`)
      onSaved(created.id)
    }
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={employee ? (wasVacant ? 'Assign / edit position' : 'Edit employee') : reporteeMode === 'manager' ? 'Add Reporting Manager' : reporteeMode === 'junior' ? 'Add Junior' : 'Add employee'}
      description={orgNode ? `Posting: ${orgNode.name}` : employee?.designation}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {employee ? 'Save changes' : reporteeMode === 'manager' ? 'Add manager' : reporteeMode === 'junior' ? 'Add junior' : form.vacant ? 'Add position' : 'Add employee'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Position status">
          <label className="flex h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3">
            <input
              type="checkbox"
              checked={form.vacant}
              onChange={(e) => setForm((f) => ({ ...f, vacant: e.target.checked }))}
              className="accent-amber"
            />
            <span className="text-sm text-ink-800">Vacant position (no incumbent yet)</span>
          </label>
        </Field>

        {!reporteeMode && !form.vacant && (
          <Field label="Profile Picture">
            <div className="flex items-center gap-3">
              {form.photoUrl ? (
                <span className="relative">
                  <img src={form.photoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, photoUrl: null }))}
                    aria-label="Remove profile picture"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm hover:text-crimson"
                  >
                    <Icon name="X" size={11} />
                  </button>
                </span>
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-panel text-muted">
                  <Icon name="Camera" size={18} />
                </span>
              )}
              <Button size="sm" onClick={() => photoRef.current?.click()}>
                <Icon name="Upload" size={13} /> Upload
              </Button>
              <input ref={photoRef} type="file" accept="image/*" onChange={onPhotoFile} className="hidden" />
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {reporteeMode && !form.vacant && (
            <div className="col-span-full">
              <Field label={reporteeMode === 'manager' ? 'Reporting Manager Name' : 'Junior Name'}>
                <ManagerPicker
                  candidates={managerChoices}
                  value={form.selectedPersonId}
                  onChange={(id) => {
                    const p = peers.find((c) => c.id === id)
                    setForm((f) => ({ ...f, selectedPersonId: id, selectedPersonName: '', designation: p ? p.designation : f.designation }))
                  }}
                  onQueryChange={(q) => setForm((f) => ({ ...f, selectedPersonName: q }))}
                  onCreate={createReportee}
                  placeholder={`Search or type a new ${reporteeMode}'s name…`}
                  createLabel={(name) => `Create new ${reporteeMode} “${name}”`}
                />
              </Field>
            </div>
          )}
          {!reporteeMode && !form.vacant && <Field label="Full name"><Input value={form.name} onChange={set('name')} autoFocus /></Field>}
          <Field label={form.vacant ? 'Position title' : 'Designation'}>
            <Input value={form.designation} onChange={set('designation')} placeholder="e.g. Deputy Director" autoFocus={form.vacant} />
          </Field>
          {!reporteeMode && !form.vacant && (
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={set('email')}
                aria-invalid={!emailValid}
                className={emailValid ? '' : 'border-crimson focus:border-crimson'}
              />
              {!emailValid && <span className="mt-1 block text-xs text-crimson">Enter a valid email address.</span>}
            </Field>
          )}
          {!reporteeMode && !form.vacant && (
            <Field label="Contact number" hint="+91 · 2-digit area code · 8-digit number">
              <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} invalid={!phoneValid} />
              {!phoneValid && <span className="mt-1 block text-xs text-crimson">Enter a 2-digit area code and an 8-digit number.</span>}
            </Field>
          )}
        </div>

        {!reporteeMode && (
          <Field label="Reporting manager" hint="Search an existing person, or type a new name to create one.">
            <ManagerPicker
              candidates={managerChoices}
              value={form.managerId}
              onChange={(id) => setForm((f) => ({ ...f, managerId: id }))}
              onCreate={createReportee}
            />
          </Field>
        )}

        <Field label="Relationship Owner / AMNEX Representative" hint="The AMNEX account manager who owns this relationship.">
          <SalesTeamPicker
            value={form.relationshipOwner}
            onChange={(email) => setForm((f) => ({ ...f, relationshipOwner: email }))}
          />
        </Field>

        {!form.vacant && (
          <Field label="Connected">
            <label className="flex h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3">
              <input
                type="checkbox"
                checked={form.connected}
                onChange={(e) => setForm((f) => ({ ...f, connected: e.target.checked }))}
                className="accent-ink-900"
              />
              <span className="text-sm text-ink-800">Tracked as a relationship contact</span>
            </label>
          </Field>
        )}

        {!form.vacant && (
          <div className="grid grid-cols-1 gap-4 rounded-card border border-line bg-panel/40 p-4 sm:grid-cols-2">
            {form.connected && (
              <>
                <Field label="Relationship quality">
                  <Select value={form.relationshipQuality} onChange={set('relationshipQuality')}>
                    {QUALITIES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                  </Select>
                </Field>
                <Field label="Relationship status">
                  <Select value={form.relationshipStatus} onChange={set('relationshipStatus')}>
                    {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                  </Select>
                </Field>
                <Field label="Relationship type">
                  <Input value={form.relationshipType} onChange={set('relationshipType')} placeholder="e.g. Counterpart, Mentor" />
                </Field>
                <Field label="Introduced by">
                  <Input value={form.introducedBy} onChange={set('introducedBy')} />
                </Field>
              </>
            )}
            <Field label="Preferred communication">
              <Select value={form.preferredComm} onChange={set('preferredComm')}>
                {COMMS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Important contact">
              <label className="flex h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3">
                <input
                  type="checkbox"
                  checked={form.importantContact}
                  onChange={(e) => setForm((f) => ({ ...f, importantContact: e.target.checked }))}
                  className="accent-amber"
                />
                <span className="text-sm text-ink-800">High-priority</span>
              </label>
            </Field>
            <Field label="Last interaction"><Input type="date" value={form.lastInteractionAt} onChange={set('lastInteractionAt')} /></Field>
            <Field label="Next follow-up"><Input type="date" value={form.followUpDate} onChange={set('followUpDate')} /></Field>
            <div className="sm:col-span-2">
              <Field label="Personal notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
