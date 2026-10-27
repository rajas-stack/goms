import type { WhatsAppLink, WhatsAppTag } from '@/lib/types'
import { chatPhone, formatPhone, MEDIA_TYPES, type WhatsAppChat, type WhatsAppMessage } from './api'

export type LibraryTab = 'Media' | 'Docs' | 'Links' | 'Contacts'
/** A shared contact: WhatsApp's contact message, raw vCard text, or a .vcf / vCard file sent as a document. */
export const isContactCard = (message: WhatsAppMessage) => message.type === 'contact' || message.body.startsWith('BEGIN:VCARD')
  || /\.vcf$/i.test(message.media?.filename ?? '') || /vcard/i.test(message.media?.mimetype ?? '')
export type LibraryGrouping = 'date' | 'opportunity' | 'people' | 'tags'
export interface LibraryItem {
  id: string
  message: WhatsAppMessage
  chat: WhatsAppChat
  sender: string
  personId: string
  opportunities: string[]
  tags: WhatsAppTag[]
  saved?: WhatsAppLink
  url?: string
  tab: LibraryTab
}
export const chatLabel = (chat: WhatsAppChat) => chat.name || chatPhone(chat.id)
export const messageKey = (chatId: string, messageId: string) => JSON.stringify([chatId, messageId])

/** Only web links are actionable; remove sentence punctuation without damaging balanced URL parentheses. */
export function webLinks(body: string): string[] {
  return [...new Set((body.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) ?? []).flatMap((text) => {
    let value = text.replace(/[.,;:!?]+$/, '')
    while (value.endsWith(')') && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1)
    try {
      const url = new URL(value.startsWith('www.') ? `https://${value}` : value)
      return ['http:', 'https:'].includes(url.protocol) ? [url.href] : []
    } catch { return [] }
  }))]
}

/** Merge live history and filed copies, preserving every opportunity when the same message was filed more than once. */
export function libraryItems(chats: WhatsAppChat[], histories: (WhatsAppMessage[] | undefined)[], links: WhatsAppLink[], tags: WhatsAppTag[]): LibraryItem[] {
  const records = new Map<string, { chat: WhatsAppChat; message: WhatsAppMessage; saved?: WhatsAppLink; opportunities: string[] }>()
  chats.forEach((chat, index) => histories[index]?.forEach((message) => records.set(messageKey(chat.id, message.id), { chat, message, opportunities: [] })))
  for (const saved of links) {
    // Filed messages have no session field. Restrict them to this linked account's chats.
    const chat = chats.find((candidate) => candidate.id === saved.chatId)
    if (!chat) continue
    const key = messageKey(saved.chatId, saved.messageId)
    const record = records.get(key) ?? { chat, message: {
      id: saved.messageId, body: saved.body, type: saved.type, timestamp: Date.parse(saved.sentAt) / 1000,
      fromMe: saved.fromMe, senderPhone: saved.senderPhone, contact: { name: saved.senderName },
      media: saved.filename || saved.file ? { filename: saved.filename ?? undefined, mimetype: saved.file?.mimetype ?? '' } : undefined,
    }, opportunities: [] }
    if (!record.opportunities.includes(saved.opportunityId)) record.opportunities.push(saved.opportunityId)
    if (!record.saved || (!record.saved.file && saved.file)) record.saved = saved
    records.set(key, record)
  }
  return [...records.values()].flatMap(({ chat, message, saved, opportunities }) => {
    if (message.type === 'revoked') return []
    const sender = message.fromMe ? 'You' : message.contact?.name || message.contact?.pushName || saved?.senderName
      || (chat.isGroup ? (message.senderPhone ? formatPhone(message.senderPhone) : 'Group member') : chatLabel(chat))
    const personId = message.fromMe ? 'you' : message.senderPhone ? `phone:${message.senderPhone}` : message.author || (chat.isGroup ? `sender:${sender}` : chat.id)
    const base = { message, chat, saved, sender, personId, opportunities, tags: tags.filter((tag) => tag.chatIds.includes(chat.id)) }
    const id = messageKey(chat.id, message.id)
    // A vCard's own URL: lines are part of the card, not links someone shared.
    if (isContactCard(message)) return [{ ...base, id, tab: 'Contacts' as const }]
    const items: LibraryItem[] = MEDIA_TYPES.has(message.type) ? [{ ...base, id, tab: message.type === 'document' ? 'Docs' : 'Media' }] : []
    return [...items, ...webLinks(message.body).map((url) => ({ ...base, id: `${id}:${url}`, url, tab: 'Links' as const }))]
  })
}

export interface LibraryFilters {
  tab: LibraryTab; search: string; opportunity: string; person: string; tagIds: string[]; chat: string
  sentBy: 'all' | 'you' | 'others'; sort: 'newest' | 'oldest' | 'largest'
}
export const itemSize = (item: LibraryItem) => item.message.media?.sizeBytes ?? (item.saved?.file ? Math.floor(item.saved.file.base64.length * 3 / 4) : 0)
export function filterLibrary(items: LibraryItem[], filters: LibraryFilters, opportunityNames: Map<string, string>) {
  const text = filters.search.trim().toLocaleLowerCase()
  return items.filter((item) => item.tab === filters.tab
    && (!filters.opportunity || item.opportunities.includes(filters.opportunity))
    && (!filters.person || item.personId === filters.person)
    && (!filters.chat || item.chat.id === filters.chat)
    && (!filters.tagIds.length || item.tags.some((tag) => filters.tagIds.includes(tag.id)))
    && (filters.sentBy === 'all' || item.message.fromMe === (filters.sentBy === 'you'))
    && (!text || [item.message.body, item.message.media?.filename, item.saved?.filename, item.url, item.sender, chatLabel(item.chat),
      ...item.tags.map((tag) => tag.name), ...item.opportunities.map((id) => opportunityNames.get(id))].some((value) => value?.toLocaleLowerCase().includes(text))))
    .sort((a, b) => filters.sort === 'largest' ? itemSize(b) - itemSize(a) || b.message.timestamp - a.message.timestamp
      : filters.sort === 'oldest' ? a.message.timestamp - b.message.timestamp : b.message.timestamp - a.message.timestamp)
}

export function libraryGroups(items: LibraryItem[], grouping: LibraryGrouping, names: Map<string, string>, now = new Date()) {
  const groups = new Map<string, { title: string; subtitle?: string; items: LibraryItem[] }>()
  const today = new Date(now).setHours(0, 0, 0, 0)
  for (const item of items) {
    const date = new Date(item.message.timestamp * 1000)
    const midnight = new Date(date).setHours(0, 0, 0, 0)
    const days = Math.round((today - midnight) / 86_400_000)
    const dateTitle = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const labels = grouping === 'opportunity' ? (item.opportunities.length ? item.opportunities.map((id) => [id, names.get(id) || 'Opportunity'] as const) : [['unfiled', 'No opportunity']] as const)
      : grouping === 'tags' ? (item.tags.length ? item.tags.map((tag) => [tag.id, tag.name] as const) : [['untagged', 'Untagged']] as const)
        : grouping === 'people' ? [[item.personId, item.sender]] : [[days <= 1 && days >= 0 ? String(midnight) : `${date.getFullYear()}-${date.getMonth()}`, dateTitle]]
    for (const [key, title] of labels) {
      const group = groups.get(key) ?? { title, subtitle: grouping === 'date' && days >= 0 && days <= 1 ? date.toLocaleDateString(undefined, { dateStyle: 'long' }) : undefined, items: [] }
      group.items.push(item)
      groups.set(key, group)
    }
  }
  const entries = [...groups.entries()]
  return grouping === 'date' ? entries : entries.sort((a, b) => a[1].title.localeCompare(b[1].title))
}
