import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { repository, resetLocalData } from '@/data/repository'
import type { AddWhatsAppLinkInput } from '@/lib/types'
import { OpportunityWhatsApp } from './OpportunityWhatsApp'

const base: Omit<AddWhatsAppLinkInput, 'opportunityId'> = {
  bidId: 'b1', chatId: '919811111111@c.us', chatName: 'Asha Rao', messageId: 'm1', fromMe: false, senderName: 'Asha Rao',
  senderPhone: '919811111111', type: 'document', body: 'Site notes', filename: 'notes.txt', sentAt: '2026-10-26T11:16:43.000Z', addedBy: 'Shubham Mehra',
}

const show = (opportunityId: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter><OpportunityWhatsApp opportunityId={opportunityId} /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
)

beforeEach(async () => {
  await resetLocalData()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:file'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('OpportunityWhatsApp', () => {
  it('views and downloads the copy of the file kept with the filed message, without asking WhatsApp', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await repository.addWhatsAppLink({ ...base, opportunityId: 'o1', file: { mimetype: 'text/plain', base64: btoa('Cable 12 m') } })
    show('o1')
    const card = await screen.findByRole('article', { name: 'WhatsApp message from Asha Rao' })
    await userEvent.click(within(card).getByRole('button', { name: 'View' }))
    expect(await within(await screen.findByRole('dialog', { name: 'Preview of notes.txt' })).findByText('Cable 12 m')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.click(within(card).getByRole('button', { name: 'Download' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('notes.txt')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fixes an older card by itself: sender name and phone, mentions, and who filed it', async () => {
    const reply: Record<string, unknown> = {
      '/sessions?name=goms-this-computer': [{ id: 's1', name: 'goms-this-computer', status: 'ready', pushName: 'Shubham Mehra' }],
      '/sessions/s1/contacts/13482019831841%40lid': { name: 'Hritika Nainwani' },
      '/sessions/s1/contacts/13482019831841%40lid/phone': { phone: '919900000000' },
      '/sessions/s1/contacts/102404972400823%40lid': { pushName: 'Rahul' },
      '/sessions/s1/contacts/102404972400823%40lid/phone': { phone: null },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = url.replace('/openwa/api', '')
      return path in reply ? new Response(JSON.stringify(reply[path])) : new Response('{"message":"not found"}', { status: 404 })
    }))
    await repository.addWhatsAppLink({
      ...base, opportunityId: 'o3', chatName: 'Amnex Geo Sales Team', senderName: '+13482019831841', senderPhone: '13482019831841',
      body: '@102404972400823 -- how are we maintaining the data hygiene?', addedBy: 'This computer',
    })
    show('o3')
    const card = await screen.findByRole('article', { name: 'WhatsApp message from Hritika Nainwani' })
    expect(card).toHaveTextContent('+91 99000 00000')
    expect(card).toHaveTextContent('@Rahul -- how are we maintaining the data hygiene?')
    expect(card).toHaveTextContent('Added by Shubham Mehra')
  })

  it('fetches the file from WhatsApp for a message filed before copies were kept, and keeps a copy', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/sessions?name=')) return new Response(JSON.stringify([{ id: 's1', name: 'goms-this-computer', status: 'ready' }]))
      if (url.endsWith('/m1/media')) return new Response('from WhatsApp', { headers: { 'Content-Type': 'text/plain' } })
      return new Response('{}', { status: 404 })
    }))
    await repository.addWhatsAppLink({ ...base, opportunityId: 'o2' })
    show('o2')
    await userEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'View' }))
    expect(await within(await screen.findByRole('dialog', { name: 'Preview of notes.txt' })).findByText('from WhatsApp')).toBeInTheDocument()
    expect(calls.some((url) => url.endsWith('/sessions/s1/messages/919811111111%40c.us/m1/media'))).toBe(true)
    await waitFor(async () => expect((await repository.listWhatsAppLinks('o2'))[0].file?.base64).toBe(btoa('from WhatsApp')))
  })
})
