import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { OwnerResolution } from '@/data/ownership'
import type { SalesPerson } from '@/lib/types'

/** Renders an effective owner, keeping `direct` and `inherited` visually
 *  distinct — spec §7 requires this: showing an inherited owner as though it
 *  were assigned is how people "correct" data that was never wrong.
 *
 *  A missing owner is rendered as "Unassigned" only where that is genuinely a
 *  gap; callers pass `null` for both "no owner anywhere up the chain" and
 *  "still loading", so the loading case must be handled before this. */
export function OwnerBadge({ owner, people, viaLabel, className }: {
  owner: OwnerResolution | null | undefined
  people: SalesPerson[]
  /** Human-readable name of the entity an inherited owner came from. */
  viaLabel?: string
  className?: string
}) {
  if (!owner) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] text-amber-700', className)}>
        <Icon name="CircleAlert" size={12} />
        Unassigned
      </span>
    )
  }

  const person = people.find((p) => p.id === owner.salesPersonId)
  const name = person?.name ?? owner.salesPersonId
  const inherited = owner.source === 'inherited'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]',
        inherited
          ? // Dashed + italic so it reads as "not set here" at a glance, not
            // just a different colour that a colourblind user would miss.
            'border border-dashed border-ink-900/20 italic text-ink-600'
          : 'bg-emerald-50 font-medium text-emerald-800',
        className,
      )}
      title={
        inherited
          ? `Inherited${viaLabel ? ` from ${viaLabel}` : ''} — not assigned directly here`
          : 'Assigned directly'
      }
    >
      <Avatar person={{ name, photoUrl: undefined }} size="xs" />
      <Icon name={inherited ? 'CornerLeftDown' : 'UserCheck'} size={12} />
      {name}
      {inherited && viaLabel && <span className="hidden sm:inline">· via {viaLabel}</span>}
    </span>
  )
}
