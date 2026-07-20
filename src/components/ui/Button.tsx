import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'icon'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus-visible:focus-ring disabled:opacity-40 disabled:pointer-events-none select-none'

const variants: Record<Variant, string> = {
  primary: 'bg-ink-900 text-paper hover:bg-ink-800 shadow-sm active:scale-[0.98]',
  secondary: 'bg-white text-ink border border-line hover:border-ink-600 hover:bg-panel active:scale-[0.98]',
  ghost: 'text-muted hover:text-ink hover:bg-ink-900/[0.05]',
  danger: 'bg-crimson text-white hover:bg-crimson/90 active:scale-[0.98]',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  icon: 'h-8 w-8',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'secondary', size = 'md', className, ...props }, ref) => (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  ),
)
Button.displayName = 'Button'
