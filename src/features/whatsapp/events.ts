import type { WhatsAppChat, WhatsAppMessage } from './api'

export interface WhatsAppEvent { event: string; sessionId: string; data: unknown }
export type LiveState = { live: boolean; error?: string }

/** A message as the gateway pushes it (message.received / message.sent). */
export type PushedMessage = WhatsAppMessage & { chatId: string; isGroup?: boolean; isStatusBroadcast?: boolean; kind?: string }

const NS = '/events'
const RECONNECT_MS = 2000

/** OpenWA pushes events on its socket.io namespace `/events`. This speaks that protocol (Engine.IO 4 / Socket.IO 5 text frames)
 *  over the browser's WebSocket instead of adding a client library; the `/openwa` proxy adds the API key to the handshake.
 *  Reconnects 2 s after any drop. Returns a function that closes it for good. */
export function watchEvents(sessionId: string, events: readonly string[], onEvent: (event: WhatsAppEvent) => void, onState: (state: LiveState) => void): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/openwa/socket.io/?EIO=4&transport=websocket`)
    socket = ws
    ws.onmessage = ({ data }) => {
      const frame = String(data)
      if (frame === '2') return ws.send('3') // Engine.IO ping -> pong
      if (frame.startsWith('0')) return ws.send(`40${NS},`) // transport open -> join the namespace
      if (frame.startsWith(`40${NS}`)) return ws.send(`42${NS},${JSON.stringify(['message', { type: 'subscribe', sessionId, events }])}`)
      if (frame.startsWith(`44${NS}`)) return onState({ live: false, error: 'The live connection was refused.' })
      if (!frame.startsWith(`42${NS},`)) return
      const [, message] = JSON.parse(frame.slice(`42${NS},`.length)) as [string, { type?: string; message?: string; payload?: WhatsAppEvent }]
      if (message?.type === 'subscribed') onState({ live: true })
      else if (message?.type === 'event' && message.payload) onEvent(message.payload)
      else if (message?.type === 'error') onState({ live: false, error: message.message ?? 'The live connection reported an error.' })
    }
    ws.onclose = () => {
      if (stopped) return
      onState({ live: false })
      retry = setTimeout(open, RECONNECT_MS)
    }
  }
  open()
  return () => { stopped = true; clearTimeout(retry); socket?.close() }
}

/** Status updates and Channel posts (`…@newsletter`, e.g. a brand's channel the phone follows) are not chats; WhatsApp keeps both
 *  under Updates. */
export const isConversationMessage = (message: PushedMessage) =>
  !message.isStatusBroadcast && message.kind !== 'status' && message.chatId !== 'status@broadcast' && !message.chatId.endsWith('@newsletter')

const PREVIEW: Record<string, string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', voice: 'Voice message', document: 'Document', sticker: 'Sticker', location: 'Location', contact: 'Contact',
}

/** The chat list after a pushed message: its chat moves to the top with the new preview, and gains an unread unless it was sent
 *  by us or is the open chat. A first message from someone new adds their chat. */
export function applyMessage(chats: WhatsAppChat[], message: PushedMessage, openChatId: string | null): WhatsAppChat[] {
  const existing = chats.find((chat) => chat.id === message.chatId)
  const unread = message.fromMe || message.chatId === openChatId ? 0 : 1
  const updated: WhatsAppChat = {
    ...(existing ?? { id: message.chatId, name: '', isGroup: !!message.isGroup, unreadCount: 0 }),
    timestamp: message.timestamp,
    // A contact's body is its whole vCard; a document's is its file name.
    lastMessage: (message.type !== 'contact' && message.body) || PREVIEW[message.type] || message.type,
    unreadCount: (existing?.unreadCount ?? 0) + unread,
  }
  return [updated, ...chats.filter((chat) => chat.id !== message.chatId)]
}
