import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PhotoUploadField } from '@/components/ui/PhotoUploadField'
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
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
  /** Item 1: GM/Higher Reporting Manager is independently editable — an
   *  empty override means "keep auto-deriving from the RM chain" (below),
   *  a picked email overrides that derivation. Compared against its initial
   *  value on save exactly like `rmEmail`, so an untouched GM never sends a
   *  spurious `gmOverrideId`. */
  const [gmOverrideEmail, setGmOverrideEmail] = useState('')
  const [initialGmOverrideEmail, setInitialGmOverrideEmail] = useState('')

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setEmail(editing?.officialEmail ?? '')
    setMobile(editing?.mobile ?? '')
    setPhotoUrl(editing?.photoUrl ?? null)
    setNotes(editing?.notes ?? '')
    setDesignation('')
    setTierKey(SALES_TIERS[SALES_TIERS.length - 1].key)
    setManagerId('')
    const currentPosting = editing ? currentPostings[editing.id] : undefined
    const currentRmEmail = currentPosting?.managerId ? (people.find((p) => p.id === currentPosting.managerId)?.officialEmail ?? '') : ''
    setRmEmail(currentRmEmail)
    setInitialRmEmail(currentRmEmail)
    const currentGmOverrideEmail = currentPosting?.gmOverrideId ? (people.find((p) => p.id === currentPosting.gmOverrideId)?.officialEmail ?? '') : ''
    setGmOverrideEmail(currentGmOverrideEmail)
    setInitialGmOverrideEmail(currentGmOverrideEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId])

  // Auto-derived one level further up the manager chain from the picked RM
  // — shown whenever there's no explicit override.
  const derivedGmEmail = resolveSalesChain(rmEmail, liveSalesRoster(people, currentPostings)).gm?.email ?? ''
  const gmEmail = gmOverrideEmail || derivedGmEmail

  async function submit() {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: { name, officialEmail: email, mobile, photoUrl, notes } })
      const postingPatch: { managerId?: string | null; gmOverrideId?: string | null } = {}
      if (rmEmail !== initialRmEmail) {
        postingPatch.managerId = rmEmail ? (people.find((p) => p.officialEmail === rmEmail)?.id ?? null) : null
      }
      if (gmOverrideEmail !== initialGmOverrideEmail) {
        postingPatch.gmOverrideId = gmOverrideEmail ? (people.find((p) => p.officialEmail === gmOverrideEmail)?.id ?? null) : null
      }
      if (Object.keys(postingPatch).length > 0) {
        await updatePostingManager.mutateAsync({ personId: editing.id, ...postingPatch })
      }
      toast(`Updated ${name}`)
    } else {
      await create.mutateAsync({
        name, officialEmail: email, mobile, photoUrl, notes,
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
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Official email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@amnex.com" />
        </Field>
        <Field label="Mobile">
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </Field>
        <PhotoUploadField photoUrl={photoUrl} onChange={setPhotoUrl} />

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
            <Field
              label="GM / Higher Reporting Manager"
              hint={gmOverrideEmail
                ? 'Manually set — overrides the Reporting Manager chain.'
                : 'Auto-derived from Reporting Manager. Pick someone to override.'}
            >
              <SalesTeamPicker value={gmEmail} onChange={setGmOverrideEmail} ariaLabel="GM / Higher Reporting Manager" />
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
