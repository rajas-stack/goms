import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { IntegrationsSettingsPage } from '@/app/routes/IntegrationsSettingsPage'
import { GOOGLE_PRODUCTS } from './catalog'
import { registerGoogleFeature } from './registry'
import { getGoogleAccount, setGoogleAccount } from './session'
import { googleServiceEnabled, googleSettings, loadGoogleSettings, saveGoogleSettings } from './settings'
import { testGoogleConnection } from './googleClient'
import { runWorkspaceAction } from './workspaceClient'
vi.mock('@/features/dms/googleDrive', () => ({ loadGoogleIdentity: vi.fn(async () => ({})) }))
vi.mock('./googleClient', () => ({ authorizeGoogle: vi.fn(async () => 'memory-only'), testGoogleConnection: vi.fn(async () => ({ status: 'verified', message: 'API verified.' })) }))
vi.mock('./workspaceClient', async importOriginal => ({ ...await importOriginal<typeof import('./workspaceClient')>(), runWorkspaceAction: vi.fn(async () => ({ items: [{ id: 'message-a', title: 'Tender reminder', detail: 'From user@amnex.com' }] })) }))
let counter = 0
beforeEach(async () => {
  vi.clearAllMocks()
  const account = { uid: `integration-user-${++counter}`, email: 'a@amnex.com', googleId: 'google-a' }
  setGoogleAccount(account); await loadGoogleSettings(account)
  await saveGoogleSettings(account, { ...googleSettings(account), clientId: '123.apps.googleusercontent.com' })
})
afterEach(() => { cleanup(); setGoogleAccount(null) })
describe('Google Integrations settings', () => {
  it('lists all 13 services with a separate connection test and page selector', () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    for (const product of GOOGLE_PRODUCTS) {
      expect(screen.getByRole('heading', { name: product.name })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Test ${product.name} connection` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Choose pages for ${product.name}` })).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: `${product.name} activation` })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: `Open ${product.name}` })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
  it('automatically discovers feature pages, preserves choices and isolates users', async () => {
    registerGoogleFeature({ id: 'test-account-calendar', page: { id: 'accounts', label: 'Accounts mapping', path: '/map' }, services: ['calendar'] })
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Choose pages for Calendar' }))
    const accounts = screen.getByRole('checkbox', { name: 'Accounts mapping' })
    expect(accounts).toBeChecked()
    await userEvent.click(accounts)
    await waitFor(() => expect(accounts).not.toBeChecked())
    expect(googleServiceEnabled('calendar', 'accounts')).toBe(false)
    expect(googleSettings(getGoogleAccount()).disabledPages.calendar).toEqual(['accounts'])
    registerGoogleFeature({ id: 'test-contacts-calendar', page: { id: 'contacts', label: 'Contacts', path: '/directory' }, services: ['calendar'] })
    expect(await screen.findByRole('checkbox', { name: 'Contacts' })).toBeChecked()
    const other = { uid: `integration-other-${counter}`, email: 'b@amnex.com', googleId: 'google-b' }
    setGoogleAccount(other); await loadGoogleSettings(other)
    await userEvent.click(screen.getByRole('button', { name: 'Choose pages for Calendar' }))
    expect(screen.getByRole('checkbox', { name: 'Accounts mapping' })).toBeChecked()
  })
  it('requires sign-in and never reports an API connected just because the user is signed in', () => {
    setGoogleAccount(null)
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Gmail connection' })).toBeDisabled()
    expect(screen.queryByText('API verified')).not.toBeInTheDocument()
  })
  it('tests a selected service against the current account', async () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Test Sites connection' }))
    expect(testGoogleConnection).toHaveBeenCalledWith('sites', getGoogleAccount(), googleSettings(getGoogleAccount()))
    expect(await within(screen.getByRole('region', { name: 'Sites integration' })).findByText('API verified.')).toBeInTheDocument()
  })
  it('loads read-only test results in the app while a service is inactive', async () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('switch', { name: 'Gmail activation' }))
    await waitFor(() => expect(googleServiceEnabled('gmail', 'accounts')).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Test Gmail connection' }))
    await userEvent.click(screen.getByRole('button', { name: 'Load recent items' }))
    expect(runWorkspaceAction).toHaveBeenCalledWith('gmail', 'load', expect.any(Object), undefined, 'integrations', true)
    expect(await screen.findByText('Tender reminder')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Gmail action' })).not.toBeInTheDocument()
  })
  it('preserves page choices across master deactivation and clears private previews on sign-out', async () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Choose pages for Gmail' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sales' }))
    await waitFor(() => expect(googleServiceEnabled('gmail', 'sales')).toBe(false))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('switch', { name: 'Gmail activation' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gmail activation' })).not.toBeChecked())
    await userEvent.click(screen.getByRole('switch', { name: 'Gmail activation' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gmail activation' })).toBeChecked())
    expect(googleServiceEnabled('gmail', 'sales')).toBe(false)
    expect(googleServiceEnabled('gmail', 'accounts')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Test Gmail connection' }))
    await userEvent.click(screen.getByRole('button', { name: 'Load recent items' }))
    expect(await screen.findByText('Tender reminder')).toBeInTheDocument()
    setGoogleAccount(null)
    await waitFor(() => expect(screen.queryByText('Tender reminder')).not.toBeInTheDocument())
  })
  it('embeds the selected map address without redirecting or sending an OAuth token', async () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Test Maps connection' }))
    await userEvent.type(screen.getByLabelText('Maps Embed API key'), 'restricted-browser-key')
    await userEvent.type(screen.getByLabelText('Address'), 'New Delhi, India')
    await userEvent.click(screen.getByRole('button', { name: 'Show map' }))
    const frame = screen.getByTitle('Google Maps address preview')
    expect(frame).toHaveAttribute('src', 'https://www.google.com/maps/embed/v1/place?key=restricted-browser-key&q=New+Delhi%2C+India')
    expect(runWorkspaceAction).not.toHaveBeenCalled()
  })
})
