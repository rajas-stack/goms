import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('reflects the checked prop', () => {
    render(<Checkbox checked aria-label="Select line" onChange={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Select line' })).toBeChecked()
  })

  it('calls onChange with the new checked value on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} aria-label="Select line" onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select line' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('sets the indeterminate DOM property when indeterminate is true', () => {
    render(<Checkbox checked={false} indeterminate aria-label="Select all" onChange={() => {}} />)
    const el = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement
    expect(el.indeterminate).toBe(true)
  })
})
