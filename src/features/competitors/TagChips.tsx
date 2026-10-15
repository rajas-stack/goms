import { cn } from '@/lib/utils'
import { tagTone } from './model'

interface Props {
  tags: readonly string[]
  label: string
  /** Show at most this many, then "+N". Omit to show all. */
  max?: number
  className?: string
}

/** Coloured, wrapping chips; each tag keeps the same tone everywhere. */
export function TagChips({ tags, label, max, className }: Props) {
  if (!tags.length) return <span className="text-[12px] text-muted">—</span>
  const shown = max === undefined ? tags : tags.slice(0, max)
  const hidden = tags.length - shown.length
  return (
    <ul aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {shown.map(tag => <li key={tag} className={cn('rounded-md px-2 py-0.5 text-[11.5px] font-medium', tagTone(tag))}>{tag}</li>)}
      {hidden > 0 && <li className="rounded-md bg-panel px-2 py-0.5 text-[11.5px] font-medium text-muted" title={tags.slice(shown.length).join(', ')}>+{hidden}</li>}
    </ul>
  )
}
