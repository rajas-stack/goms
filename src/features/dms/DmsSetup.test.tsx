import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DmsSetup } from './DmsSetup'
import { DEFAULT_DMS_SETTINGS, loadSettings, saveSettings } from './settings'

const drive = vi.hoisted(() => ({
  loadGoogleIdentity: vi.fn(), getDriveSession: vi.fn(), disconnectDrive: vi.fn(),
  connectDrive: vi.fn(), getFolder: vi.fn(), createFolder: vi.fn(),
  listFiles: vi.fn(), uploadFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn(), copyFile: vi.fn(),
}))
vi.mock('./googleDrive', () => ({ ...drive, FOLDER_MIME: 'application/vnd.google-apps.folder' }))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  drive.loadGoogleIdentity.mockResolvedValue({})
  drive.getDriveSession.mockReturnValue(null)
  drive.getFolder.mockResolvedValue({ id: 'root', name: 'Company documents', mimeType: 'application/vnd.google-apps.folder' })
  drive.listFiles.mockResolvedValue([])
})
afterEach(cleanup)

describe('Settings > DMS Settings', () => {
  it('shows editable OAuth configuration on the connection form', async () => {
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Google OAuth client ID/)).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeEnabled())
  })

  it('saves user-entered OAuth and folder inputs and restores them when reopened', async () => {
    const ui = render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Google OAuth client ID/), { target: { value: '123-configured.apps.googleusercontent.com' } })
    fireEvent.change(screen.getByLabelText(/^Root folder URL or ID/), { target: { value: 'https://drive.google.com/drive/folders/company' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(loadSettings().rootFolderId).toBe('company')
    ui.unmount()
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    expect(screen.getByLabelText(/^Google OAuth client ID/)).toHaveValue('123-configured.apps.googleusercontent.com')
    expect(screen.getByLabelText(/^Root folder URL or ID/)).toHaveValue('company')
  })

  it('passes the UI client ID to OAuth without requiring code changes', async () => {
    drive.connectDrive.mockResolvedValue({ accessToken: 'in-memory', email: 'user@example.com', expiresAt: Date.now() + 60000 })
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Google OAuth client ID/), { target: { value: '123-configured.apps.googleusercontent.com' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Connect Google Drive' }))
    expect(drive.connectDrive).toHaveBeenCalledWith('123-configured.apps.googleusercontent.com', 'default')
    await screen.findByText('user@example.com')
    expect(loadSettings().clientId).toBe('123-configured.apps.googleusercontent.com')
  })

  it('disconnects when the OAuth configuration changes', async () => {
    saveSettings({ ...DEFAULT_DMS_SETTINGS, clientId: '123-old.apps.googleusercontent.com' })
    drive.getDriveSession.mockReturnValue({ accessToken: 'old-token', email: 'old@example.com', expiresAt: Date.now() + 60000 })
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Google OAuth client ID/), { target: { value: '456-new.apps.googleusercontent.com' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(drive.disconnectDrive).toHaveBeenCalled()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('switches to a saved external DMS portal and back to Google Drive', async () => {
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    await userEvent.selectOptions(screen.getByLabelText('Storage provider'), 'external')
    fireEvent.change(screen.getByLabelText(/^External DMS URL/), { target: { value: 'https://portal.example.com/documents' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(screen.getByRole('link', { name: 'Open DMS' })).toHaveAttribute('href', 'https://portal.example.com/documents')
    expect(loadSettings().provider).toBe('external')
    await userEvent.selectOptions(screen.getByLabelText('Storage provider'), 'google-drive')
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(loadSettings().provider).toBe('google-drive')
    expect(screen.getByLabelText(/^Google OAuth client ID/)).toBeInTheDocument()
  })

  it('keeps invalid portal inputs unsaved and shows validation', async () => {
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    await userEvent.selectOptions(screen.getByLabelText('Storage provider'), 'external')
    fireEvent.change(screen.getByLabelText(/^External DMS URL/), { target: { value: 'javascript:alert(1)' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTPS')
    expect(loadSettings().provider).toBe('google-drive')
    expect(screen.queryByRole('link', { name: 'Open DMS' })).not.toBeInTheDocument()
  })

  it('shows a connection prompt instead of fabricated files when disconnected', async () => {
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    await userEvent.click(screen.getByRole('tab', { name: 'Documents' }))
    expect(screen.getByRole('heading', { name: 'Connect your Google Drive' })).toBeInTheDocument()
    expect(drive.listFiles).not.toHaveBeenCalled()
  })
  it('lets the file-size field be cleared and saved with no app limit', async () => {
    render(<MemoryRouter><DmsSetup /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Maximum file size/), { target: { value: '' } })
    expect(screen.getByLabelText(/^Maximum file size/)).toHaveValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(loadSettings().maxUploadMb).toBeNull()
  })
})
