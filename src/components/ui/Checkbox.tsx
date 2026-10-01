import { useEffect, useRef } from 'react'

export function Checkbox({ checked, indeterminate, disabled, onChange, 'aria-label': ariaLabel }: {
  checked: boolean
  disabled?: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  'aria-label': string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="h-4 w-4 shrink-0 accent-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
    />
  )
}
