import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { OptionsMenu } from './OptionsMenu'
import { DmsSettingsPage } from '@/app/routes/DmsSettingsPage'
import { SettingsPage } from '@/app/routes/SettingsPage'
import { DmsConnectionPage } from '@/app/routes/DmsConnectionPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/dms/DmsSetup', () => ({ DmsSetup: () => <div>DMS configuration form</div> }))
afterEach(cleanup)

function CurrentPath() {
  return <output aria-label="Current route">{useLocation().pathname}</output>
}

describe('DMS settings navigation', () => {
  it('follows the blank user profile > Settings > System settings > DMS Settings to a dedicated page', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/']}><OptionsMenu /><Routes><Route path="/" element={<p>Workspace</p>} /><Route path="/settings" element={<SettingsPage />} /><Route path="/settings/dms" element={<DmsSettingsPage />} /><Route path="/settings/dms/new" element={<DmsConnectionPage />} /></Routes></MemoryRouter></QueryClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).queryByText('Appearance')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Keyboard shortcuts')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('DMS configuration form')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to workspace' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument())
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'System settings' }))
    await userEvent.click(await within(screen.getByRole('dialog', { name: 'Settings' })).findByRole('link', { name: /^DMS/ }))
    expect(await screen.findByRole('heading', { name: 'DMS' })).toBeInTheDocument()
    expect(screen.queryByText('DMS configuration form')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Create new' }))
    expect(await screen.findByRole('heading', { name: 'Create new DMS' })).toBeInTheDocument()
    expect(screen.getByText('DMS configuration form')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'DMS' }))
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'System settings' }))
    expect(await screen.findByRole('link', { name: /^DMS/ })).toHaveAttribute('href', '/settings/dms')
    await userEvent.click(screen.getByRole('link', { name: 'Back to workspace' }))
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('keeps every group and breadcrumb inside the popup until a settings page is selected', async () => {
    render(<MemoryRouter initialEntries={['/']}><OptionsMenu /><CurrentPath /><Routes><Route path="/" element={<p>Workspace</p>} /><Route path="/settings/integrations" element={<h1>Integration page</h1>} /></Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()

    for (const [group, pages] of [
      ['System settings', ['Integrations', 'DMS', 'Credentials']],
      ['Bid team settings', ['Tender websites', 'Document Verifications']],
      ['Pre-sales', ['Competitors']],
    ] as const) {
      await userEvent.click(await within(dialog).findByRole('button', { name: group }))
      for (const page of pages) expect(await within(dialog).findByRole('link', { name: new RegExp(page) })).toBeInTheDocument()
      expect(within(dialog).getByRole('navigation', { name: 'Settings navigation' })).toHaveTextContent(`Settings${group}`)
      expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/$/)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Settings' }))
    }

    await userEvent.click(await within(dialog).findByRole('button', { name: 'System settings' }))
    await userEvent.click(await within(dialog).findByRole('link', { name: /Integrations/ }))
    expect(await screen.findByRole('heading', { name: 'Integration page' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/settings/integrations')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'System settings' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).queryByRole('link')).not.toBeInTheDocument()
  })
})
