import { useState } from 'react'
import { competitorInitials } from '@goms/domain'
import { cn } from '@/lib/utils'

interface Props {
  name: string
  logo: string | null
  /** square: md 48px / lg 64px tile; wordmark: a 72×40 slot that suits wide logos. */
  variant?: 'square' | 'wordmark'
  size?: 'md' | 'lg'
  className?: string
}

const SIZE = { md: 'h-12 w-12 text-[15px]', lg: 'h-16 w-16 text-lg' } as const
/** With an image, the tile keeps its height but takes the logo's own shape (up to ~3:1). */
const IMAGE_SIZE = { md: 'h-12 w-auto min-w-12 max-w-[144px]', lg: 'h-16 w-auto min-w-16 max-w-[192px]' } as const

/** The competitor's logo on a neutral tile, or its initials when there is none (or it fails to load). */
export function CompetitorLogo({ name, logo, variant = 'square', size = 'md', className }: Props) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = !!logo && failed !== logo
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden border border-line',
      variant === 'wordmark' ? 'h-10 w-[72px] rounded-lg text-[13px]' : cn('rounded-xl', showImage ? IMAGE_SIZE[size] : SIZE[size]),
      showImage ? 'bg-white p-1' : 'bg-goms-navy/10 font-semibold tracking-wide text-goms-navy dark:bg-goms-navy/25', className)}>
      {showImage
        ? <img src={logo} alt={`${name} logo`} className={cn('h-full object-contain', variant === 'wordmark' ? 'w-full' : 'w-auto max-w-full')}
            loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(logo)} />
        : <span aria-hidden="true">{competitorInitials(name)}</span>}
    </span>
  )
}
