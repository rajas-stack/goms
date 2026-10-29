import { useEffect, useState, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/utils'
import { Icon } from './Icon'
import { useProfileImage, type ProfileImageRef } from '@/lib/useProfileImage'
import { useProfileImagesIndex } from '@/features/dms/ProfileImagesContext'
import { profileNameKey } from '@/lib/profileNameKey'

export interface AvatarPerson {
  id?: string
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
  const profiles = useProfileImagesIndex()
  // Many screens pass only a name (or a non-person id), so fall back to the unique-name lookup.
  const userId = (person.id && profiles?.people?.[person.id]) || (person.id && profiles?.versions[person.id] ? person.id : profiles?.names?.[profileNameKey(person.name)] ?? person.id)
  const version = userId ? profiles?.versions[userId] : undefined
  const managed = profiles?.configured && !!userId
  const image = managed ? (version && userId ? { userId, version } : undefined) : person.profileImage
  const drivePhoto = useProfileImage(person.vacant ? undefined : image)
  const photoUrl = managed || image ? drivePhoto.url : person.photoUrl
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

  // Photo variant: a 3D round frame — the photo fills the circle, edges darken into a vignette, a top highlight and soft shadow lift it.
  if (photoUrl && !photoFailed) {
    return (
      <span ref={drivePhoto.ref} className={cn(baseClasses, 'relative overflow-hidden bg-ink-900/10 shadow-[0_3px_6px_rgb(15_23_42/0.28),0_1px_2px_rgb(15_23_42/0.22)]')}>
        <img
          src={photoUrl}
          alt={person.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setPhotoFailed(true)}
          className="h-full w-full object-cover object-[center_20%]"
        />
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_38%,transparent_60%,rgb(15_23_42/0.38)_100%)] shadow-[inset_0_1.5px_2px_rgb(255_255_255/0.55),inset_0_-2px_4px_rgb(15_23_42/0.3),inset_0_0_0_1px_rgb(255_255_255/0.35)]" />
      </span>
    )
  }

  // Initials variant
  return (
    <span
      ref={drivePhoto.ref}
      className={cn(baseClasses, 'bg-ink-900/10 font-semibold leading-none text-ink-700')}
      data-testid="avatar"
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  )
}
