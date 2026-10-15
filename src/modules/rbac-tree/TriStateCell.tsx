import type { RbacCellValue } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

interface Props {
  value: RbacCellValue
  /** The effective answer for this subject (after inheritance and View gating). */
  allowed: boolean
  applicable: boolean
  readOnly: boolean
  /** Tooltip / accessible description: what the cell means and where an inherited value comes from. */
  explain: string
  label: string
  onCycle: () => void
}

/** One permission cell: explicit allow / deny is solid; inherit shows the inherited answer faded with a dashed outline.
 *  A click cycles inherit → allow → deny. */
export function TriStateCell({ value, allowed, applicable, readOnly, explain, label, onCycle }: Props) {
  if (!applicable) return <span aria-hidden className="block text-center text-[12px] text-muted/40">—</span>
  const explicit = value !== 'inherit'
  const tone = explicit
    ? value === 'allow' ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'border-crimson/50 bg-crimson/15 text-crimson'
    : cn('border-dashed border-line bg-transparent', allowed ? 'text-emerald-600/45 dark:text-emerald-300/45' : 'text-crimson/45')
  return (
    <button
      type="button" disabled={readOnly} onClick={onCycle} title={explain}
      aria-label={`${label}: ${explicit ? value : `inherit (${allowed ? 'allowed' : 'denied'})`}`}
      className={cn(
        'mx-auto flex h-7 w-9 items-center justify-center rounded-md border transition-[transform,background-color] duration-150 focus-visible:focus-ring',
        tone, !readOnly && 'hover:scale-105 active:scale-95', readOnly && 'cursor-default',
      )}
    >
      <Icon name={(explicit ? value === 'allow' : allowed) ? 'Check' : 'X'} size={14} />
    </button>
  )
}
