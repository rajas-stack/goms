import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Combobox } from '@/components/ui/Combobox'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/Toast'
import { useOwnedBy, useOwnershipMutations, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { salesPersonOption } from './salesPersonOption'
import type { SalesPerson } from '@/lib/types'

/** Bulk hand-off of everything a salesperson owns — departments, contacts,
 *  opportunities — to another salesperson in one operation. The flow this
 *  exists for: someone goes on indefinite leave or resigns, and their book
 *  of business needs a new owner rather than sitting orphaned. */
export function TransferBookOfBusinessDialog({ open, person, onClose }: {
  open: boolean
  person: SalesPerson | null
  onClose: () => void
}) {
  const toast = useToast()
  const asOf = isoToday()
  const { data: people = [] } = useSalesPersons()
  const { data: owned = [] } = useOwnedBy(person?.id ?? null, asOf)
  const { transferBookOfBusiness } = useOwnershipMutations()

  const [toSalesPersonId, setToSalesPersonId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(isoToday())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setToSalesPersonId('')
    setEffectiveDate(isoToday())
    setNote('')
    setError(null)
  }, [open, person?.id])

  const openOwned = owned.filter((a) => a.role === 'owner')
  const counts = {
    orgNode: openOwned.filter((a) => a.entityType === 'orgNode').length,
    contact: openOwned.filter((a) => a.entityType === 'contact').length,
    opportunity: openOwned.filter((a) => a.entityType === 'opportunity').length,
  }

  async function submit() {
    if (!person || !toSalesPersonId) return
    setError(null)
    try {
      const moved = await transferBookOfBusiness.mutateAsync({
        fromSalesPersonId: person.id,
        toSalesPersonId,
        effectiveDate,
        note: note.trim(),
      })
      const target = people.find((p) => p.id === toSalesPersonId)
      toast(`Transferred ${moved.length} record${moved.length === 1 ? '' : 's'} to ${target?.name ?? 'new owner'}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not transfer the book of business.')
    }
  }

  const canSubmit = !!toSalesPersonId && !!effectiveDate && openOwned.length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Transfer book of business"
      description={person?.name}
      footer={
        <>
          <Button onClick={onClose} disabled={transferBookOfBusiness.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit || transferBookOfBusiness.isPending}>
            {transferBookOfBusiness.isPending ? 'Transferring…' : `Transfer ${openOwned.length} record${openOwned.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2.5 text-center text-[13px]">
          <div><div className="font-semibold text-ink-900">{counts.orgNode}</div><div className="text-[11px] text-muted">Departments</div></div>
          <div><div className="font-semibold text-ink-900">{counts.contact}</div><div className="text-[11px] text-muted">Contacts</div></div>
          <div><div className="font-semibold text-ink-900">{counts.opportunity}</div><div className="text-[11px] text-muted">Opportunities</div></div>
        </div>

        {openOwned.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-muted">
            {person && <Avatar person={person} size="2xs" className="mr-1 inline-flex align-middle" />}
            {person?.name} owns nothing as of today — there is nothing to transfer.
          </p>
        )}

        <Field label="Transfer to" required>
          <Combobox
            value={toSalesPersonId}
            onChange={setToSalesPersonId}
            options={people.filter((p) => p.id !== person?.id).map(salesPersonOption)}
            placeholder="Select…"
            aria-label="Transfer to"
          />
        </Field>

        <Field label="Effective date" required>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>

        <Field label="Note" hint="e.g. On indefinite leave, resigned">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}
      </div>
    </Dialog>
  )
}
