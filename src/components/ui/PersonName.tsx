import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Avatar, type AvatarPerson, type AvatarSize } from './Avatar'

/** The one way to show a human's name: round photo (initials fallback)
 *  followed by the name. Default `xs` (24px) sits beside 12–14px text;
 *  use `sm` next to 14–15px names in list rows, `2xs` inside dense chips. */
export function PersonName({
  person,
  size = 'xs',
  subtitle,
  className,
  nameClassName,
}: {
  person: AvatarPerson
  size?: AvatarSize
  subtitle?: ReactNode
  className?: string
  nameClassName?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 align-middle', size === '2xs' && 'gap-1.5', className)}>
      <Avatar person={person} size={size} />
      <span className="min-w-0">
        <span className={cn('block truncate', nameClassName)}>{person.name}</span>
        {subtitle && <span className="block truncate text-[12px] font-normal text-muted">{subtitle}</span>}
      </span>
    </span>
  )
}
