import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('@/lib/auth', () => ({ authApi: { configured: false }, useAuthUser: () => ({ user: null, loading: false }) }))
import { WhatsAppWorkspace } from './WhatsAppWorkspace'
import { LOCAL_SESSION } from './api'
import { readStarred } from './starredMessages'

const ASHA = { id: '919811111111@c.us', name: 'Asha Rao', isGroup: false, unreadCount: 2, timestamp: 1700000000, lastMessage: 'Hello' }
const RAHUL = { id: '919822222222@c.us', name: 'Rahul Mehta', isGroup: false, unreadCount: 1, timestamp: 1700000001, lastMessage: 'Thanks' }
const MESSAGE = { id: 'm1', body: 'Keep this message', type: 'text', timestamp: 1700000000, fromMe: false }

function page(overrides: Record<string, (body: any) => unknown> = {}) {
  const calls: Array<{ key: string; body: any }> = []
  const routes: Record<string, (body: any) => unknown> = {
    [`GET /sessions?name=${LOCAL_SESSION}`]: () => [{ id: 's1', name: LOCAL_SESSION, status: 'ready', phone: '919800000000', pushName: 'You' }],
    'GET /sessions/s1/chats?limit=100': () => [ASHA, RAHUL],
    'GET /sessions/s1/labels': () => [],
    'GET /sessions/s1/contacts?limit=1000': () => [{ id: '919833333333@c.us', name: 'Priya Shah' }],
    'GET /sessions/s1/messages/919811111111%40c.us/history?limit=50': () => [MESSAGE],
    'GET /sessions/s1/messages/919833333333%40c.us/history?limit=50': () => [],
    'POST /sessions/s1/chats/read': () => ({ success: true }),
    'POST /sessions/s1/messages/star': () => ({ success: true }),
    'POST /sessions/s1/logout': () => ({ success: true }),
    ...overrides,
  }
  vi.stubGlobal('WebSocket', class { onclose = null; close() {} send() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('/openwa/api', '')}`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ key, body })
    const handler = routes[key] ?? (key.includes('/contacts/profile-pictures?') ? () => ({ pictures: {} }) : undefined)
    if (!handler) return new Response(JSON.stringify({ message: `Unexpected ${key}` }), { status: 404 })
    const result = await handler(body)
    return result instanceof Response ? result : new Response(JSON.stringify(result))
  }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const rendered = render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/whatsapp']}><WhatsAppWorkspace /></MemoryRouter></ToastProvider></QueryClientProvider>)
  return { calls, qc, ...rendered }
}

beforeEach(() => localStorage.clear())
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
const menu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Chat options' }))
  return screen.findByRole('menu')
}

describe('WhatsApp chat actions', () => {
  it('matches the requested menu and closes with Escape', async () => {
    page()
    const popup = await menu()
    expect(within(popup).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'New group', 'Starred messages', 'Select chats', 'Mark all as read', 'App lock', 'Log out',
    ])
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Chat options' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a contact that has no recent chat, without sending anything', async () => {
    const { calls } = page()
    await userEvent.click(await screen.findByRole('button', { name: 'New chat' }))
    const dialog = await screen.findByRole('dialog', { name: 'New chat' })
    await userEvent.click(await within(dialog).findByRole('button', { name: /Priya Shah/ }))
    expect(await screen.findByRole('region', { name: 'Conversation with Priya Shah' })).toBeInTheDocument()
    expect(calls.some(({ key }) => key.includes('/messages/send-'))).toBe(false)
  })

  it('checks a new phone number and refuses unregistered accounts', async () => {
    const { calls } = page({ 'GET /sessions/s1/contacts/check/919844444444': () => ({ exists: false, whatsappId: null }) })
    await userEvent.click(await screen.findByRole('button', { name: 'New chat' }))
    const dialog = await screen.findByRole('dialog', { name: 'New chat' })
    await userEvent.type(within(dialog).getByLabelText('Search contacts or phone number'), '+91 98444 44444')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Chat with +919844444444' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('not registered')
    expect(calls.some(({ key }) => key.includes('/messages/send-'))).toBe(false)
  })

  it('creates a group with its selected members and opens it', async () => {
    const { calls } = page({ 'POST /sessions/s1/groups': () => ({ id: 'group@g.us', name: 'Project team' }), 'GET /sessions/s1/messages/group%40g.us/history?limit=50': () => [] })
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Group name'), 'Project team')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Priya Shah/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group (1)' }))
    await screen.findByRole('region', { name: 'Conversation with Project team' })
    expect(calls.find(({ key }) => key === 'POST /sessions/s1/groups')?.body).toEqual({ name: 'Project team', participants: ['919833333333@c.us'] })
  })

  it('keeps a failed mark-read badge while clearing successful chats', async () => {
    page({ 'POST /sessions/s1/chats/read': ({ chatId }) => chatId === RAHUL.id ? new Response(JSON.stringify({ message: 'Phone offline' }), { status: 503 }) : { success: true } })
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Mark all as read' }))
    await waitFor(() => expect(screen.queryByLabelText('2 unread')).not.toBeInTheDocument())
    expect(screen.getByLabelText('1 unread')).toBeInTheDocument()
    expect(await screen.findByText('1 chat could not be marked as read. Please retry.')).toBeInTheDocument()
  })

  it('keeps the group form and explains when the connected gateway cannot create groups', async () => {
    page({ 'POST /sessions/s1/groups': () => new Response(JSON.stringify({ message: 'createGroup is not supported by this engine' }), { status: 501 }) })
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Group name'), 'Project team')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Priya Shah/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group (1)' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('create the group on your phone')
    expect(within(dialog).getByLabelText('Group name')).toHaveValue('Project team')
  })

  it('selects chats and marks only the selection as read', async () => {
    const { calls } = page()
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Select chats' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Asha Rao' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => expect(screen.queryByLabelText('2 unread')).not.toBeInTheDocument())
    expect(calls.filter(({ key }) => key.endsWith('/chats/read')).map(({ body }) => body.chatId)).toEqual([ASHA.id])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel chat selection' }))
    expect(screen.queryByRole('checkbox', { name: 'Select all chats' })).not.toBeInTheDocument()
  })

  it('saves a starred message across visits and opens it from the dropdown', async () => {
    const first = page()
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }))
    await screen.findByText(MESSAGE.body)
    await userEvent.click(screen.getByRole('button', { name: 'Message options' }))
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Message options' })).getByRole('menuitem', { name: 'Star' }))
    await waitFor(() => expect(readStarred('s1')).toHaveLength(1))
    first.unmount()
    page()
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Starred messages' }))
    const dialog = await screen.findByRole('dialog', { name: 'Starred messages' })
    expect(within(dialog).getByText(MESSAGE.body)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Keep this message/ }))
    expect(screen.queryByRole('dialog', { name: 'Starred messages' })).not.toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Starred' })).toBeInTheDocument()
  })

  it('asks before logging out and never logs out just by opening the menu', async () => {
    const { calls } = page()
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Log out' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unlink WhatsApp?' })
    expect(calls.some(({ key }) => key.endsWith('/logout'))).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(calls.some(({ key }) => key.endsWith('/logout'))).toBe(true))
  })
})
