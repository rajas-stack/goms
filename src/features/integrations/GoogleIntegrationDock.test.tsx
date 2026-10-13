import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { GoogleIntegrationDock } from './GoogleIntegrationDock'
import { getGoogleAccount, setGoogleAccount } from './session'
import { loadGoogleSettings, saveGoogleSettings } from './settings'
import { runWorkspaceAction } from './workspaceClient'
vi.mock('@/features/dms/googleDrive', () => ({ loadGoogleIdentity: vi.fn(async () => ({})) }))
vi.mock('./workspaceClient', async importOriginal => ({ ...await importOriginal<typeof import('./workspaceClient')>(), runWorkspaceAction: vi.fn(async () => ({ message: 'Email sent.' })) }))
let sequence = 0
beforeEach(async () => {
  vi.clearAllMocks(); setGoogleAccount({ uid: `dock-${++sequence}`, email: 'a@amnex.com', googleId: 'google-a' })
  const account = getGoogleAccount()!
  await loadGoogleSettings(account); await saveGoogleSettings(account, { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com' })
})
afterEach(() => { cleanup(); setGoogleAccount(null) })
describe('deployed Google widgets', () => {
  it('embeds a working Gmail action on the accounts page with its real page ID', async () => {
    render(<MemoryRouter initialEntries={['/map']}><GoogleIntegrationDock /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Open Google tools' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gmail' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Gmail action' }), 'create')
    await userEvent.type(screen.getByLabelText('To'), 'user@amnex.com')
    await userEvent.type(screen.getByLabelText('Subject'), 'Bid update')
    await userEvent.type(screen.getByLabelText('Message'), 'New deadline')
    await userEvent.click(screen.getByRole('button', { name: 'Send email' }))
    expect(runWorkspaceAction).toHaveBeenCalledWith('gmail', 'create', expect.objectContaining({ title: 'Bid update' }), undefined, 'accounts', false)
    expect(await screen.findByText('Email sent.')).toBeInTheDocument()
  })
  it('removes master-disabled and page-disabled services immediately', async () => {
    render(<MemoryRouter initialEntries={['/sales/team']}><GoogleIntegrationDock /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Open Google tools' }))
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
    await saveGoogleSettings(getGoogleAccount()!, { ...DEFAULT_GOOGLE_INTEGRATIONS, disabledServices: ['calendar'], disabledPages: { gmail: ['sales'] } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Gmail' })).not.toBeInTheDocument()
  })
  it('does not deploy the widget launcher to the settings controller or signed-out pages', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/settings/integrations']}><GoogleIntegrationDock /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Open Google tools' })).not.toBeInTheDocument()
    unmount(); setGoogleAccount(null)
    render(<MemoryRouter initialEntries={['/map']}><GoogleIntegrationDock /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Open Google tools' })).not.toBeInTheDocument()
  })
})
