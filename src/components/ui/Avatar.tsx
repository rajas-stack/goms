import { cn } from '@/lib/utils'
import { initials } from '@/lib/utils'
import { Icon } from './Icon'

export interface AvatarPerson {
  name: string
  photoUrl?: string | null
  vacant?: boolean
}

export function Avatar({
  person,
  size = 'md',
  className,
}: {
  person: AvatarPerson
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}): JSX.Element {
  const sizeClasses = {
    xs: 'h-6 w-6 text-xs',
    sm: 'h-8 w-8 text-sm',
    md: 'h-10 w-10 text-base',
    lg: 'h-14 w-14 text-lg',
  }

  const baseClasses = cn(
    'flex shrink-0 items-center justify-center rounded-full',
    sizeClasses[size],
    className,
  )

  // Vacant variant takes precedence
  if (person.vacant) {
    return (
      <div
        className={cn(baseClasses, 'bg-amber-100 text-amber-600')}
        data-testid="avatar"
        aria-hidden="true"
      >
        <Icon name="UserX" size={size === 'xs' ? 12 : size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
      </div>
    )
  }

  // Photo variant
  if (person.photoUrl) {
    return (
      <img
        src={person.photoUrl}
        alt={person.name}
        className={cn(baseClasses)}
      />
    )
  }

  // Initials variant
  return (
    <div
      className={cn(baseClasses, 'bg-ink-100 text-ink-700 font-medium')}
      data-testid="avatar"
      aria-hidden="true"
    >
      {initials(person.name)}
    </div>
  )
}
