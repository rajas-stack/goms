import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { whatsappApi, type WhatsAppChat, type WhatsAppMessage } from './api'
import { MediaLibrary } from './MediaLibrary'

vi.mock('@/lib/auth', () => ({ useAuthUser: () => ({ user: null }) }))
const chats: WhatsAppChat[] = [
  { id: 'asha@c.us', name: 'Asha', isGroup: false, unreadCount: 0, timestamp: 1 },
  { id: 'rahul@c.us', name: 'Rahul', isGroup: false, unreadCount: 0, timestamp: 2 },
]
const doc: WhatsAppMessage = { id: 'm1', type: 'document', body: 'Smart City drawings', fromMe: false, timestamp: 100, media: { filename: 'BOQ.xlsx', mimetype: 'application/xlsx', sizeBytes: 123 } }
function Location() { const location = useLocation(); return <output data-testid="location">{location.search}</output> }
function show(initialTags: string[] = []) {
  vi.spyOn(repository, 'listWhatsAppLinks').mockResolvedValue([])
  vi.spyOn(repository, 'listBidsForGrid').mockResolvedValue([])
  const history = vi.spyOn(whatsappApi, 'history').mockImplementation(async (_, id) => id === chats[0].id ? [doc] : [{ ...doc, id: 'm2', fromMe: true, body: 'Rates https://example.com', media: { ...doc.media!, filename: 'Rates.pdf' } }])
  const storedFile = vi.spyOn(whatsappApi, 'storedFile').mockResolvedValue(new Blob(['hello'], { type: 'text/plain' }))
  const close = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter><Location /><MediaLibrary sessionId="s1" chats={chats} tags={[{ id: 't1', name: 'Sales', chatIds: [chats[0].id] }]} initialTags={initialTags} pictures={{}} ownName="You" ownPhone={null} onClose={close} /></MemoryRouter></ToastProvider></QueryClientProvider>)
  return { history, storedFile, close }
}
afterEach(() => vi.restoreAllMocks())

describe('MediaLibrary', () => {
  it('inherits tags, preserves filters across tabs, groups documents by people, and loads no file bytes for a list', async () => {
    const { storedFile } = show(['t1'])
    await userEvent.click(screen.getByRole('tab', { name: /Docs/ }))
    expect(await screen.findByRole('button', { name: 'Open BOQ.xlsx' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Rates.pdf' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organize by' }), 'people')
    expect(screen.getByRole('region', { name: 'Asha' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('button', { name: 'Open Rates.pdf' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filter and sort' }))
    await userEvent.click(screen.getByRole('radio', { name: 'You' }))
    expect(screen.queryByRole('button', { name: 'Open BOQ.xlsx' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Links/ }))
    expect(await screen.findByRole('button', { name: 'Open example.com' })).toBeInTheDocument()
    expect(storedFile).not.toHaveBeenCalled()
  })
  it('supports selection and search, opens action dialogs and restores the library after closing them', async () => {
    show()
    await userEvent.click(screen.getByRole('tab', { name: /Docs/ }))
    await screen.findByRole('button', { name: 'Open BOQ.xlsx' })
    await userEvent.click(screen.getByRole('button', { name: 'Search attachments' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search media, documents and links' }), 'BOQ')
    expect(screen.queryByRole('button', { name: 'Open Rates.pdf' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select attachments' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown attachments' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Options for BOQ.xlsx' }))
    await userEvent.click(within(screen.getByRole('menu', { name: 'Attachment options' })).getByRole('menuitem', { name: 'Forward' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forward message to' })
    expect(within(dialog).getByRole('button', { name: 'Rahul' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog', { name: 'Media library' })).toBeInTheDocument()
  })
  it('goes back to the original message and closes the popup', async () => {
    const { close } = show()
    await userEvent.click(screen.getByRole('tab', { name: /Docs/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Options for BOQ.xlsx' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Go to message' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('chat=asha%40c.us&message=m1'))
    expect(close).toHaveBeenCalled()
  })
})
