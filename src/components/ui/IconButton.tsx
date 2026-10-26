import type { ButtonHTMLAttributes } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'

/** An action shown as its icon only: the label is its tooltip and its accessible name. */
export function IconButton({ icon, label, variant = 'ghost', side = 'top', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: string
  label: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <Tooltip label={label} side={side}>
      <Button size="icon" variant={variant} aria-label={label} {...props}><Icon name={icon} size={15} /></Button>
    </Tooltip>
  )
}
