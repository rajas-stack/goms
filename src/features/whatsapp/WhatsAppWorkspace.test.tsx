import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as XLSX from 'xlsx'
import { ToastProvider } from '@/components/ui/Toast'
import { repository, resetLocalData } from '@/data/repository'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ configured: true, user: { email: 'Shubham.Mehra@amnex.com' } as { email: string } | null }))
vi.mock('@/lib/auth', () => ({
  authApi: { get configured() { return auth.configured } },
  useAuthUser: () => ({ user: auth.user, loading: false }),
}))
import { shortWhen, WhatsAppWorkspace } from './WhatsAppWorkspace'
import { LOCAL_SESSION, sessionName } from './api'

const NAME = sessionName('shubham.mehra@amnex.com')

/** The live stream: records the latest socket so a test can push gateway frames through it. */
class FakeSocket {
  static last: FakeSocket | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() { FakeSocket.last = this }
  send() {}
  close() {}
  push(event: string, data: object) {
    for (const frame of ['0{}', '40/events,{}', '42/events,["message",{"type":"subscribed"}]',
      `42/events,${JSON.stringify(['message', { type: 'event', payload: { event, sessionId: 's1', data } }])}`]) this.onmessage?.({ data: frame })
  }
}

/** A fake OpenWA behind the `/openwa` proxy: answers by method + path, records every call. */
function gateway(routes: Record<string, (body: any) => unknown>) {
  const calls: string[] = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('/openwa/api', '')}`
    const idempotency = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key']
    const json = typeof init?.body === 'string' ? init.body : undefined
    calls.push(key + (json ? ` ${json}` : init?.body instanceof FormData ? ` file=${(init.body.get('files') as File).name}` : '') + (idempotency ? ` key=${idempotency}` : ''))
    const route = routes[key] ?? (key.includes('/contacts/profile-pictures?') ? () => ({ pictures: {} }) : undefined)
    if (!route) return new Response(JSON.stringify({ message: `unexpected ${key}` }), { status: 404 })
    const result = await route(json && JSON.parse(json))
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 })
  }))
  return calls
}

const page = (entry = '/whatsapp') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[entry]}><WhatsAppWorkspace /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
)

const READY = { id: 's1', name: NAME, status: 'ready', phone: '919800000000', pushName: 'Shubham' }
const ASHA = { id: '919811111111@c.us', name: 'Asha Rao', isGroup: false, unreadCount: 0, timestamp: 1700000000, lastMessage: 'See you' }
const ASHA_HISTORY = 'GET /sessions/s1/messages/919811111111%40c.us/history?limit=50'

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.last = null
  Object.assign(auth, { configured: true, user: { email: 'Shubham.Mehra@amnex.com' } })
})

describe('shortWhen', () => {
  const now = new Date(2026, 9, 26, 21, 0) // Mon 26 Oct 2026, 9 pm local
  const at = (...parts: [number, number, number, number, number]) => new Date(...parts).getTime() / 1000
  it('shows the time today, then Yesterday, the weekday this week, else the date', () => {
    expect(shortWhen(at(2026, 9, 26, 9, 7), now)).toMatch(/9.07/)
    expect(shortWhen(at(2026, 9, 25, 23, 59), now)).toBe('Yesterday')
    expect(shortWhen(at(2026, 9, 22, 10, 0), now)).toBe(new Date(2026, 9, 22).toLocaleDateString(undefined, { weekday: 'short' }))
    expect(shortWhen(at(2026, 8, 1, 10, 0), now)).toBe(new Date(2026, 8, 1).toLocaleDateString(undefined, { dateStyle: 'short' }))
  })
})

describe('WhatsAppWorkspace', () => {
  it('opens the Media popup from its direct link after the account becomes ready', async () => {
    gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => [],
    })
    page('/whatsapp?media=1')
    const library = await screen.findByRole('dialog', { name: 'Media library' })
    expect(within(library).getByRole('tab', { name: /Media/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(library).getByRole('button', { name: 'Close media library' }))
    expect(screen.queryByRole('dialog', { name: 'Media library' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Media' }))
    expect(await screen.findByRole('dialog', { name: 'Media library' })).toBeInTheDocument()
  })

  it("links the signed-in user's own session: Connect creates and starts it, then shows the QR code with progress", async () => {
    let session: object | null = null
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => (session ? [session] : []),
      'POST /sessions': ({ name }) => (session = { id: 's1', name, status: 'created' }),
      'POST /sessions/s1/start': () => (session = { id: 's1', name: NAME, status: 'qr_ready' }),
      'GET /sessions/s1/qr': () => ({ qrCode: 'data:image/png;base64,QR', status: 'qr_ready' }),
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /connect whatsapp/i }))
    expect(await screen.findByAltText('WhatsApp link code')).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(screen.getByRole('progressbar', { name: 'Scan code' })).toBeInTheDocument()
    expect(calls).toContain(`POST /sessions {"name":"${NAME}"}`)
  })

  it('in a build without sign-in (local 5173) links this computer’s WhatsApp right on the page instead of asking to sign in', async () => {
    Object.assign(auth, { configured: false, user: null })
    let session: object | null = null
    const calls = gateway({
      [`GET /sessions?name=${LOCAL_SESSION}`]: () => (session ? [session] : []),
      'POST /sessions': ({ name }) => (session = { id: 'l1', name, status: 'created' }),
      'POST /sessions/l1/start': () => (session = { id: 'l1', name: LOCAL_SESSION, status: 'qr_ready' }),
      'GET /sessions/l1/qr': () => ({ qrCode: 'data:image/png;base64,LOCAL', status: 'qr_ready' }),
    })
    page()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /connect whatsapp/i }))
    expect(await screen.findByAltText('WhatsApp link code')).toHaveAttribute('src', 'data:image/png;base64,LOCAL')
    expect(calls).toContain(`POST /sessions {"name":"${LOCAL_SESSION}"}`)
  })

  it('tells a linked phone that is reconnecting that no new scan is needed', async () => {
    gateway({ [`GET /sessions?name=${NAME}`]: () => [{ ...READY, status: 'initializing' }] })
    page()
    expect(await screen.findByText('Reconnecting to WhatsApp…')).toBeInTheDocument()
    expect(screen.getByText(/no new scan is needed/i)).toBeInTheDocument()
  })

  it('lists conversations once linked and opens one', async () => {
    gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => [
        { id: 'm1', body: 'Hello', type: 'text', timestamp: 1700000000, fromMe: false },
        { id: 'm2', body: 'See you', type: 'text', timestamp: 1700000100, fromMe: true },
      ],
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Conversation with Asha Rao' })).toHaveTextContent('See you')
  })

  it('shows a pushed message at once, in the chat list and the open conversation, without re-reading either', async () => {
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => [{ id: 'm1', body: 'Hello', type: 'text', timestamp: 1700000000, fromMe: false }],
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
    await screen.findByText('Hello')
    act(() => FakeSocket.last!.push('message.received', { id: 'm3', chatId: ASHA.id, body: 'Are you free?', type: 'text', timestamp: 1700000200, fromMe: false }))
    expect(within(screen.getByRole('region', { name: 'Conversation with Asha Rao' })).getByText('Are you free?')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Conversations' })).getByText('Are you free?')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(calls.filter((call) => call.includes('/chats') || call.includes('/history'))).toHaveLength(2)
  })

  it('sends what you write: Enter sends, it shows at once as "Sending…", then as sent, and the box clears', async () => {
    let accept: () => void = () => {}
    const accepted = new Promise<void>((resolve) => { accept = resolve })
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => [{ id: 'm1', body: 'Hello', type: 'text', timestamp: 1700000000, fromMe: false }],
      'POST /sessions/s1/messages/send-text': () => accepted.then(() => ({ messageId: 'true_919811111111@c.us_SENT1', timestamp: 1700000300 })),
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'On my way{Shift>}{Enter}{/Shift}see you{Enter}')
    const conversation = screen.getByRole('region', { name: 'Conversation with Asha Rao' })
    expect(box).toHaveValue('')
    expect(await within(conversation).findByText('Sending…')).toBeInTheDocument()
    await act(async () => accept())
    await waitFor(() => expect(within(conversation).queryByText('Sending…')).not.toBeInTheDocument())
    expect(within(conversation).getByText(/On my way\s+see you/)).toBeInTheDocument()
    expect(calls.find((call) => call.startsWith('POST /sessions/s1/messages/send-text')))
      .toMatch(/^POST \/sessions\/s1\/messages\/send-text \{"chatId":"919811111111@c.us","text":"On my way\\nsee you"\} key=\S+$/)
    // The live stream's copy of the same message is not shown twice.
    act(() => FakeSocket.last!.push('message.sent', { id: 'true_919811111111@c.us_SENT1', chatId: ASHA.id, body: 'On my way\nsee you', type: 'text', timestamp: 1700000300, fromMe: true }))
    expect(within(conversation).getAllByText(/On my way\s+see you/)).toHaveLength(1)
  })

  it('puts the text back when sending fails, and a retry reuses the same key so it can never send twice', async () => {
    let fail = true
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => [],
      'POST /sessions/s1/messages/send-text': () => (fail
        ? new Response(JSON.stringify({ message: 'The session is not connected.' }), { status: 409 })
        : { messageId: 'true_919811111111@c.us_SENT2', timestamp: 1700000400 }),
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'Hello?{Enter}')
    expect(await screen.findByText(/Not sent: The session is not connected\./)).toBeInTheDocument()
    expect(box).toHaveValue('Hello?')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await within(screen.getByRole('region', { name: 'Conversation with Asha Rao' })).findByText('Hello?')).toBeInTheDocument()
    const keys = calls.filter((call) => call.startsWith('POST /sessions/s1/messages/send-text')).map((call) => call.split(' key=')[1])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  describe('message menu (right-click)', () => {
    const RAHUL = { id: '919822222222@c.us', name: 'Rahul Mehta', isGroup: false, unreadCount: 0, timestamp: 1699990000, lastMessage: 'Noted' }
    const MESSAGE = { id: 'm1', body: 'Please send the BOQ', type: 'text', timestamp: 1700000000, fromMe: false }
    const ok = () => ({ success: true })
    const routes = () => ({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA, RAHUL],
      [ASHA_HISTORY]: () => [MESSAGE],
      'POST /sessions/s1/messages/react': ok, 'POST /sessions/s1/messages/pin': ok, 'POST /sessions/s1/messages/unpin': ok,
      'POST /sessions/s1/messages/star': ok, 'POST /sessions/s1/messages/delete': ok,
      'POST /sessions/s1/messages/forward': () => ({ messageId: 'f1', timestamp: 1700000500 }),
      'POST /sessions/s1/messages/send-text': () => ({ messageId: 'r1', timestamp: 1700000600 }),
    })
    const openMenu = async () => {
      page()
      await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
      fireEvent.contextMenu(await screen.findByText(MESSAGE.body))
      return screen.findByRole('menu', { name: 'Message options' })
    }
    const pick = async (label: string) => userEvent.click(within(await screen.findByRole('menu', { name: 'Message options' })).getByRole('menuitem', { name: label }))
    const posted = (calls: string[], action: string) => calls.filter((call) => call.startsWith(`POST /sessions/s1/messages/${action} `))

    it("offers WhatsApp's actions without Ask Meta AI or Report, and Copy confirms with a toast", async () => {
      gateway(routes())
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      const menu = await openMenu()
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent))
        .toEqual(['Reply', 'Copy', 'React', 'Forward', 'Pin', 'Star', 'Add to opportunity', 'Delete'])
      expect(within(menu).getAllByRole('button', { name: /^React / })).toHaveLength(6)
      await pick('Copy')
      expect(writeText).toHaveBeenCalledWith('Please send the BOQ')
      expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
    })

    it('reacts from the quick row, and the same emoji again takes the reaction back', async () => {
      const calls = gateway(routes())
      const menu = await openMenu()
      await userEvent.click(within(menu).getByRole('button', { name: 'React 👍' }))
      expect(await screen.findByLabelText('Your reaction 👍')).toBeInTheDocument()
      expect(await screen.findByText('Reacted 👍')).toBeInTheDocument()
      fireEvent.contextMenu(screen.getByText(MESSAGE.body))
      await userEvent.click(within(await screen.findByRole('menu', { name: 'Message options' })).getByRole('button', { name: 'React 👍' }))
      await waitFor(() => expect(screen.queryByLabelText('Your reaction 👍')).not.toBeInTheDocument())
      expect(posted(calls, 'react').map((call) => JSON.parse(call.split(' ').slice(2).join(' ')).emoji)).toEqual(['👍', ''])
    })

    it('pins for the chosen length (with Undo), stars, and deletes for me', async () => {
      const calls = gateway(routes())
      await openMenu()
      await pick('Pin')
      await userEvent.click(await screen.findByLabelText('30 days'))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pin' }))
      expect(await screen.findByText('Pinned for 30 days')).toBeInTheDocument()
      expect(posted(calls, 'pin')[0]).toContain('"durationSeconds":2592000')
      expect(screen.getByLabelText('Pinned')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(posted(calls, 'unpin')).toHaveLength(1))

      fireEvent.contextMenu(screen.getByText(MESSAGE.body))
      await pick('Star')
      expect(await screen.findByText('Starred')).toBeInTheDocument()
      expect(posted(calls, 'star')[0]).toContain('"star":true')

      fireEvent.contextMenu(screen.getByText(MESSAGE.body))
      await pick('Delete')
      const confirm = await screen.findByRole('dialog', { name: 'Delete message?' })
      expect(within(confirm).queryByRole('button', { name: 'Delete for everyone' })).not.toBeInTheDocument() // not our message
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete for me' }))
      expect(await screen.findByText('Deleted for you')).toBeInTheDocument()
      expect(screen.queryByText(MESSAGE.body)).not.toBeInTheDocument()
      expect(posted(calls, 'delete')[0]).toContain('"forEveryone":false')
    })

    it('replies with a quote, and forwards to another chat', async () => {
      const calls = gateway(routes())
      await openMenu()
      await pick('Reply')
      expect(await screen.findByText('Replying to this message')).toBeInTheDocument()
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Sending today{Enter}')
      await waitFor(() => expect(posted(calls, 'send-text')[0]).toContain('"quotedMessageId":"m1"'))
      expect(screen.queryByText('Replying to this message')).not.toBeInTheDocument()
      // The reply shows its quote with the quoted author, as WhatsApp does.
      expect(await screen.findByRole('button', { name: 'Go to the quoted message from Asha Rao' })).toHaveTextContent('Please send the BOQ')

      // The original (the quote repeats its text) is the last match: the list is newest first.
      fireEvent.contextMenu(screen.getAllByText(MESSAGE.body).slice(-1)[0])
      await pick('Forward')
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Forward message to' })).getByRole('button', { name: /rahul mehta/i }))
      expect(await screen.findByText('Forwarded to Rahul Mehta')).toBeInTheDocument()
      expect(posted(calls, 'forward')[0]).toContain('"fromChatId":"919811111111@c.us","toChatId":"919822222222@c.us","messageId":"m1"')
    })

    it('adds the message to an opportunity picked from the sheets, with its sender and time, once', async () => {
      await resetLocalData()
      const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart City BOQ', submissionDate: '2099-01-15' })
      const bid = await repository.createBid(opportunity.id)
      gateway(routes())
      await openMenu()
      await pick('Add to opportunity')
      const picker = await screen.findByRole('dialog', { name: 'Add to opportunity' })
      await userEvent.click(within(picker).getByRole('tab', { name: /Live Bids/ }))
      await userEvent.click(await within(picker).findByRole('button', { name: /Smart City BOQ/ }))
      expect(await screen.findByText('Added to Smart City BOQ')).toBeInTheDocument()
      expect(await repository.listWhatsAppLinks(opportunity.id)).toEqual([expect.objectContaining({
        bidId: bid.id, chatId: ASHA.id, chatName: 'Asha Rao', messageId: 'm1', fromMe: false, senderName: 'Asha Rao',
        senderPhone: '919811111111', type: 'text', body: 'Please send the BOQ', sentAt: new Date(1700000000 * 1000).toISOString(),
      })])

      fireEvent.contextMenu(screen.getByText(MESSAGE.body))
      await pick('Add to opportunity')
      await userEvent.click(await within(await screen.findByRole('dialog', { name: 'Add to opportunity' })).findByRole('button', { name: /Smart City BOQ/ }))
      expect(await screen.findByText('Already in Smart City BOQ')).toBeInTheDocument()
      expect(await repository.listWhatsAppLinks(opportunity.id)).toHaveLength(1)
    })
  })

  describe('attachments', () => {
    const PNG = 'iVBORw0KGgo=' // a few bytes of base64; jsdom never decodes them as an image
    const at = (seconds: number) => 1700000000 + seconds
    const media = (id: string, type: string, extra: object = {}) => ({ id, type, body: '', timestamp: at(Number(id.slice(1))), fromMe: false, ...extra })
    const history = [
      media('m1', 'image', { body: 'Site photo' }), media('m2', 'image'),
      media('m3', 'document', { body: 'BOQ.xlsx' }), media('m4', 'document', { body: 'Tender.pdf' }),
      media('m5', 'document', { body: 'Huge.pdf' }), media('m6', 'video'),
      media('m7', 'contact', { body: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Rahul Mehta\r\nTEL:+91 98111 22222\r\nEND:VCARD' }),
      media('m8', 'location', { location: { latitude: 23.03, longitude: 72.58 } }),
    ]
    // A real workbook, so the preview has something to read.
    const XLSX_BOQ = XLSX.write({ SheetNames: ['Rates', 'Notes'], Sheets: {
      Rates: XLSX.utils.aoa_to_sheet([['Item', 'Qty'], ['Cable', 12]]), Notes: XLSX.utils.aoa_to_sheet([['Draft']]),
    } }, { type: 'base64', bookType: 'xlsx' })
    const files = [
      { ...history[0], media: { mimetype: 'image/png', data: PNG } },
      { ...history[1], media: { mimetype: 'image/png', data: PNG } },
      { ...history[2], media: { mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'BOQ.xlsx', data: XLSX_BOQ, sizeBytes: 9216 } },
      { ...history[3], media: { mimetype: 'application/pdf', filename: 'Tender.pdf', data: PNG, sizeBytes: 4096 } },
      { ...history[4], media: { mimetype: 'application/pdf', filename: 'Huge.pdf', omitted: true, sizeBytes: 159_000_000 } },
      { ...history[5], media: { mimetype: 'video/mp4', omitted: true, sizeBytes: 2_000_000 } },
    ]
    const routes = () => ({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      [ASHA_HISTORY]: () => history,
      'GET /sessions/s1/messages/919811111111%40c.us/history?limit=50&includeMedia=true': () => files,
      'POST /doc-preview/forms/libreoffice/convert': () => new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { status: 200 }),
    })
    const openChat = async () => {
      // jsdom has no object URLs; only these two are added, URL itself stays the real constructor.
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
      page()
      await userEvent.click(await screen.findByRole('button', { name: /asha rao/i }))
      return screen.findByRole('region', { name: 'Conversation with Asha Rao' })
    }

    it('shows photos in the chat and opens them in a viewer with next/previous, download and Escape', async () => {
      gateway(routes())
      const conversation = await openChat()
      await userEvent.click(await within(conversation).findByRole('button', { name: 'Open Site photo' }))
      const viewer = await screen.findByRole('dialog', { name: 'Photo viewer' })
      expect(within(viewer).getByRole('link', { name: 'Download' })).toHaveAttribute('download', expect.stringMatching(/^WhatsApp image .+\.png$/))
      expect(within(viewer).getByText('Site photo')).toBeInTheDocument()
      await userEvent.click(within(viewer).getByRole('button', { name: 'Next photo' }))
      expect(within(viewer).getByRole('button', { name: 'Photo 2 of 2' })).toHaveAttribute('aria-current', 'true')
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Photo viewer' })).not.toBeInTheDocument()
    })

    it('opens an Excel file as a spreadsheet with its sheets, and a PDF directly, without converting either', async () => {
      const calls = gateway(routes())
      const conversation = await openChat()
      expect(await within(conversation).findByText('BOQ.xlsx')).toBeInTheDocument()
      expect(within(conversation).getByText(/^XLSX · \d+ KB$/)).toBeInTheDocument() // the real byte size of the file
      const previewOf = (name: string) => within(within(conversation).getByText(name).closest('li')!).getByRole('button', { name: 'Preview' })
      await userEvent.click(previewOf('BOQ.xlsx'))
      const preview = await screen.findByRole('dialog', { name: 'Preview of BOQ.xlsx' })
      const sheet = await within(preview).findByRole('table', { name: 'Sheet Rates' })
      expect(within(sheet).getByText('Cable')).toBeInTheDocument()
      await userEvent.click(within(preview).getByRole('tab', { name: 'Notes' }))
      expect(within(await within(preview).findByRole('table', { name: 'Sheet Notes' })).getByText('Draft')).toBeInTheDocument()
      await userEvent.click(within(preview).getByRole('button', { name: 'Close' }))
      await userEvent.click(previewOf('Tender.pdf'))
      expect(await within(await screen.findByRole('dialog', { name: 'Preview of Tender.pdf' })).findByTitle('Tender.pdf')).toBeInTheDocument()
      expect(calls.filter((call) => call.includes('doc-preview'))).toHaveLength(0)
    })

    it('says why a file cannot be shown, and shows contact cards and locations', async () => {
      gateway(routes())
      const conversation = await openChat()
      expect(await within(conversation).findByText('Too large to open here (151.6 MB)')).toBeInTheDocument()
      expect(within(conversation).getByText('This video is not available here')).toBeInTheDocument()
      expect(within(conversation).getByText('Rahul Mehta')).toBeInTheDocument()
      expect(within(conversation).getByRole('link', { name: 'Save contact' })).toHaveAttribute('download', 'Rahul Mehta.vcf')
      expect(within(conversation).getByTitle('Shared location')).toHaveAttribute('src', expect.stringContaining('marker=23.03,72.58'))
      expect(within(conversation).getByRole('link', { name: /open in google maps/i })).toHaveAttribute('href', expect.stringContaining('query=23.03,72.58'))
    })
  })

  it('shows WhatsApp profile photos, fetched for the whole list in one batch', async () => {
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      'GET /sessions/s1/contacts/profile-pictures?ids=919800000000%40c.us,919811111111%40c.us': () =>
        ({ pictures: { '919800000000@c.us': 'https://pps.whatsapp.net/me.jpg', '919811111111@c.us': 'https://pps.whatsapp.net/asha.jpg' } }),
    })
    page()
    expect(await screen.findByAltText('Asha Rao')).toHaveAttribute('src', 'https://pps.whatsapp.net/asha.jpg')
    expect(screen.getByAltText('Shubham')).toHaveAttribute('src', 'https://pps.whatsapp.net/me.jpg')
    expect(calls.filter((call) => call.includes('profile-pictures'))).toHaveLength(1)
  })

  it("shows each group member's photo beside their name (initials when none), and mentions by name", async () => {
    const TEAM = { id: '120363000000000000@g.us', name: 'Sales Team', isGroup: true, unreadCount: 0, timestamp: 1700000000, lastMessage: '@21947350007867 @91504412459142 when are we shifting?' }
    const message = (id: string, author: string, name: string) => ({ id, body: 'Noted', type: 'text', timestamp: 1700000000, fromMe: false, author, contact: { name } })
    const latest = { ...message('m2', '222@lid', 'Aarushi Joshi'), body: TEAM.lastMessage,
      mentionedIds: [{ _serialized: '21947350007867@lid' }, '91504412459142@lid'] }
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [TEAM, ASHA],
      'GET /sessions/s1/messages/120363000000000000%40g.us/history?limit=1': () => [latest],
      'GET /sessions/s1/messages/120363000000000000%40g.us/history?limit=50': () => [message('m1', '111@lid', 'Siddharth Biswas'),
        // WhatsApp Web sends mentions as id objects; the text carries only the digits.
        { ...message('m2', '222@lid', 'Aarushi Joshi'), body: '@21947350007867 @91504412459142 when are we shifting?',
          mentionedIds: [{ server: 'lid', user: '21947350007867', _serialized: '21947350007867@lid' }, { server: 'lid', user: '91504412459142', _serialized: '91504412459142@lid' }] }],
      'GET /sessions/s1/contacts/21947350007867%40lid': () => ({ name: 'Abhinandan' }),
      'GET /sessions/s1/contacts/21947350007867%40lid/phone': () => ({ phone: '919811100000' }),
      'GET /sessions/s1/contacts/91504412459142%40lid/phone': () => ({ phone: '919822200000' }),
      'GET /sessions/s1/contacts/profile-pictures?ids=111%40lid,222%40lid': () => ({ pictures: { '111@lid': 'https://pps.whatsapp.net/sid.jpg', '222@lid': null } }),
    })
    page()
    const card = await screen.findByRole('button', { name: /Sales Team/ })
    expect(await within(card).findByText('@Abhinandan @+91 98222 00000 when are we shifting?')).toBeInTheDocument()
    expect(calls.some((call) => call.includes('919811111111%40c.us/history'))).toBe(false)
    expect(screen.queryByRole('region', { name: 'Conversation with Sales Team' })).not.toBeInTheDocument()
    await userEvent.click(card)
    const conversation = await screen.findByRole('region', { name: 'Conversation with Sales Team' })
    expect(await within(conversation).findByAltText('Siddharth Biswas')).toHaveAttribute('src', 'https://pps.whatsapp.net/sid.jpg')
    expect(within(conversation).getByText('AJ')).toBeInTheDocument()
    // Mentions read as WhatsApp shows them: the name, else the phone when WhatsApp has no name.
    expect(await within(conversation).findByText('@Abhinandan')).toBeInTheDocument()
    expect(await within(conversation).findByText('@+91 98222 00000')).toBeInTheDocument()
    expect(calls.filter((call) => call.includes('profile-pictures?ids=111'))).toHaveLength(1)
    expect(calls.filter((call) => call === 'GET /sessions/s1/contacts/21947350007867%40lid')).toHaveLength(1)
    expect(calls.filter((call) => call.includes('history?limit=1'))).toHaveLength(1)
  })

  it('resolves new live preview mentions using their real ids and leaves untagged numeric text alone', async () => {
    const TEAM = { id: '120363000000000001@g.us', name: 'Review Team', isGroup: true, unreadCount: 0, timestamp: 1700000000, lastMessage: '@123456 reference' }
    let latest = { id: 'reference', body: TEAM.lastMessage, type: 'text', timestamp: TEAM.timestamp, fromMe: false, mentionedIds: [] as string[] }
    const history = 'GET /sessions/s1/messages/120363000000000001%40g.us/history?limit=1'
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [TEAM],
      [history]: () => [latest],
      'GET /sessions/s1/contacts/919844444444%40c.us': () => ({ name: 'Meera Shah' }),
    })
    page()
    const card = await screen.findByRole('button', { name: /Review Team/ })
    await waitFor(() => expect(calls).toContain(history))
    expect(within(card).getByText('@123456 reference')).toBeInTheDocument()
    expect(calls.some((call) => call.includes('/contacts/123456'))).toBe(false)
    // Send normal event frames; FakeSocket.push also simulates reconnecting, which re-fetches every cached query.
    const pushMessage = (data: object) => act(() => FakeSocket.last!.onmessage?.({
      data: `42/events,${JSON.stringify(['message', { type: 'event', payload: { event: 'message.received', sessionId: 's1', data } }])}`,
    }))

    latest = { ...latest, id: 'mention', body: '@919844444444 please review', timestamp: TEAM.timestamp + 1, mentionedIds: ['919844444444@c.us'] }
    pushMessage({ ...latest, chatId: TEAM.id, isGroup: true })
    expect(await within(card).findByText('@Meera Shah please review')).toBeInTheDocument()
    expect(calls.filter((call) => call === history)).toHaveLength(2)
    expect(calls.some((call) => call.includes('919844444444%40lid'))).toBe(false)

    pushMessage({ ...latest, id: 'done', body: 'All done', mentionedIds: [], chatId: TEAM.id })
    expect(await within(card).findByText('All done')).toBeInTheDocument()
    expect(calls.filter((call) => call === history)).toHaveLength(2)
  })

  it('makes an unread chat glow until it is opened, then marks it read on the phone too', async () => {
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [{ ...ASHA, unreadCount: 2 }],
      [ASHA_HISTORY]: () => [],
      'POST /sessions/s1/chats/read': () => ({ success: true }),
    })
    page()
    const card = await screen.findByRole('button', { name: /Asha Rao/ })
    expect(within(card).getByTestId('unread-pulse')).toBeInTheDocument()
    await userEvent.click(card)
    await waitFor(() => expect(within(card).queryByTestId('unread-pulse')).not.toBeInTheDocument())
    expect(within(card).queryByLabelText('2 unread')).not.toBeInTheDocument()
    expect(calls).toContain('POST /sessions/s1/chats/read {"chatId":"919811111111@c.us"}')
  })

  it("tags chats: starts from the phone's lists, shortlists by tag, and tags a chat from its right-click menu", async () => {
    await resetLocalData()
    const RAHUL = { id: '919822222222@c.us', name: 'Rahul Mehta', isGroup: false, unreadCount: 0, timestamp: 1699990000, lastMessage: 'Noted' }
    gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA, RAHUL],
      // WhatsApp's built-in filters come back empty; the user's own list carries its chats.
      'GET /sessions/s1/labels': () => [{ id: '1', name: 'Unread' }, { id: '5', name: 'Sales' }],
      'GET /sessions/s1/labels/1/chats': () => [],
      'GET /sessions/s1/labels/5/chats': () => [ASHA],
    })
    page()
    const list = await screen.findByRole('list', { name: 'Conversations' })
    await within(list).findByText('Rahul Mehta')

    // Shortlist by the imported tag, then clear.
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    const filter = await screen.findByRole('menu', { name: 'Show chats tagged' })
    expect(within(filter).queryByText('Unread')).not.toBeInTheDocument()
    await userEvent.click(within(filter).getByRole('menuitemcheckbox', { name: /Sales/ }))
    await waitFor(() => expect(within(list).queryByText('Rahul Mehta')).not.toBeInTheDocument())
    expect(within(list).getByText('Asha Rao')).toBeInTheDocument()
    await userEvent.click(within(filter).getByRole('button', { name: 'Clear selection' }))
    expect(await within(list).findByText('Rahul Mehta')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    // Right-click → Add tag → New tag: the new tag holds this chat.
    fireEvent.contextMenu(within(list).getByText('Rahul Mehta'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add tag' }))
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Tags' })).getByRole('button', { name: 'New tag' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New tag name' }), 'CXO{Enter}')
    expect(await screen.findByText('Tagged CXO')).toBeInTheDocument()
    expect(await screen.findByRole('menuitemcheckbox', { name: 'CXO', checked: true })).toBeInTheDocument()
    expect((await repository.listWhatsAppTags()).map((tag) => [tag.name, tag.chatIds])).toEqual([['CXO', [RAHUL.id]], ['Sales', [ASHA.id]]])
    // The phone's lists are imported once only; later edits are never overwritten.
    await repository.importWhatsAppTags([{ name: 'Sales', chatIds: [] }])
    expect(await repository.listWhatsAppTags()).toHaveLength(2)
  })

  it('asks before unlinking, because linking again needs a new scan', async () => {
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => [ASHA],
      'POST /sessions/s1/logout': () => ({ success: true }),
    })
    page()
    const headerUnlink = async () => within(await screen.findByRole('banner')).findByRole('button', { name: 'Unlink' })
    await userEvent.click(await headerUnlink())
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(calls).not.toContain('POST /sessions/s1/logout')
    await userEvent.click(await headerUnlink())
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    expect(calls).toContain('POST /sessions/s1/logout')
  })

  it('pops errors onto the page, and Refresh reloads everything without unlinking', async () => {
    let failing = true
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [READY],
      'GET /sessions/s1/chats?limit=100': () => (failing
        ? new Response(JSON.stringify({ message: 'Transport died while listing chats' }), { status: 503 })
        : [ASHA]),
    })
    page()
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Could not load chats: Transport died while listing chats')
    failing = false
    await userEvent.click(screen.getAllByRole('button', { name: /refresh/i })[0])
    expect(await screen.findByRole('button', { name: /asha rao/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls.some((call) => call.includes('/logout'))).toBe(false)
  })

  it('says so when the gateway is not running', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    page()
    expect(await screen.findByText('WhatsApp is not available')).toBeInTheDocument()
    expect(screen.getByText(/gateway is not running/i)).toBeInTheDocument()
  })
})
