import {
  forwardRef, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 transition-colors focus:border-ink-600 focus-visible:focus-ring'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />,
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, 'min-h-[84px] resize-y', className)} {...props} />,
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-10 appearance-none bg-white pr-8', className)} {...props}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export function Field(
  { label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode },
) {
  return (
    <label className="block">
      {/* The asterisk is a CSS pseudo-element, not real text — a real text
       *  node here would change the label's accessible name (e.g. "Name" ->
       *  "Name *"), breaking every existing `getByLabelText(/^name$/i)`-style
       *  test/query across the app for no functional reason. */}
      <span
        className={cn(
          'mb-1.5 block text-[13px] font-medium text-ink-800',
          required && "after:ml-0.5 after:text-crimson after:content-['*']",
        )}
      >
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}
