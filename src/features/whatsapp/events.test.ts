import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMessage, isConversationMessage, watchEvents, type PushedMessage } from './events'

class FakeSocket {
  static last: FakeSocket
  sent: string[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) { FakeSocket.last = this }
  send(frame: string) { this.sent.push(frame) }
  close() { this.onclose?.() }
  receive(frame: string) { this.onmessage?.({ data: frame }) }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('watchEvents', () => {
  it('joins /events, subscribes to the session, answers pings, delivers events and reconnects after a drop', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' })
    const events: unknown[] = []
    const states: unknown[] = []
    const stop = watchEvents('s1', ['message.received'], (e) => events.push(e), (s) => states.push(s))
    const first = FakeSocket.last
    expect(first.url).toBe('ws://localhost:5173/openwa/socket.io/?EIO=4&transport=websocket')

    first.receive('0{"sid":"x","pingInterval":25000}')
    first.receive('40/events,{"sid":"y"}')
    first.receive('2')
    expect(first.sent).toEqual(['40/events,', '42/events,["message",{"type":"subscribe","sessionId":"s1","events":["message.received"]}]', '3'])

    first.receive('42/events,["message",{"type":"subscribed","sessionId":"s1"}]')
    first.receive('42/events,["message",{"type":"event","payload":{"event":"message.received","sessionId":"s1","data":{"id":"m1"}}}]')
    first.receive('42/events,["message",{"type":"error","code":"UNAUTHORIZED","message":"API key required"}]')
    expect(events).toEqual([{ event: 'message.received', sessionId: 's1', data: { id: 'm1' } }])
    expect(states).toEqual([{ live: true }, { live: false, error: 'API key required' }])

    first.close()
    vi.advanceTimersByTime(2000)
    expect(FakeSocket.last).not.toBe(first)
    const second = FakeSocket.last
    stop()
    vi.advanceTimersByTime(5000)
    expect(FakeSocket.last).toBe(second) // stopped: no further reconnects
  })
})

const message = (patch: Partial<PushedMessage>): PushedMessage =>
  ({ id: 'm', chatId: 'a@c.us', body: 'hi', type: 'text', timestamp: 200, fromMe: false, ...patch })

describe('applyMessage', () => {
  const chats = [
    { id: 'b@c.us', name: 'B', isGroup: false, unreadCount: 0, timestamp: 150 },
    { id: 'a@c.us', name: 'A', isGroup: false, unreadCount: 1, timestamp: 100, lastMessage: 'old' },
  ]
  it('moves the chat to the top with the new preview and one more unread', () => {
    expect(applyMessage(chats, message({}), null)[0]).toEqual({ id: 'a@c.us', name: 'A', isGroup: false, unreadCount: 2, timestamp: 200, lastMessage: 'hi' })
  })
  it('adds no unread for our own message or the open chat, and shows the type for media', () => {
    expect(applyMessage(chats, message({ fromMe: true, body: '', type: 'image' }), null)[0]).toMatchObject({ unreadCount: 1, lastMessage: 'Photo' })
    expect(applyMessage(chats, message({ body: 'BEGIN:VCARD…', type: 'contact' }), null)[0].lastMessage).toBe('Contact')
    expect(applyMessage(chats, message({}), 'a@c.us')[0].unreadCount).toBe(1)
  })
  it('adds a chat for someone new', () => {
    const next = applyMessage(chats, message({ chatId: 'new@c.us' }), null)
    expect(next).toHaveLength(3)
    expect(next[0]).toMatchObject({ id: 'new@c.us', name: '', unreadCount: 1 })
  })
  it('ignores Status updates', () => {
    expect(isConversationMessage(message({ chatId: 'status@broadcast' }))).toBe(false)
    expect(isConversationMessage(message({ chatId: '120363169975121665@newsletter' }))).toBe(false)
    expect(isConversationMessage(message({ isStatusBroadcast: true }))).toBe(false)
    expect(isConversationMessage(message({}))).toBe(true)
  })
})
