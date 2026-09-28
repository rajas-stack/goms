import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useOwnershipFor, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { displayEndDate } from '@/lib/intervals'
import { activeDelegate } from '@/data/ownership'
import { coversDate } from '@/lib/intervals'
import { AssignOwnerDialog } from './AssignOwnerDialog'
import { OwnerBadge } from './OwnerBadge'
import type { OwnerResolution } from '@/data/ownership'

/** The AMNEX-ownership section for any ownable entity's detail panel.
 *
 *  Takes the resolved owner from the caller rather than resolving it here:
 *  resolution walks ancestors, and doing it inside a panel that re-renders on
 *  every selection change is exactly the per-render walk §13 warns about. */
export function OwnershipBlock({ entityType, entityId, entityLabel, owner, viaLabel }: {
  entityType: string
  entityId: string
  entityLabel: string
  owner: OwnerResolution | null | undefined
  viaLabel?: string
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: history = [] } = useOwnershipFor(entityType, entityId)
  const { data: people = [] } = useSalesPersons()
  const asOf = isoToday()

  const delegate = activeDelegate(history, entityType, entityId, asOf)
  const delegatePerson = delegate ? people.find((p) => p.id === delegate.salesPersonId) : undefined
  // Rows NOT currently in force — not just "has an end date": a delegate row
  // is REQUIRED to have one even while active, so filtering on `endDate !==
  // null` would wrongly list today's live delegate as history too.
  const past = history.filter((a) => !coversDate(a, asOf))

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink-900">AMNEX ownership</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {owner?.source === 'direct' ? 'Reassign' : 'Assign'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <OwnerBadge owner={owner} people={people} viaLabel={viaLabel} />
        {delegate && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[12px] text-sky-800"
            title={`Delegated until ${displayEndDate(delegate.endDate) ?? 'further notice'}`}
          >
            <Avatar person={{ name: delegatePerson?.name ?? delegate.salesPersonId, photoUrl: delegatePerson?.photoUrl }} size="xs" />
            <Icon name="UserPlus" size={12} />
            {delegatePerson?.name ?? delegate.salesPersonId} · delegate
          </span>
        )}
      </div>

      {owner?.source === 'inherited' && (
        <p className="mt-1.5 text-[12px] text-muted">
          No owner is set on this record — this is inherited{viaLabel ? ` from ${viaLabel}` : ''}.
          That is not a gap.
        </p>
      )}

      {past.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Previously</p>
          <ul className="flex flex-col gap-1">
            {past.map((a) => {
              const person = people.find((p) => p.id === a.salesPersonId)
              return (
                <li key={a.id} className="flex items-center gap-1.5 text-[12px] text-ink-600">
                  <Avatar person={{ name: person?.name ?? a.salesPersonId, photoUrl: person?.photoUrl }} size="xs" />
                  <span>
                    {person?.name ?? a.salesPersonId} · {a.startDate || 'unknown'} —{' '}
                    {displayEndDate(a.endDate) ?? 'current'}
                    {a.role !== 'owner' && ` · ${a.role}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <AssignOwnerDialog
        open={dialogOpen}
        entityType={entityType}
        entityId={entityId}
        entityLabel={entityLabel}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}
