import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FriendlyDateInput } from './FriendlyDateInput'
import type { FriendlyDateFormat } from '@/lib/friendlyDate'

function Harness({ initial = '', format, min, onValue }: {
  initial?: string; format?: FriendlyDateFormat; min?: string; onValue?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <FriendlyDateInput aria-label="When" format={format} min={min} value={value} onChange={(v) => { setValue(v); onValue?.(v) }} />
      <output data-testid="stored">{value}</output>
      <button type="button" onClick={() => setValue('2027-01-02')}>Reset</button>
    </>
  )
}

describe('FriendlyDateInput', () => {
  it('stores a typed free-form date as yyyy-mm-dd and previews what it captured', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('textbox', { name: 'When' }), '13th may 2026')
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-05-13')
    expect(screen.getByText(/Captured:/)).toHaveTextContent('13 May 2026')
  })

  it('captures a compact DDMMYYYY date typed as digits', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('textbox', { name: 'When' }), '21092026')
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-09-21')
    expect(screen.getByText(/Captured:/)).toHaveTextContent('21 September 2026')
  })

  it('shows an existing value readably without a preview', () => {
    render(<Harness initial="2026-05-13" />)
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue('13 May 2026')
    expect(screen.queryByText(/Captured:/)).not.toBeInTheDocument()
  })

  it('flags unreadable text, stores empty, and recovers when corrected', () => {
    const onValue = vi.fn()
    render(<Harness initial="2026-05-13" onValue={onValue} />)
    const input = screen.getByRole('textbox', { name: 'When' })
    fireEvent.change(input, { target: { value: 'not a date' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onValue).toHaveBeenLastCalledWith('')
    fireEvent.change(input, { target: { value: '2026-06-01' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-06-01')
  })

  it('follows a value changed from outside (e.g. a form reset)', async () => {
    render(<Harness initial="2026-05-13" />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue('02 Jan 2027')
  })

  it('stores datetime-local values with their time', () => {
    render(<Harness format="datetime-local" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'When' }), { target: { value: '13/5/26 3pm' } })
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-05-13T15:00')
    expect(screen.getByText(/Captured:/)).toHaveTextContent('13 May 2026, 15:00')
  })

  it('flags a date before min but keeps the value, like the native input', () => {
    render(<Harness min="2026-06-01" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'When' }), { target: { value: '13/5/26' } })
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-05-13')
    expect(screen.getByRole('alert')).toHaveTextContent('Must be on or after 01 Jun 2026')
  })

  it('stores a value picked from the calendar', () => {
    render(<Harness />)
    const picker = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(picker, { target: { value: '2026-07-04' } })
    expect(screen.getByTestId('stored')).toHaveTextContent('2026-07-04')
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue('04 Jul 2026')
  })

  it('disables the calendar button when the field is disabled', () => {
    render(<FriendlyDateInput aria-label="When" value="" onChange={() => {}} disabled />)
    expect(screen.getByRole('textbox', { name: 'When' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled()
  })
})
