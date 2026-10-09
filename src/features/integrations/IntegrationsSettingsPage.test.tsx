import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { IntegrationsSettingsPage } from '@/app/routes/IntegrationsSettingsPage'
import { GOOGLE_PRODUCTS } from './catalog'
import { registerGoogleFeature } from './registry'
import { getGoogleAccount, setGoogleAccount } from './session'
import { googleServiceEnabled, googleSettings, loadGoogleSettings } from './settings'
import { testGoogleConnection } from './googleClient'
vi.mock('@/features/dms/googleDrive', () => ({ loadGoogleIdentity: vi.fn(async () => ({})) }))
vi.mock('./googleClient', () => ({ authorizeGoogle: vi.fn(async () => 'memory-only'), testGoogleConnection: vi.fn(async () => ({ status: 'verified', message: 'API verified.' })) }))
let counter = 0
beforeEach(async () => {
  vi.clearAllMocks()
  const account = { uid: `integration-user-${++counter}`, email: 'a@amnex.com', googleId: 'google-a' }
  setGoogleAccount(account); await loadGoogleSettings(account)
})
afterEach(() => { cleanup(); setGoogleAccount(null) })
describe('Google Integrations settings', () => {
  it('lists all 13 services with a separate connection test and page selector', () => {
    render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>)
    for (const product of GOOGLE_PRODUCTS) {
      expect(screen.getByRole('heading', { name: product.name })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Test ${product.name} connection` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Choose pages for ${product.name}` })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: `Open ${product.name}` })).toHaveAttribute('href', expect.stringContaining('authuser=a%40amnex.com'))
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
})
