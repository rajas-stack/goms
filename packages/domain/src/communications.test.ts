import { describe, expect, it } from 'vitest'
import { categorizeThread, communicationSearch, matchMailParticipant, parseMailParticipants, threadParticipants, type CommunicationPerson, type CommunicationThread } from './communications.js'
const thread: CommunicationThread = { id: 'thread1', subject: 'Tender', updatedAt: '2026-10-19T10:00:00.000Z', messages: [{ id: 'm1', date: '2026-10-19T10:00:00.000Z', from: [{ name: 'Shamik Joshi', email: 'shamik@amnex.com' }], to: [{ name: 'Me', email: 'me@amnex.com' }], cc: [{ name: 'OEM', email: 'oem@vendor.com' }], sent: false }] }
describe('communication identity and classification', () => {
  it('parses quoted names, encoded Unicode, address casing and duplicate recipients', () => {
    expect(parseMailParticipants('"Joshi, Shamik" <Shamik@Amnex.com>, =?UTF-8?B?Sm9zw6k=?= <jose@example.com>; shamik@amnex.com')).toEqual([{ name: 'Joshi, Shamik', email: 'shamik@amnex.com' }, { name: 'José', email: 'jose@example.com' }])
    expect(parseMailParticipants('=?utf-8?Q?Shamik_Joshi?= <shamik@amnex.com>')[0].name).toBe('Shamik Joshi')
    expect(parseMailParticipants('malformed, <not-an-email>, recipient@example.com')).toEqual([{ name: '', email: 'recipient@example.com' }])
  })
  it('deduplicates participants across messages and To/Cc while keeping a display name', () => {
    const copy = structuredClone(thread); copy.messages.push({ ...copy.messages[0], id: 'm2', from: [{ email: 'SHAMIK@AMNEX.COM', name: '' }] })
    expect(threadParticipants(copy)).toHaveLength(3)
    expect(threadParticipants(copy)[0]).toEqual({ name: 'Shamik Joshi', email: 'shamik@amnex.com' })
  })
  it('suggests a name-only employee but never treats it as an email identity match', () => {
    const directory: CommunicationPerson[] = [{ id: 'org1', name: 'Shamik Joshi', email: '', source: 'org', party: 'internal' }]
    expect(matchMailParticipant(thread.messages[0].from[0], directory)).toEqual({ exact: [], suggestions: directory })
    expect(categorizeThread(thread, directory, 'me@amnex.com')).toEqual(['unknown'])
    expect(directory[0].email).toBe('')
  })
  it('categorizes mixed parties using exact master email matches and leaves unknown domains unclassified', () => {
    const directory: CommunicationPerson[] = [
      { id: 'd1', name: 'Shamik', email: 'SHAMIK@AMNEX.COM', source: 'delivery', party: 'delivery' },
      { id: 'c1', name: 'OEM', email: 'oem@vendor.com', source: 'contact', party: 'oem' },
    ]
    expect(categorizeThread(thread, directory, 'me@amnex.com')).toEqual(['delivery', 'oem'])
    expect(categorizeThread(thread, [], 'me@amnex.com')).toEqual(['unknown'])
  })
  it('does not classify an unreadable sender as internal', () => {
    expect(categorizeThread({ ...thread, messages: [{ ...thread.messages[0], from: [], to: [], cc: [] }] }, [], 'me@amnex.com')).toEqual(['unknown'])
  })
  it('quotes opportunity identity literally and avoids a broad search when no identity is available', () => {
    expect(communicationSearch(['GEM/2026/1', 'GEM/2026/1', 'Smart bus'])).toBe('{"GEM/2026/1" "Smart bus"} -in:spam -in:trash -is:draft')
    expect(communicationSearch(['x" OR from:other@example.com\n'])).toBe('{"x  OR from:other@example.com"} -in:spam -in:trash -is:draft')
    expect(communicationSearch([null, '', undefined])).toBe('')
  })
})
