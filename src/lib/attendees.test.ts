import { describe, expect, it } from 'vitest'
import { attendeeName, attendeeSalesPersonId } from './attendees'

describe('attendeeName', () => {
  it('returns a legacy plain string as-is', () => {
    expect(attendeeName('Mr. Rohit Tiku')).toBe('Mr. Rohit Tiku')
  })
  it('returns the .name of an ID-carrying snapshot', () => {
    expect(attendeeName({ salesPersonId: 'sp-1', name: 'Asha Rao' })).toBe('Asha Rao')
  })
})

describe('attendeeSalesPersonId', () => {
  it('returns undefined for a legacy plain string', () => {
    expect(attendeeSalesPersonId('Mr. Rohit Tiku')).toBeUndefined()
  })
  it('returns the salesPersonId of an ID-carrying snapshot', () => {
    expect(attendeeSalesPersonId({ salesPersonId: 'sp-1', name: 'Asha Rao' })).toBe('sp-1')
  })
})
