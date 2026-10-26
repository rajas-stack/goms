import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

/** Icon-only toolbar button: the name shows on hover and is the accessible label. */
export function IconAction({ icon, label, className, ...props }: { icon: ComponentProps<typeof Icon>['name']; label: string } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Tooltip label={label}>
      <Button size="sm" aria-label={label} className={cn('h-9 w-9 px-0', className)} {...props}><Icon name={icon} size={16} /></Button>
    </Tooltip>
  )
}
