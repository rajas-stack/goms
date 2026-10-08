import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeneralFieldControl } from './GeneralFieldControl'
import { GENERAL_FIELDS } from './generalFields'

describe('pre-bid meeting fields', () => {
  it('uses a date-time field, a separate address with an encoded Maps pin link, and notes', () => {
    expect(GENERAL_FIELDS.find(field => field.key === 'preBidMeeting')?.kind).toBe('datetime')
    expect(GENERAL_FIELDS.find(field => field.key === 'preBidMeetingNotes')?.kind).toBe('textarea')
    const change = vi.fn()
    const address = '2nd floor, Core-8, Scope Complex, New Delhi 110003'
    render(<GeneralFieldControl field={GENERAL_FIELDS.find(field => field.key === 'preBidMeetingAddress')!}
      value={address} onChange={change} onValidityChange={() => {}} />)
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)
    fireEvent.change(screen.getByLabelText('Pre-Bid Meeting Address'), { target: { value: 'New venue' } })
    expect(change).toHaveBeenCalledWith('New venue')
  })
})
