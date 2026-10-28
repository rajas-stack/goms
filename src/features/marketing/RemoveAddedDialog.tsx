import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dialog } from '@/components/ui/Dialog'
import { PersonName } from '@/components/ui/PersonName'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations } from '@/lib/api'
import { addedByEvent, type MarketingEvent } from './eventParticipants'

/** Lists the Directory people an event's upload added, all ticked; the user unticks anyone to keep, then removes the rest. */
export function RemoveAddedDialog({ event, onDone, onClose }: {
  event: MarketingEvent
  /** Ids of this event's added people still in the Directory. */
  onDone: (remainingIds: string[]) => void
  onClose: () => void
}) {
  const toast = useToast()
  const { data: people = [], isLoading } = useAllEmployees()
  const { remove } = useEmployeeMutations()
  const added = useMemo(() => addedByEvent(event, people), [event, people])
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = added.filter((p) => !kept.has(p.id))

  const run = async () => {
    setBusy(true); setError(null)
    const removed = new Set<string>()
    // An untracked (older) event's unticked people were most likely in the Directory before, so they stop being listed.
    const remaining = (done: boolean) => added.filter((p) => !removed.has(p.id) && !(done && !event.addedIds && kept.has(p.id))).map((p) => p.id)
    try {
      for (const p of chosen) { await remove.mutateAsync(p.id); removed.add(p.id) }
      toast(`Removed ${removed.size} from Directory`)
      onDone(remaining(true))
      onClose()
    } catch (cause) {
      onDone(remaining(false)) // what already went through stays removed; a retry lists only the rest
      setError(`${cause instanceof Error ? cause.message : 'Could not remove everyone.'} (${removed.size} removed)`)
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`Remove people added by “${event.name}”`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !chosen.length} onClick={() => void run()}>
          {busy ? 'Removing…' : `Remove ${chosen.length} from Directory`}
        </Button>
      </>}>
      {!event.addedIds && <p className="mb-2 text-[12px] text-muted">
        This event was uploaded before additions were tracked, so this lists every unconnected Directory person with a participant’s name and designation. Untick anyone who was there before.
      </p>}
      {isLoading ? <p className="text-sm text-muted">Loading…</p> : !added.length ? <p className="text-sm text-muted">Nobody from this event is in the Directory.</p> : <>
        <label className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Checkbox aria-label="Select all" checked={!kept.size} indeterminate={kept.size > 0 && kept.size < added.length}
            onChange={(v) => setKept(v ? new Set() : new Set(added.map((p) => p.id)))} />
          {chosen.length} of {added.length} selected
        </label>
        <ul className="max-h-[50vh] overflow-auto">
          {added.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1">
              <Checkbox aria-label={`Remove ${p.name}`} checked={!kept.has(p.id)}
                onChange={(v) => setKept((s) => { const next = new Set(s); if (v) next.delete(p.id); else next.add(p.id); return next })} />
              <PersonName person={p} size="xs" subtitle={p.designation} />
            </li>
          ))}
        </ul>
      </>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
    </Dialog>
  )
}
