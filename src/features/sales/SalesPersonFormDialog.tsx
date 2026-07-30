import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useSalesPersonMutations, useSalesPersons } from '@/lib/api'
import { SALES_TIERS } from '@/data/sales-tiers'

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
  const { create, update } = useSalesPersonMutations()
  const editing = personId ? people.find((p) => p.id === personId) : undefined

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [designation, setDesignation] = useState('')
  const [tierKey, setTierKey] = useState(SALES_TIERS[SALES_TIERS.length - 1].key)
  const [managerId, setManagerId] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setEmail(editing?.officialEmail ?? '')
    setMobile(editing?.mobile ?? '')
    setNotes(editing?.notes ?? '')
    setDesignation('')
    setTierKey(SALES_TIERS[SALES_TIERS.length - 1].key)
    setManagerId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId])

  async function submit() {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: { name, officialEmail: email, mobile, notes } })
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
          <Button variant="primary" onClick={submit} disabled={!canSubmit || create.isPending || update.isPending}>
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
