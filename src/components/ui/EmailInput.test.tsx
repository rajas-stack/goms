import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EmailInput } from './EmailInput'

function ControlledEmailInput() {
  const [email, setEmail] = useState('')
  return <EmailInput value={email} onChange={setEmail} aria-label="Department email" />
}

describe('EmailInput', () => {
  it('normalizes shorthand email notation when pasted', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<EmailInput value="" onChange={onChange} aria-label="Department email" />)
    const input = screen.getByRole('textbox', { name: 'Department email' })

    await user.click(input)
    await user.paste('secdst[at]gujarat[dot]gov[dot]in]')

    expect(onChange).toHaveBeenLastCalledWith('secdst@gujarat.gov.in')
  })

  it('adds the missing mailbox separator when a domain shorthand is pasted', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<EmailInput value="" onChange={onChange} aria-label="Department email" />)
    const input = screen.getByRole('textbox', { name: 'Department email' })

    await user.click(input)
    await user.paste('secdst.gujarat.gov.in')

    expect(onChange).toHaveBeenLastCalledWith('secdst@gujarat.gov.in')
  })

  it('normalizes shorthand entered by typing when the field is left', async () => {
    const user = userEvent.setup()
    render(<ControlledEmailInput />)
    const input = screen.getByRole('textbox', { name: 'Department email' })

    await user.type(input, 'secdst.gujarat.gov.in')
    await user.tab()

    expect(input).toHaveValue('secdst@gujarat.gov.in')
  })
})