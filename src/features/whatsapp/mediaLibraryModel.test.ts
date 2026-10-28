import { describe, expect, it } from 'vitest'
import type { WhatsAppLink, WhatsAppTag } from '@/lib/types'
import type { WhatsAppChat, WhatsAppMessage } from './api'
import { filterLibrary, libraryGroups, libraryItems, webLinks, type LibraryFilters } from './mediaLibraryModel'

const chats: WhatsAppChat[] = [
  { id: 'a@c.us', name: 'Asha', isGroup: false, timestamp: 1, unreadCount: 0 },
  { id: 'sales@g.us', name: 'Sales team', isGroup: true, timestamp: 1, unreadCount: 0 },
]
const message: WhatsAppMessage = { id: 'm1', body: 'Tender https://example.com/tender', type: 'document', fromMe: false, timestamp: 100, media: { filename: 'BOQ.xlsx', mimetype: 'application/xlsx', sizeBytes: 20 } }
const saved: WhatsAppLink = { id: 'l1', opportunityId: 'o1', bidId: 'b1', chatId: chats[0].id, chatName: 'Asha', messageId: 'm1', fromMe: false, senderName: 'Asha', senderPhone: null, type: 'document', body: message.body, filename: 'BOQ.xlsx', sentAt: new Date(100_000).toISOString(), addedAt: '', addedBy: 'You' }
const tags: WhatsAppTag[] = [{ id: 't1', name: 'Sales', chatIds: [chats[0].id] }, { id: 't2', name: 'CXO', chatIds: [chats[0].id, chats[1].id] }]
const names = new Map([['o1', 'Smart City'], ['o2', 'Transit']])
const filters: LibraryFilters = { tab: 'Docs', search: '', opportunity: '', person: '', tagIds: [], chat: '', sentBy: 'all', sort: 'newest' }

describe('WhatsApp media library', () => {
  it('files contact cards (WhatsApp contacts, raw vCard text, .vcf documents) under Contacts, not Links or Docs', () => {
    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Railtel Anoop\nURL:https://railtel.in\nEND:VCARD'
    const items = libraryItems(chats, [[
      { ...message, id: 'c1', type: 'contact', body: vcard, media: undefined },
      { ...message, id: 'c2', type: 'text', body: vcard, media: undefined },
      { ...message, id: 'c3', body: '', media: { filename: 'Anoop.vcf', mimetype: 'text/x-vcard' } },
    ], []], [], tags)
    expect(items.map((item) => item.tab)).toEqual(['Contacts', 'Contacts', 'Contacts'])
  })
  it('merges filed copies with history once, keeps all opportunities, and includes older saved attachments', () => {
    const items = libraryItems(chats, [[message], []], [saved, { ...saved, id: 'l2', opportunityId: 'o2' }, { ...saved, id: 'old', messageId: 'older', body: '' }], tags)
    expect(items.filter((item) => item.tab === 'Docs')).toHaveLength(2)
    expect(items[0].opportunities).toEqual(['o1', 'o2'])
    expect(items.filter((item) => item.tab === 'Links')).toHaveLength(1)
    expect(libraryGroups(items.filter((item) => item.tab === 'Docs'), 'opportunity', names).map(([, group]) => [group.title, group.items.length])).toEqual([['Smart City', 2], ['Transit', 1]])
  })
  it('combines opportunity, person, tag, sender, chat and search filters without changing the view', () => {
    const items = libraryItems(chats, [[message, { ...message, id: 'm2', fromMe: true, timestamp: 200 }], []], [saved], tags)
    expect(filterLibrary(items, { ...filters, opportunity: 'o1', tagIds: ['t1'], person: 'a@c.us', search: 'smart city', sentBy: 'others', chat: chats[0].id }, names)).toHaveLength(1)
    expect(filterLibrary(items, { ...filters, opportunity: 'o1', person: 'you' }, names)).toHaveLength(0)
    expect(filterLibrary(items, { ...filters, sentBy: 'you' }, names)[0].message.id).toBe('m2')
    expect(filterLibrary(items, { ...filters, sort: 'oldest' }, names).map((item) => item.message.id)).toEqual(['m1', 'm2'])
  })
  it('groups a sender across chats, supports multiple tags, and keeps unfiled attachments visible', () => {
    const items = libraryItems(chats, [[message], [{ ...message, id: 'm3', senderPhone: '123', author: '123@c.us', contact: { name: 'Rahul' } }]], [], tags)
    expect(libraryGroups(items.filter((item) => item.tab === 'Docs'), 'people', names).map(([, group]) => group.title)).toEqual(['Asha', 'Rahul'])
    expect(libraryGroups(items.filter((item) => item.tab === 'Docs'), 'tags', names).map(([, group]) => [group.title, group.items.length])).toEqual([['CXO', 2], ['Sales', 1]])
    expect(libraryGroups(items.filter((item) => item.tab === 'Docs'), 'opportunity', names)[0][1].title).toBe('No opportunity')
  })
  it('excludes revoked media and filed copies from another linked account', () => {
    expect(libraryItems(chats, [[{ ...message, type: 'revoked' }], []], [{ ...saved, chatId: 'other-account@c.us' }], tags)).toEqual([])
  })
  it('deduplicates web links, trims sentence punctuation, preserves balanced parentheses and rejects other schemes', () => {
    expect(webLinks('See https://example.com/a_(b). https://example.com/a_(b) www.example.org/page! javascript:alert(1)')).toEqual(['https://example.com/a_(b)', 'https://www.example.org/page'])
  })
})
