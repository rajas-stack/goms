import type { InputHTMLAttributes } from 'react'
import { Input } from './Field'
import { normalizeEmail } from '@/lib/inputNormalization'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onPaste' | 'onBlur' | 'type'> {
  value: string
  onChange: (value: string) => void
}

export function EmailInput({ value, onChange, ...inputProps }: Props) {
  return (
    <Input
      type="email"
      inputMode="email"
      autoCapitalize="none"
      autoComplete="email"
      maxLength={254}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onPaste={(event) => {
        event.preventDefault()
        onChange(normalizeEmail(event.clipboardData.getData('text'), true))
      }}
      onBlur={() => {
        const normalized = normalizeEmail(value, true)
        if (normalized !== value) onChange(normalized)
      }}
      {...inputProps}
    />
  )
}