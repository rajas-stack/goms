import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useSalesPersonMutations, useSalesPersons, useSalesPostings } from '@/lib/api'
import { SALES_TIERS } from '@/data/sales-tiers'
import { isoToday } from '@/lib/dates'
import type { SalesPerson } from '@/lib/types'

/** Closes a salesperson's current posting and opens a new one — the real
 *  posting-history operation `SalesPersonFormDialog` deliberately defers
 *  (spec §6.3). `changeType` (promotion/demotion/lateral move) is derived
 *  server-side from the tier change, not chosen here. */
export function TransferSalesPersonDialog({ open, person, onClose }: {
  open: boolean
  person: SalesPerson | null
  onClose: () => void
}) {
  const toast = useToast()
  const { data: people = [] } = useSalesPersons()
  const { data: postings = [] } = useSalesPostings(person?.id ?? null)
  const { transfer } = useSalesPersonMutations()
  const current = postings.find((p) => p.endDate === null)

  const [designation, setDesignation] = useState('')
  const [tierKey, setTierKey] = useState(SALES_TIERS[SALES_TIERS.length - 1].key)
  const [managerId, setManagerId] = useState('')
  const [office, setOffice] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(isoToday())
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) return
    setDesignation(current?.designation ?? '')
    setTierKey(current?.tierKey ?? SALES_TIERS[SALES_TIERS.length - 1].key)
    setManagerId(current?.managerId ?? '')
    setOffice(current?.office ?? '')
    setEffectiveDate(isoToday())
    setReason('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person?.id])

  async function submit() {
    if (!person) return
    await transfer.mutateAsync({
      salesPersonId: person.id,
      designation: designation.trim(),
      tierKey,
      managerId: managerId || null,
      office: office.trim(),
      effectiveDate,
      reason: reason.trim(),
    })
    toast(`Transferred ${person.name}`)
    onClose()
  }

  const canSubmit = designation.trim().length > 0 && !!effectiveDate

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Transfer salesperson"
      description={person?.name}
      footer={
        <>
          <Button onClick={onClose} disabled={transfer.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit || transfer.isPending}>
            {transfer.isPending ? 'Recording…' : 'Record transfer'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {current && (
          <div className="rounded-lg border border-line bg-panel/50 px-3 py-2.5 text-[13px]">
            <span className="text-[11px] uppercase tracking-wide text-muted">Current posting</span>
            <p className="mt-0.5 text-ink-900">{current.designation}</p>
          </div>
        )}
        <Field label="New designation">
          <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Regional Manager" />
        </Field>
        <Field label="New tier">
          <Select value={tierKey} onChange={(e) => setTierKey(e.target.value)}>
            {SALES_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">No manager</option>
            {people.filter((p) => p.id !== person?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Office" hint="Optional">
          <Input value={office} onChange={(e) => setOffice(e.target.value)} />
        </Field>
        <Field label="Effective date">
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Promoted to Regional Manager" />
        </Field>
      </div>
    </Dialog>
  )
}
