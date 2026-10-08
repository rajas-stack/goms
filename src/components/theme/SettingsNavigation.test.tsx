import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OptionsMenu } from './OptionsMenu'
import { DmsSettingsPage } from '@/app/routes/DmsSettingsPage'
import { SettingsPage } from '@/app/routes/SettingsPage'
import { DmsConnectionPage } from '@/app/routes/DmsConnectionPage'

vi.mock('@/features/dms/DmsSetup', () => ({ DmsSetup: () => <div>DMS configuration form</div> }))
afterEach(cleanup)

describe('DMS settings navigation', () => {
  it('follows gear > Settings > DMS Settings to a dedicated page', async () => {
    render(<MemoryRouter initialEntries={['/']}><OptionsMenu /><Routes><Route path="/" element={<p>Workspace</p>} /><Route path="/settings" element={<SettingsPage />} /><Route path="/settings/dms" element={<DmsSettingsPage />} /><Route path="/settings/dms/new" element={<DmsConnectionPage />} /></Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).queryByText('Appearance')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Keyboard shortcuts')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('DMS configuration form')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('link', { name: /DMS Settings/ }))
    expect(await screen.findByRole('heading', { name: 'DMS Settings' })).toBeInTheDocument()
    expect(screen.queryByText('DMS configuration form')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Create new' }))
    expect(await screen.findByRole('heading', { name: 'Create new DMS' })).toBeInTheDocument()
    expect(screen.getByText('DMS configuration form')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'DMS Settings' }))
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DMS Settings/ })).toHaveAttribute('href', '/settings/dms')
  })
})
