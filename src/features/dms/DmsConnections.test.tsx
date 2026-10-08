import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DmsSettingsPage } from '@/app/routes/DmsSettingsPage'
import { DmsConnectionPage } from '@/app/routes/DmsConnectionPage'
import { loadConnections, saveConnection } from './connections'
import { DEFAULT_DMS_SETTINGS } from './settings'

const drive = vi.hoisted(() => ({ loadGoogleIdentity: vi.fn(), getDriveSession: vi.fn(), disconnectDrive: vi.fn(), connectDrive: vi.fn(), getFolder: vi.fn(), createFolder: vi.fn(), listFiles: vi.fn(), uploadFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn(), copyFile: vi.fn() }))
vi.mock('./googleDrive', () => ({ ...drive, FOLDER_MIME: 'application/vnd.google-apps.folder' }))
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); drive.loadGoogleIdentity.mockResolvedValue({}); drive.getDriveSession.mockReturnValue(null) })
afterEach(cleanup)
function show() {
  return render(<MemoryRouter initialEntries={['/settings/dms']}><Routes><Route path="/settings/dms" element={<DmsSettingsPage />} /><Route path="/settings/dms/new" element={<DmsConnectionPage />} /><Route path="/settings/dms/:connectionId" element={<DmsConnectionPage />} /></Routes></MemoryRouter>)
}
describe('DMS list and creation', () => {
  it('shows connections first and only loads OAuth setup after Create new', async () => {
    show()
    expect(screen.queryByLabelText(/^Google OAuth client ID/)).not.toBeInTheDocument()
    expect(drive.loadGoogleIdentity).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('link', { name: 'Create new' }))
    expect(await screen.findByRole('heading', { name: 'Create new DMS' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Google OAuth client ID/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('DMS name'), { target: { value: 'Sales documents' } })
    fireEvent.change(screen.getByLabelText(/^Google OAuth client ID/), { target: { value: '123-sales.apps.googleusercontent.com' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(loadConnections()[0].name).toBe('Sales documents')
    expect(await screen.findByRole('heading', { name: 'Sales documents' })).toBeInTheDocument()
  })
  it('shows active connections and assigns multiple places from the row dropdown', async () => {
    saveConnection({ id: 'sales', name: 'Sales Drive', modules: [], isMaster: false, settings: { ...DEFAULT_DMS_SETTINGS }, accountEmail: 'sales@example.com' })
    drive.getDriveSession.mockReturnValue({ email: 'sales@example.com', expiresAt: Date.now() + 60000 })
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Choose where this DMS works' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sales' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Teams' }))
    expect(loadConnections()[0].modules).toEqual(['sales', 'teams'])
    await userEvent.click(screen.getByRole('button', { name: 'Connected' }))
    expect(screen.getByRole('heading', { name: 'Sales Drive' })).toBeInTheDocument()
  })
  it('creates a dedicated master configuration without module assignments', async () => {
    show()
    await userEvent.click(screen.getByRole('link', { name: 'Add master DMS' }))
    expect(await screen.findByRole('heading', { name: 'Create master DMS' })).toBeInTheDocument()
    expect(screen.getByLabelText('DMS name')).toHaveValue('Master DMS')
    expect(screen.queryByRole('button', { name: 'Choose where this DMS works' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Storage provider')).toBeDisabled()
  })
})
