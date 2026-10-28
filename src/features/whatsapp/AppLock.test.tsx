import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhatsAppAppLock } from './AppLock'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
const view = () => render(<WhatsAppAppLock name="lock-test">{(lock) => <><p>Private chats</p><button onClick={lock}>Lock chats</button></>}</WhatsAppAppLock>)

describe('WhatsApp app lock', () => {
  it('requires matching PINs, hides chats, rejects a wrong PIN, and stays locked on another visit', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const first = view()
    await userEvent.click(screen.getByRole('button', { name: 'Lock chats' }))
    const dialog = screen.getByRole('dialog', { name: 'App lock' })
    await userEvent.type(within(dialog).getByLabelText('New PIN'), '621947')
    await userEvent.type(within(dialog).getByLabelText('Confirm PIN'), '621948')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and lock' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('do not match')
    await userEvent.clear(within(dialog).getByLabelText('Confirm PIN'))
    await userEvent.type(within(dialog).getByLabelText('Confirm PIN'), '621947')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and lock' }))
    await screen.findByRole('region', { name: 'WhatsApp locked' })
    expect(screen.queryByText('Private chats')).not.toBeInTheDocument()
    expect(localStorage.getItem('goms:whatsapp:app-lock:lock-test')).not.toContain('621947')
    await userEvent.type(screen.getByLabelText('App lock PIN'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock WhatsApp' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect PIN')
    await userEvent.clear(screen.getByLabelText('App lock PIN'))
    await userEvent.type(screen.getByLabelText('App lock PIN'), '621947')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock WhatsApp' }))
    await screen.findByText('Private chats')
    first.unmount()
    view()
    expect(screen.queryByText('Private chats')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('App lock PIN'), '621947')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock and turn off app lock' }))
    await screen.findByText('Private chats')
    await waitFor(() => expect(localStorage.getItem('goms:whatsapp:app-lock:lock-test')).toBeNull())
  })
})
