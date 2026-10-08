import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Recessed housing that holds a row of PressKeys, like a car radio's preset bank. */
export function PressKeyGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex items-stretch gap-1 rounded-lg border border-line bg-panel p-1',
        'shadow-[inset_0_1px_3px_rgb(var(--c-shadow)/0.18),0_1px_0_rgb(var(--c-white))]',
        className,
      )}
      {...props}
    />
  )
}

interface PressKeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Latched down (a selected radio preset). Momentary keys leave this undefined. */
  latched?: boolean
  /** Show the indicator lamp above the label (on when latched). */
  lamp?: boolean
}

/** A physical push key: raised with a bottom lip, sinks when pressed. Latched
 *  keys stay down with their lamp lit; momentary keys spring back. */
export const PressKey = forwardRef<HTMLButtonElement, PressKeyProps>(
  ({ latched, lamp = false, className, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'group relative inline-flex min-w-[34px] select-none items-center justify-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold',
        'transition-[transform,box-shadow,background-color] duration-75 ease-out focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-40',
        lamp ? 'h-9 pt-2' : 'h-8',
        latched
          ? 'translate-y-[2px] border-line bg-panel text-goms-navy shadow-[inset_0_2px_4px_rgb(var(--c-shadow)/0.28)]'
          : cn(
            'border-line bg-gradient-to-b from-white to-panel text-ink-700',
            'shadow-[0_2px_0_rgb(var(--c-line)),0_3px_5px_-1px_rgb(var(--c-shadow)/0.22)]',
            'hover:from-white hover:to-white hover:text-ink-900',
            'active:translate-y-[2px] active:shadow-[inset_0_2px_4px_rgb(var(--c-shadow)/0.28)]',
          ),
        className,
      )}
      {...props}
    >
      {lamp && (
        <span
          aria-hidden
          className={cn(
            'absolute left-1/2 top-1 h-[3px] w-3.5 -translate-x-1/2 rounded-full transition-colors',
            latched ? 'bg-emerald shadow-[0_0_6px_rgb(var(--c-emerald)/0.9)]' : 'bg-line group-active:bg-emerald group-active:shadow-[0_0_6px_rgb(var(--c-emerald)/0.9)]',
          )}
        />
      )}
      {children}
    </button>
  ),
)
PressKey.displayName = 'PressKey'
