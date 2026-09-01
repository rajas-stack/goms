import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { Icon } from '@/components/ui/Icon'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import { useFormDraft } from '@/lib/useFormDraft'
import {
  useEmployeeMutations, useEmployeesByState, useFollowUpMutations, useNode,
  useOwnershipMutations, useResolvedOwners, useSalesPersons,
} from '@/lib/api'
import { isoToday } from '@/data/repository'
import { isValidEmail, uid } from '@/lib/utils'
import { assignOwnerFromEmail } from '@/lib/assignOwnerFromEmail'
import { ManagerPicker } from './ManagerPicker'
import { SalesTeamPicker } from './SalesTeamPicker'
import { extractContact } from './contact-ocr'
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
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'in-person', label: 'In person' },
  { value: 'sms', label: 'SMS' },
]

const EMPTY = {
  name: '', designation: '', email: '', phone: '', company: '', address: '', website: '',
  photoUrl: null as string | null, managerId: '',
  selectedPersonId: '',
  selectedPersonName: '',
  vacant: false,
  connected: true,
  relationshipStatus: 'new' as RelationshipStatus, relationshipQuality: 'neutral' as RelationshipQuality,
  relationshipType: '', introducedBy: '', importantContact: false, preferredComm: [] as PreferredComm[],
  lastInteractionAt: '', followUpDate: '', notes: '',
  relationshipOwner: '',
}

export function EmployeeFormDialog({ open, orgNode, employee, presetManagerId, reporteeMode, onClose, onSaved }: Props) {
  const toast = useToast()
  const { create, update, addTimelineEvent } = useEmployeeMutations()
  const { create: createFollowUp } = useFollowUpMutations()
  const { data: salesPersons = [] } = useSalesPersons()
  const { assign } = useOwnershipMutations()
  // Only the direct owner counts here (item 6's ruling): an `inherited`
  // resolution (e.g. from the department) must NOT be treated as "already
  // owned" — an explicit pick has to create a real direct assignment, not be
  // swallowed as a no-op match against an inherited one. Always called
  // unconditionally (hooks can't be conditional) — `employee` is null for
  // every create path, so `resolvedOwners` is simply empty there and
  // `currentOwnerSalesPersonId` below resolves to `undefined`, which is
  // exactly "no current direct owner".
  const { data: resolvedOwners = {} } = useResolvedOwners('contact', employee ? [employee.id] : [], isoToday())
  const isSaving = create.isPending || update.isPending || addTimelineEvent.isPending
  const { data: employeeOrgNode } = useNode(employee?.orgNodeId ?? null)
  const postingNode = orgNode ?? employeeOrgNode ?? null
  const { data: peers = [] } = useEmployeesByState(postingNode?.stateCode ?? -1)
  const photoRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState(EMPTY)
  // Staged only for the create flow — packaged into a VisitingCardItem on
  // submit. Never touched in edit mode (the section that sets these doesn't
  // render then), so it can never clobber an existing employee's cards.
  const [cardFront, setCardFront] = useState<{ url: string; name: string } | null>(null)
  const [cardBack, setCardBack] = useState<{ url: string; name: string } | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const cardFrontRef = useRef<HTMLInputElement>(null)
  const cardBackRef = useRef<HTMLInputElement>(null)

  // Draft key must pin down which form this is: per-record when editing, and
  // per-posting (plus the reportee flavour) when creating, so an abandoned
  // draft can never resurface in a different person's form.
  const draftKey = employee
    ? `employee:${employee.id}`
    : postingNode ? `employee:new:${postingNode.id}:${reporteeMode ?? 'plain'}` : null

  /** The values this form shows with no draft in play — from the record when
   *  editing, empty when creating. Used both to seed on open and to restore
   *  when the user discards a draft. */
  function seeded() {
    if (employee) {
      return {
        name: employee.name, designation: employee.designation, email: employee.email,
        phone: employee.phone, company: employee.company, address: employee.address, website: employee.website,
        photoUrl: employee.photoUrl, managerId: employee.managerId ?? '',
        vacant: employee.vacant,
        connected: employee.connected,
        relationshipStatus: employee.relationshipStatus, relationshipQuality: employee.relationshipQuality,
        relationshipType: employee.relationshipType, introducedBy: employee.introducedBy,
        importantContact: employee.importantContact, preferredComm: employee.preferredComm,
        lastInteractionAt: employee.lastInteractionAt ?? '', followUpDate: employee.followUpDate ?? '',
        notes: employee.notes,
        relationshipOwner: employee.metadata.relationshipOwner ?? '',
        selectedPersonId: '',
        selectedPersonName: '',
      }
    }
    return { ...EMPTY, managerId: presetManagerId ?? '' }
  }

  const draft = useFormDraft(draftKey, form, open, () => setForm(seeded()))

  useEffect(() => {
    if (!open) return
    const base = seeded()
    setForm(draft.take(base) ?? base)
    setCardFront(null)
    setCardBack(null)
    // `draft`/`seeded` are stable for a given open dialog; re-running on their
    // identity would re-seed the form out from under the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function readImageFileAsDataUrl(file: File, cb: (dataUrl: string) => void) {
    const reader = new FileReader()
    reader.onload = () => cb(String(reader.result))
    reader.readAsDataURL(file)
  }

  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    readImageFileAsDataUrl(file, (dataUrl) => setForm((f) => ({ ...f, photoUrl: dataUrl })))
  }

  function onPhotoPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) readImageFileAsDataUrl(file, (dataUrl) => setForm((f) => ({ ...f, photoUrl: dataUrl })))
        return
      }
    }
  }

  function onCardFile(e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const entry = { url: String(reader.result), name: file.name }
      if (side === 'front') setCardFront(entry)
      else setCardBack(entry)
    }
    reader.readAsDataURL(file)
  }

  async function pickupContact() {
    if (!cardFront || ocrBusy) return
    setOcrBusy(true)
    toast('Reading card…')
    try {
      const urls = [cardFront.url, cardBack?.url].filter((u): u is string => !!u)
      const found = await extractContact(urls)
      const filled = (Object.keys(found) as (keyof typeof found)[]).filter((k) => found[k])
      setForm((f) => ({
        ...f,
        name: f.name || found.name || '',
        designation: f.designation || found.designation || '',
        email: f.email || found.email || '',
        phone: f.phone || found.phone || '',
        company: f.company || found.company || '',
        address: f.address || found.address || '',
        website: f.website || found.website || '',
      }))
      // Previously always claimed success, so a card that yielded nothing
      // still reported "Picked up contact details" while leaving every field
      // untouched — indistinguishable from the feature being broken.
      toast(filled.length > 0
        ? `Picked up ${filled.join(', ')} from the card`
        : 'No contact details found on the card')
    } catch (err) {
      console.error('[add-employee] pickup failed', err)
      toast('Could not read the card — check the image or enter details manually')
    } finally {
      setOcrBusy(false)
    }
  }

  async function createReportee(name: string): Promise<string> {
    if (!postingNode) throw new Error('No posting to attach the new manager to')
    const created = await create.mutateAsync({
      name, designation: reporteeMode === 'manager' ? 'Manager' : 'Junior', email: '', phone: '', orgNodeId: postingNode.id, managerId: null,
    })
    toast(`Created new ${reporteeMode} ${name}`)
    return created.id
  }

  // `Employee.followUpDate` still holds the single date the form and search
  // read; this mirrors it into a real FollowUp record so the new collection
  // is populated going forward. Guarded on the date actually changing so an
  // unrelated edit to the same contact doesn't create a duplicate.
  //
  // DORMANT TODAY: this dialog has no follow-up-date input (it never had one —
  // the field is only ever seeded from the existing record), so `form.followUpDate`
  // always equals `previousDate` here and the guard never passes. Migrated
  // records come from the v3 migration instead. This goes live unchanged as
  // soon as a follow-up input exists; adding one is a visible UI change and
  // Phase 0 is deliberately invisible, so it is not done here.
  async function mirrorFollowUp(contactId: string, previousDate: string | null | undefined) {
    if (form.followUpDate && form.followUpDate !== previousDate) {
      await createFollowUp.mutateAsync({ entityType: 'contact', entityId: contactId, dueDate: form.followUpDate })
    }
  }

  const currentOwnerResolution = employee ? resolvedOwners[employee.id] : undefined
  const currentOwnerSalesPersonId = currentOwnerResolution?.source === 'direct' ? currentOwnerResolution.salesPersonId : undefined

  // Auto-reflects the picked Relationship Owner into a real AMNEX ownership
  // assignment (item 6) — an addition alongside the existing
  // `metadata.relationshipOwner` legacy field above, not a replacement for
  // it. A no-op when the email is blank, unresolvable, or already the
  // current direct owner (Task 1.1's `assignOwnerFromEmail` handles all of
  // that), and it never blocks the employee save even on the rare
  // same-day-collision case (swallowed internally by that helper).
  async function reflectRelationshipOwner(entityId: string) {
    await assignOwnerFromEmail({
      entityType: 'contact',
      entityId,
      email: form.relationshipOwner,
      salesPersons,
      currentOwnerSalesPersonId,
      assignMutateAsync: assign.mutateAsync,
    })
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
        await reflectRelationshipOwner(personId)
        await mirrorFollowUp(personId, employee?.followUpDate)
        onSaved(personId)
      }
      draft.clear()
      onClose()
      return
    }

    const patch = {
      name: form.vacant ? '' : form.name.trim(), designation: form.designation,
      email: form.vacant ? '' : form.email, phone: form.vacant ? '' : form.phone,
      company: form.vacant ? '' : form.company, address: form.vacant ? '' : form.address,
      website: form.vacant ? '' : form.website,
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
      await reflectRelationshipOwner(employee.id)
      if (fillingVacancy) {
        await addTimelineEvent.mutateAsync({
          employeeId: employee.id, type: 'joined',
          title: `Assigned as ${form.designation || 'employee'}`, date: isoToday(), note: '',
        })
        toast(`Assigned ${form.name.trim()} to the position`)
      } else {
        toast(`Updated ${form.name.trim() || 'vacant position'}`)
      }
      await mirrorFollowUp(employee.id, employee.followUpDate)
      onSaved(employee.id)
    } else if (orgNode) {
      const created = await create.mutateAsync({
        ...patch, orgNodeId: orgNode.id,
        visitingCards: cardFront
          ? [{ id: uid('card'), frontUrl: cardFront.url, frontName: cardFront.name, backUrl: cardBack?.url ?? null, backName: cardBack?.name ?? null }]
          : [],
      })
      await reflectRelationshipOwner(created.id)
      toast(form.vacant ? 'Added vacant position' : `Added ${form.name.trim()}`)
      await mirrorFollowUp(created.id, null)
      onSaved(created.id)
    }
    // The record now holds these values, so the draft has nothing left to
    // protect — keeping it would re-restore stale input on the next open.
    draft.clear()
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
          <Button onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit || isSaving}>
            {isSaving
              ? 'Saving…'
              : employee ? 'Save changes' : reporteeMode === 'manager' ? 'Add manager' : reporteeMode === 'junior' ? 'Add junior' : form.vacant ? 'Add position' : 'Add employee'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
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

        {!employee && !reporteeMode && !form.vacant && (
          <Field label="Visiting card" hint="Scan a card to auto-fill the fields below. For best results, upload a clear, well-lit photo of the card.">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => cardFrontRef.current?.click()}>
                  <Icon name="Upload" size={13} /> {cardFront ? 'Replace front' : 'Upload front'}
                </Button>
                {cardFront && (
                  <Button size="sm" onClick={() => cardBackRef.current?.click()}>
                    <Icon name="Upload" size={13} /> {cardBack ? 'Replace back' : 'Add back'}
                  </Button>
                )}
                {cardFront && (
                  <Button size="sm" onClick={pickupContact} disabled={ocrBusy}>
                    <Icon name="Sparkles" size={13} /> {ocrBusy ? 'Reading…' : 'Pick up contact'}
                  </Button>
                )}
              </div>
              {cardFront && (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg border border-line bg-panel/40 px-2.5 py-1 text-[12px] text-ink-700">{cardFront.name}</span>
                  {cardBack && <span className="rounded-lg border border-line bg-panel/40 px-2.5 py-1 text-[12px] text-ink-700">{cardBack.name}</span>}
                </div>
              )}
              <input ref={cardFrontRef} type="file" accept="image/*,application/pdf" onChange={(e) => onCardFile(e, 'front')} className="hidden" />
              <input ref={cardBackRef} type="file" accept="image/*,application/pdf" onChange={(e) => onCardFile(e, 'back')} className="hidden" />
            </div>
          </Field>
        )}

        {!reporteeMode && !form.vacant && (
          <Field label="Profile Picture" hint="Upload, or click here and press Ctrl+V to paste an image.">
            <div className="flex items-center gap-3" tabIndex={0} onPaste={onPhotoPaste}>
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
                  <Icon name="User" size={18} />
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
            <Field label="Contact number" hint="+91 · 10-digit number">
              <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} invalid={!phoneValid} />
              {!phoneValid && <span className="mt-1 block text-xs text-crimson">Enter a valid 10-digit number.</span>}
            </Field>
          )}
          {!reporteeMode && !form.vacant && (
            <Field label="Company" hint="From a visiting card, when this isn't a direct government posting.">
              <Input value={form.company} onChange={set('company')} placeholder="e.g. Acme Systems Pvt Ltd" />
            </Field>
          )}
          {!reporteeMode && !form.vacant && (
            <Field label="Website">
              <Input value={form.website} onChange={set('website')} placeholder="e.g. www.example.com" />
            </Field>
          )}
          {!reporteeMode && !form.vacant && (
            <div className="col-span-full">
              <Field label="Address">
                <Textarea value={form.address} onChange={set('address')} />
              </Field>
            </div>
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

        <div className="rounded-card border border-line bg-panel/40 p-4">
          <p className="mb-3 text-[13px] font-semibold text-ink-800">Amnex details</p>
          <Field label="Relationship Owner / AMNEX Representative" hint="The AMNEX account manager who owns this relationship.">
            <SalesTeamPicker
              value={form.relationshipOwner}
              onChange={(email) => setForm((f) => ({ ...f, relationshipOwner: email }))}
            />
          </Field>
        </div>

        {!form.vacant && (
          <Field label="Connected">
            {/* `min-h-[44px]` per option below `sm`: a bare native radio is
                ~16px, well under a comfortable thumb target — the label
                carries the extra height rather than the control growing. */}
            <div className="flex items-center gap-4" role="radiogroup" aria-label="Connected">
              {([true, false] as const).map((v) => (
                <label key={String(v)} className="flex min-h-[44px] cursor-pointer items-center gap-1.5 pr-2 sm:min-h-0 sm:pr-0">
                  <input
                    type="radio"
                    name="connected"
                    checked={form.connected === v}
                    onChange={() => setForm((f) => ({ ...f, connected: v }))}
                    className="accent-ink-900"
                  />
                  <span className="text-sm text-ink-800">{v ? 'Yes' : 'No'}</span>
                </label>
              ))}
            </div>
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
              {/* Same touch-target reasoning as the Connected radios above. */}
              <div className="flex flex-wrap gap-3">
                {COMMS.map((c) => (
                  <label key={c.value} className="flex min-h-[44px] cursor-pointer items-center gap-1.5 pr-2 sm:min-h-0 sm:pr-0">
                    <input
                      type="checkbox"
                      checked={form.preferredComm.includes(c.value)}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        preferredComm: e.target.checked
                          ? [...f.preferredComm, c.value]
                          : f.preferredComm.filter((v) => v !== c.value),
                      }))}
                      className="accent-ink-900"
                    />
                    <span className="text-sm text-ink-800">{c.label}</span>
                  </label>
                ))}
              </div>
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
            <div className="sm:col-span-2">
              <Field label="Personal notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
