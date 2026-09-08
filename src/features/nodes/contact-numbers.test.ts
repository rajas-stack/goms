import { describe, expect, it } from 'vitest'
import { parseContactNumbers, serializeContactNumbers, type ContactNumberEntry } from './contact-numbers'

describe('contact-numbers serialize/parse helper', () => {
  it('round-trips a list of entries', () => {
    const entries: ContactNumberEntry[] = [
      { type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
      { type: 'mobile', city: '', stdCode: '', number: '+91 9876543210' },
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
      { type: 'landline', city: 'Bhubaneswar', stdCode: '', number: '' },
      { type: 'landline', city: '', stdCode: '', number: '' },
    ])
  })

  it('defaults a missing/invalid type to "landline" — every entry stored before this field existed carried city/STD semantics', () => {
    expect(parseContactNumbers('[{"city":"Bhubaneswar","stdCode":"0674","number":"+91 2345678"}]')).toEqual([
      { type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '+91 2345678' },
    ])
    expect(parseContactNumbers('[{"type":"carrier-pigeon","city":"x"}]')).toEqual([
      { type: 'landline', city: 'x', stdCode: '', number: '' },
    ])
  })

  it('preserves a valid "mobile" type through parsing', () => {
    expect(parseContactNumbers('[{"type":"mobile","number":"+91 9876543210"}]')).toEqual([
      { type: 'mobile', city: '', stdCode: '', number: '+91 9876543210' },
    ])
  })
})
