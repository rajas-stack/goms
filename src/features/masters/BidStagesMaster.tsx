import { useMemo, useState } from 'react'
import { isBuiltInBidStage, masterKeyAtom } from '@goms/domain'
import { useMasterMutations, useMasters } from '@/modules/commercial-calculator/api'
import type { BidTrackerMasterRow } from '@/modules/commercial-calculator/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useAllowed } from '@/lib/permissions'
import { useAddBidStage } from './useBidStages'

/** Settings > Masters > Live Bids > Bid Stages: the Bid Stage dropdown, in this order. Built-in stages drive the
 *  bid workflow (packages/domain/src/bids.ts), so they can be renamed and moved but never deactivated or deleted. */
export function BidStagesMaster() {
  const { data = [] } = useMasters('bidStages')
  const rows = useMemo(() => [...data].sort((a, b) => a.displayOrder - b.displayOrder), [data])
  const { update, setActive, remove } = useMasterMutations('bidStages')
  const allowed = useAllowed('com.masters', 'update', masterKeyAtom('bidStages'))
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const run = (p: Promise<unknown>) => { setError(''); p.catch(e => setError(e instanceof Error ? e.message : 'Could not save.')) }
  const duplicate = (label: string, exceptId?: string) => rows.some(r => r.id !== exceptId && r.name.trim().toLowerCase() === label.toLowerCase())
  /** Writes `list` as the order, touching only the rows whose position changed. */
  const saveOrder = (list: BidTrackerMasterRow[]) =>
    Promise.all(list.flatMap((r, i) => (r.displayOrder === i ? [] : [update.mutateAsync({ id: r.id, patch: { displayOrder: i } })])))
  const move = (from: number, to: number) => {
    const list = [...rows]
    list.splice(to, 0, ...list.splice(from, 1))
    run(saveOrder(list))
  }

  const { add: addStage, isPending: adding } = useAddBidStage()
  const add = () => {
    const label = name.trim()
    if (!label) return
    run(addStage(label).then(() => setName('')))
  }
  const rename = () => {
    const label = editing?.name.trim()
    if (!editing || !label) return
    if (duplicate(label, editing.id)) { setError(`A stage named "${label}" already exists.`); return }
    run(update.mutateAsync({ id: editing.id, patch: { name: label } }).then(() => setEditing(null)))
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <p className="max-w-3xl text-[13px] text-muted">
        The Bid Stage choices on Live Bids, in this order. Built-in stages drive the bid workflow (new bids start at the first,
        Go needs Submitted, Go / No-Go closes the bid), so they can be renamed and moved but not removed. Added stages are open
        stages: they count as live bids, and the Go check and timeline treat them like the built-in stage above them.
      </p>
      {allowed && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); add() }}>
          <Input aria-label="New stage name" className="max-w-72" value={name} onChange={e => setName(e.target.value)} placeholder="New stage name" />
          <Button type="submit" variant="primary" disabled={!name.trim() || adding}>Add stage</Button>
        </form>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800">{error}</p>}
      <ol aria-label="Bid stages" className="flex max-w-3xl flex-col gap-2">
        {rows.map((r, i) => {
          const builtIn = isBuiltInBidStage(r.code)
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2">
              <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-muted">{i + 1}</span>
              {editing?.id === r.id ? (
                <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={e => { e.preventDefault(); rename() }}>
                  <Input aria-label={`New name for ${r.name}`} autoFocus value={editing.name} onChange={e => setEditing({ id: r.id, name: e.target.value })} />
                  <Button type="submit" size="sm" variant="primary" disabled={!editing.name.trim() || update.isPending}>Save</Button>
                  <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink-900">{r.name}</span>
                  {builtIn && <Badge tone="gray">Built-in</Badge>}
                  {!r.active && <Badge tone="amber">Inactive</Badge>}
                </div>
              )}
              {allowed && editing?.id !== r.id && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="ArrowUp" size={15} /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}><Icon name="ArrowDown" size={15} /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ id: r.id, name: r.name })}><Icon name="Pencil" size={15} /></Button>
                  {!builtIn && <>
                    <Button size="sm" onClick={() => run(setActive.mutateAsync({ id: r.id, active: !r.active }))}>{r.active ? 'Deactivate' : 'Activate'}</Button>
                    <Button size="sm" onClick={() => run(remove.mutateAsync(r.id))}>Delete</Button>
                  </>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
