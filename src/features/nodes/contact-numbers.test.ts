import { describe, expect, it } from 'vitest'
import { parseContactNumbers, serializeContactNumbers, type ContactNumberEntry } from './contact-numbers'

describe('contact-numbers serialize/parse helper', () => {
  it('round-trips a list of entries', () => {
    const entries: ContactNumberEntry[] = [
      { city: 'Bhubaneswar', stdCode: '0674', number: '+91 2345678' },
      { city: '', stdCode: '', number: '' },
    ]
    expect(parseContactNumbers(serializeContactNumbers(entries))).toEqual(entries)
  })

  it('parses undefined/empty as an empty list', () => {
    expect(parseContactNumbers(undefined)).toEqual([])
    expect(parseContactNumbers('')).toEqual([])
  })

  it('degrades malformed JSON to an empty list instead of throwing', () => {
    expect(parseContactNumbers('not json{{')).toEqual([])
  })

  it('degrades a non-array JSON value to an empty list', () => {
    expect(parseContactNumbers('{"city":"x"}')).toEqual([])
  })

  it('fills in missing/wrong-typed fields on each entry rather than throwing', () => {
    expect(parseContactNumbers('[{"city":"Bhubaneswar"},{"number":123},null,"x"]')).toEqual([
      { city: 'Bhubaneswar', stdCode: '', number: '' },
      { city: '', stdCode: '', number: '' },
    ])
  })
})
