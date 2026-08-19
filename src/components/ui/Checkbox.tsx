import { useEffect, useRef } from 'react'

export function Checkbox({ checked, indeterminate, onChange, 'aria-label': ariaLabel }: {
  checked: boolean
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
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="h-4 w-4 shrink-0 accent-ink-900"
    />
  )
}
