import { describe, expect, it } from 'vitest'
import { parseContactNumbers, serializeContactNumbers, type ContactNumberEntry } from './contact-numbers'

describe('contact-numbers serialize/parse helper', () => {
  it('round-trips a list of entries', () => {
    const entries: ContactNumberEntry[] = [
      { type: 'landline', stateNodeId: 'state-1', districtNodeId: 'dist-1', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
      { type: 'mobile', stateNodeId: 'state-1', districtNodeId: '', city: '', stdCode: '', number: '+91 9876543210' },
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
      { type: 'landline', stateNodeId: '', districtNodeId: '', city: 'Bhubaneswar', stdCode: '', number: '' },
      { type: 'landline', stateNodeId: '', districtNodeId: '', city: '', stdCode: '', number: '' },
    ])
  })

  it('defaults a missing `type` key to "landline" (predates the field) but an explicit unrecognized value to "" (not yet chosen)', () => {
    expect(parseContactNumbers('[{"city":"Bhubaneswar","stdCode":"0674","number":"2345678"}]')).toEqual([
      { type: 'landline', stateNodeId: '', districtNodeId: '', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
    ])
    expect(parseContactNumbers('[{"type":"carrier-pigeon","city":"x"}]')).toEqual([
      { type: '', stateNodeId: '', districtNodeId: '', city: 'x', stdCode: '', number: '' },
    ])
    expect(parseContactNumbers('[{"type":""}]')).toEqual([
      { type: '', stateNodeId: '', districtNodeId: '', city: '', stdCode: '', number: '' },
    ])
  })

  it('preserves a valid "mobile" type through parsing', () => {
    expect(parseContactNumbers('[{"type":"mobile","number":"+91 9876543210"}]')).toEqual([
      { type: 'mobile', stateNodeId: '', districtNodeId: '', city: '', stdCode: '', number: '+91 9876543210' },
    ])
  })

  describe('legacy State/District fallback', () => {
    it("an entry with its own stateNodeId/districtNodeId ignores the legacy fallback", () => {
      const raw = serializeContactNumbers([
        { type: 'landline', stateNodeId: 'state-own', districtNodeId: 'dist-own', city: 'X', stdCode: '', number: '' },
      ])
      expect(parseContactNumbers(raw, 'state-legacy', 'dist-legacy')).toEqual([
        { type: 'landline', stateNodeId: 'state-own', districtNodeId: 'dist-own', city: 'X', stdCode: '', number: '' },
      ])
    })

    it('an entry predating per-row geography (no stateNodeId/districtNodeId keys at all) inherits the legacy section-level ids', () => {
      expect(parseContactNumbers('[{"city":"Bhubaneswar","stdCode":"0674","number":"2345678"}]', 'state-legacy', 'dist-legacy')).toEqual([
        { type: 'landline', stateNodeId: 'state-legacy', districtNodeId: 'dist-legacy', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
      ])
    })

    it('with no legacy fallback available either, falls back to "" (same as a brand-new row)', () => {
      expect(parseContactNumbers('[{"city":"Bhubaneswar"}]')).toEqual([
        { type: 'landline', stateNodeId: '', districtNodeId: '', city: 'Bhubaneswar', stdCode: '', number: '' },
      ])
    })
  })
})
