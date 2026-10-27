import { describe, expect, it } from 'vitest'
import { hasMember, transcript } from './ContactInfo'
import type { WhatsAppGroupInfo, WhatsAppMessage } from './api'

const group: WhatsAppGroupInfo = { id: 'g@g.us', name: 'DF : SOUTH', participants: [{ id: '917358769276@c.us', number: '917358769276', isAdmin: false }] }

describe('hasMember', () => {
  it('matches by chat id', () => expect(hasMember(group, '917358769276@c.us', null)).toBe(true))
  it('matches a privacy …@lid chat by its phone', () => expect(hasMember(group, '1024@lid', '917358769276')).toBe(true))
  it('rejects someone not in the group', () => expect(hasMember(group, '911111111111@c.us', '911111111111')).toBe(false))
})

describe('transcript', () => {
  it('lists messages oldest first with sender, and names media without a caption', () => {
    const messages = [
      { id: '2', body: '', type: 'document', timestamp: 200, fromMe: true },
      { id: '1', body: 'Thanks', type: 'text', timestamp: 100, fromMe: false },
    ] as WhatsAppMessage[]
    const lines = transcript(messages, (message) => (message.fromMe ? 'You' : 'Vinod')).split('\n')
    expect(lines[0]).toMatch(/Vinod: Thanks$/)
    expect(lines[1]).toMatch(/You: <document>$/)
  })
})
