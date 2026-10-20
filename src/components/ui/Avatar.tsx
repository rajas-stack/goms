import { useEffect, useState, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/utils'
import { Icon } from './Icon'
import { useProfileImage, type ProfileImageRef } from '@/lib/useProfileImage'

export interface AvatarPerson {
  name: string
  photoUrl?: string | null
  vacant?: boolean
  profileImage?: ProfileImageRef
}

export type AvatarSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<AvatarSize, string> = {
  '2xs': 'h-5 w-5 text-[9px]',
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
}

const ICON_SIZE: Record<AvatarSize, number> = { '2xs': 10, xs: 12, sm: 14, md: 16, lg: 18 }

export function Avatar({
  person,
  size = 'md',
  className,
}: {
  person: AvatarPerson
  size?: AvatarSize
  className?: string
}): ReactElement {
  // A broken/expired photo URL falls back to initials instead of a broken-image glyph.
  const [photoFailed, setPhotoFailed] = useState(false)
  const drivePhoto = useProfileImage(person.vacant ? undefined : person.profileImage)
  const photoUrl = person.profileImage ? drivePhoto.url : person.photoUrl
  useEffect(() => setPhotoFailed(false), [photoUrl])

  const baseClasses = cn(
    'flex shrink-0 items-center justify-center rounded-full',
    SIZE_CLASSES[size],
    className,
  )

  // Vacant variant takes precedence
  if (person.vacant) {
    return (
      <span
        className={cn(baseClasses, 'bg-amber-100 text-amber-600')}
        data-testid="avatar"
        aria-hidden="true"
      >
        <Icon name="UserX" size={ICON_SIZE[size]} />
      </span>
    )
  }

  // Photo variant
  if (photoUrl && !photoFailed) {
    return (
      <img
        ref={drivePhoto.ref}
        src={photoUrl}
        alt={person.name}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setPhotoFailed(true)}
        className={cn(baseClasses, 'bg-ink-100 object-cover ring-1 ring-line')}
      />
    )
  }

  // Initials variant
  return (
    <span
      ref={drivePhoto.ref}
      className={cn(baseClasses, 'bg-ink-100 font-semibold leading-none text-ink-700')}
      data-testid="avatar"
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  )
}
