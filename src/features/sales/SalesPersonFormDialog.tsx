import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useCurrentPostings, useSalesPersonMutations, useSalesPersons } from '@/lib/api'
import { SALES_TIERS } from '@/data/sales-tiers'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { liveSalesRoster, resolveSalesChain } from '@/data/sales-hierarchy'

/** Create/edit form for a salesperson. Editing a designation/tier/manager
 *  writes directly to their CURRENT posting rather than opening a new one —
 *  that is a real posting-history operation (promotion/reorg) that belongs to
 *  a dedicated flow, not a quick edit dialog; this demo slice keeps that
 *  distinction visible in the code even though both paths write here today. */
export function SalesPersonFormDialog({ open, personId, onClose }: {
  open: boolean
  /** Editing when set, creating when null. */
  personId: string | null
  onClose: () => void
}) {
  const toast = useToast()
  const { data: people = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const { create, update, updatePostingManager } = useSalesPersonMutations()
  const editing = personId ? people.find((p) => p.id === personId) : undefined

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [designation, setDesignation] = useState('')
  const [tierKey, setTierKey] = useState(SALES_TIERS[SALES_TIERS.length - 1].key)
  const [managerId, setManagerId] = useState('')
  const [notes, setNotes] = useState('')
  /** Editable RM email for the "quick edit" path (editing only) — bound to
   *  the current posting's managerId, resolved to an email since
   *  SalesTeamPicker's candidates are keyed by email, not id. Compared
   *  against its initial value on save to decide whether to call
   *  `updatePostingManager` at all. */
  const [rmEmail, setRmEmail] = useState('')
  const [initialRmEmail, setInitialRmEmail] = useState('')

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setEmail(editing?.officialEmail ?? '')
    setMobile(editing?.mobile ?? '')
    setNotes(editing?.notes ?? '')
    setDesignation('')
    setTierKey(SALES_TIERS[SALES_TIERS.length - 1].key)
    setManagerId('')
    const currentManagerId = editing ? currentPostings[editing.id]?.managerId : null
    const currentRmEmail = currentManagerId ? (people.find((p) => p.id === currentManagerId)?.officialEmail ?? '') : ''
    setRmEmail(currentRmEmail)
    setInitialRmEmail(currentRmEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId])

  // Derived, one level further up the manager chain from the picked RM —
  // never independently editable, matches DepartmentFields.tsx's disabled
  // GM field.
  const gmEmail = resolveSalesChain(rmEmail, liveSalesRoster(people, currentPostings)).gm?.email ?? ''

  async function submit() {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: { name, officialEmail: email, mobile, notes } })
      if (rmEmail !== initialRmEmail) {
        const newManagerId = rmEmail ? (people.find((p) => p.officialEmail === rmEmail)?.id ?? null) : null
        await updatePostingManager.mutateAsync({ personId: editing.id, managerId: newManagerId })
      }
      toast(`Updated ${name}`)
    } else {
      await create.mutateAsync({
        name, officialEmail: email, mobile, notes,
        designation: designation || tierKeyToDefaultTitle(tierKey),
        tierKey,
        managerId: managerId || null,
      })
      toast(`Added ${name}`)
    }
    onClose()
  }

  const canSubmit = name.trim().length > 0 && email.trim().length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit salesperson' : 'Add salesperson'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || create.isPending || update.isPending || updatePostingManager.isPending}
          >
            {editing ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Official email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@amnex.com" />
        </Field>
        <Field label="Mobile">
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </Field>

        {!editing && (
          <>
            <Field label="Designation" hint="Leave blank to use the tier's default title.">
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Account Manager" />
            </Field>
            <Field label="Tier">
              <Select value={tierKey} onChange={(e) => setTierKey(e.target.value)}>
                {SALES_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Reports to">
              <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">No manager</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </>
        )}

        {editing && (
          <>
            {/* Quick-edit path: an in-place manager change on the current
                posting, saved alongside the person patch above. Distinct from
                TransferSalesPersonDialog's full promotion/reorg-with-history
                flow, which remains untouched and is still the path for a
                designation/tier change. */}
            <Field label="Reporting Manager (RM)">
              <SalesTeamPicker value={rmEmail} onChange={setRmEmail} ariaLabel="Reporting Manager (RM)" />
            </Field>
            <Field label="GM / Higher Reporting Manager" hint="Auto-filled from Reporting Manager">
              <SalesTeamPicker value={gmEmail} onChange={() => {}} disabled />
            </Field>
          </>
        )}

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  )
}

function tierKeyToDefaultTitle(tierKey: string): string {
  return SALES_TIERS.find((t) => t.key === tierKey)?.label ?? tierKey
}
