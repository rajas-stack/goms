import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useBid, useBidCorrigenda, useBidCorrigendaMutations, useBidMilestones, useDocuments } from '@/lib/api'

interface Row { fieldKey: string; proposed: string }

/** Records a corrigendum a person has read in the source document (there is no
 *  automatic extraction): which fields it amends and their new values. Nothing is
 *  applied here — each change then waits for an explicit accept/reject in the
 *  review dialog. The "current" value is read from the bid, never typed, so it is
 *  the value the change is actually compared against. */
export function CreateCorrigendumDialog({ open = true, bidId, onClose }: { open?: boolean; bidId: string; onClose: () => void }) {
  const { data: bid } = useBid(bidId)
  const { data: documents = [] } = useDocuments('bid', bidId)
  const { data: milestones = [] } = useBidMilestones(bidId)
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const { create } = useBidCorrigendaMutations(bidId)

  const nextNumber = Math.max(0, ...corrigenda.map((c) => c.corrigendumNumber)) + 1
  const [numberText, setNumberText] = useState<string | null>(null) // null = the suggested next number
  const [sourceDocumentId, setSourceDocumentId] = useState('')
  const [rows, setRows] = useState<Row[]>([{ fieldKey: '', proposed: '' }])
  const [error, setError] = useState<string | null>(null)

  const fields = [
    { key: 'tenderLink', label: 'Tender Link', kind: 'text' as const },
    ...milestones.filter((m) => m.status !== 'superseded').map((m) => ({ key: m.key, label: m.label, kind: 'date' as const })),
  ]
  const fieldOf = (key: string) => fields.find((f) => f.key === key)
  const currentValueOf = (key: string) => (key === 'tenderLink' ? (bid?.tenderLink ?? '') : (milestones.find((m) => m.key === key)?.dueAt ?? ''))
  const displayCurrent = (key: string) => {
    const v = currentValueOf(key)
    if (!v) return 'No record'
    return fieldOf(key)?.kind === 'date' ? new Date(v).toLocaleString() : v
  }

  const number = Number(numberText ?? nextNumber)
  const duplicate = corrigenda.some((c) => c.corrigendumNumber === number)
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const usedKeys = new Set(rows.map((r) => r.fieldKey))
  const valid = Number.isInteger(number) && number > 0 && !duplicate
    && rows.every((r) => r.fieldKey && r.proposed.trim()) && usedKeys.size === rows.length

  async function submit() {
    setError(null)
    try {
      await create.mutateAsync({
        bidId, corrigendumNumber: number, sourceDocumentId: sourceDocumentId || undefined,
        changes: rows.map((r) => ({
          fieldKey: r.fieldKey,
          currentValue: currentValueOf(r.fieldKey),
          proposedValue: fieldOf(r.fieldKey)?.kind === 'date' ? new Date(r.proposed).toISOString() : r.proposed.trim(),
        })),
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the corrigendum.')
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} size="lg" title="Add Corrigendum"
      description="Record what the corrigendum changes. Each change is reviewed before anything is applied."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || create.isPending} onClick={submit}>Create Corrigendum</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Corrigendum Number" hint={duplicate ? `Corrigendum ${number} already exists for this bid.` : undefined}>
            <Input type="number" min={1} value={numberText ?? String(nextNumber)} onChange={(e) => setNumberText(e.target.value)} />
          </Field>
          <Field label="Source Document">
            <Select value={sourceDocumentId} onChange={(e) => setSourceDocumentId(e.target.value)}>
              <option value="">— None —</option>
              {documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </Select>
          </Field>
        </div>

        {rows.map((row, i) => {
          const field = fieldOf(row.fieldKey)
          return (
            <div key={i} className="space-y-2 rounded-lg border border-line p-3" data-testid="corrigendum-change">
              <Field label="Field">
                <Select aria-label={`Field ${i + 1}`} value={row.fieldKey} onChange={(e) => setRow(i, { fieldKey: e.target.value, proposed: '' })}>
                  <option value="">Choose a field…</option>
                  {fields.map((f) => <option key={f.key} value={f.key} disabled={usedKeys.has(f.key) && f.key !== row.fieldKey}>{f.label}</option>)}
                </Select>
              </Field>
              {field && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 text-[13px] font-medium text-ink-800">Current value</div>
                    <div className="flex h-10 items-center text-sm text-muted">{displayCurrent(row.fieldKey)}</div>
                  </div>
                  <Field label="Proposed value">
                    {field.kind === 'date'
                      ? <Input type="datetime-local" aria-label={`Proposed value ${i + 1}`} value={row.proposed} onChange={(e) => setRow(i, { proposed: e.target.value })} />
                      : <Input aria-label={`Proposed value ${i + 1}`} placeholder="https://…" value={row.proposed} onChange={(e) => setRow(i, { proposed: e.target.value })} />}
                  </Field>
                </div>
              )}
              {rows.length > 1 && (
                <div className="text-right"><Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove change</Button></div>
              )}
            </div>
          )
        })}
        <Button variant="secondary" size="sm" disabled={rows.length >= fields.length} onClick={() => setRows((rs) => [...rs, { fieldKey: '', proposed: '' }])}>
          Add another change
        </Button>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}
