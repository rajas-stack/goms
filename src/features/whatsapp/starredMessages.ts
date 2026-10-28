import type { WhatsAppChat, WhatsAppMessage } from './api'

export interface StarredMessage { chat: WhatsAppChat; message: WhatsAppMessage }
export const starredKey = (sessionId: string) => ['whatsapp', sessionId, 'starred'] as const
const storageKey = (sessionId: string) => `goms:whatsapp:starred:${sessionId}`

/** WhatsApp's gateway can star messages but cannot list stars. Keep the messages starred here across visits. */
export function readStarred(sessionId: string): StarredMessage[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(sessionId)) ?? '[]')
    return Array.isArray(saved) ? saved.filter((item): item is StarredMessage =>
      item && typeof item.chat?.id === 'string' && typeof item.message?.id === 'string' && typeof item.message?.body === 'string') : []
  } catch { return [] }
}

export function saveStar(sessionId: string, chat: WhatsAppChat, message: WhatsAppMessage, on: boolean): StarredMessage[] {
  const items = readStarred(sessionId).filter((item) => item.chat.id !== chat.id || item.message.id !== message.id)
  // Media bytes are retrieved from WhatsApp when needed, not duplicated in browser storage.
  if (on) items.unshift({ chat, message: { ...message, media: undefined, starred: true } })
  localStorage.setItem(storageKey(sessionId), JSON.stringify(items))
  return items
}
