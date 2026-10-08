import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentLibrary } from './DocumentLibrary'
import { DEFAULT_DMS_SETTINGS } from './settings'
import type { DriveFile } from './googleDrive'

const drive = vi.hoisted(() => ({ listFiles: vi.fn(), createFolder: vi.fn(), uploadFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn(), getDriveSession: vi.fn(), copyFile: vi.fn() }))
vi.mock('./googleDrive', () => ({ ...drive, FOLDER_MIME: 'application/vnd.google-apps.folder' }))
const root: DriveFile = { id: 'root', name: 'Company documents', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } }
const files: DriveFile[] = [
  { id: 'proposal', name: 'Proposal.pdf', mimeType: 'application/pdf', size: '100', appProperties: { category: 'Tender documents' }, capabilities: { canEdit: true, canTrash: true } },
  { id: 'invoice', name: 'Invoice.pdf', mimeType: 'application/pdf', appProperties: { category: 'Invoices' }, capabilities: { canEdit: false, canTrash: false } },
  { id: 'folder', name: 'Contracts', mimeType: 'application/vnd.google-apps.folder' },
]
beforeEach(() => { vi.clearAllMocks(); drive.listFiles.mockResolvedValue(files); drive.getDriveSession.mockReturnValue({ accessToken: 'token' }); drive.trashFile.mockResolvedValue({ id: 'proposal' }) })
afterEach(cleanup)
const showLibrary = (folder = root) => render(<DocumentLibrary root={folder} settings={DEFAULT_DMS_SETTINGS} onSessionExpired={() => {}} />)

describe('Drive document library', () => {
  it('searches real loaded metadata and filters by category', async () => {
    showLibrary()
    await screen.findByText('Proposal.pdf')
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'proposal' } })
    expect(screen.queryByText('Invoice.pdf')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: '' } })
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Invoices')
    expect(screen.getByText('Invoice.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Proposal.pdf')).not.toBeInTheDocument()
  })

  it('requires confirmation before moving a document to trash', async () => {
    showLibrary()
    await screen.findByText('Proposal.pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Move Proposal.pdf to trash' }))
    expect(drive.trashFile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(drive.trashFile).toHaveBeenCalledWith('proposal', 'default'))
  })

  it('respects read-only Drive permissions', async () => {
    showLibrary({ ...root, capabilities: { canAddChildren: false } })
    await screen.findByText('Invoice.pdf')
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Rename Invoice.pdf' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Invoice.pdf to trash' })).not.toBeInTheDocument()
  })

  it('blocks disallowed files before sending bytes to Google', async () => {
    showLibrary()
    await screen.findByText('Proposal.pdf')
    fireEvent.change(screen.getByLabelText('Choose documents'), { target: { files: [new File(['binary'], 'program.exe')] } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not a supported document'))
    expect(drive.uploadFile).not.toHaveBeenCalled()
  })

  it('loads a selected subfolder and returns using breadcrumbs', async () => {
    showLibrary()
    await screen.findByRole('button', { name: 'Contracts' })
    await userEvent.click(screen.getByRole('button', { name: 'Contracts' }))
    await waitFor(() => expect(drive.listFiles).toHaveBeenCalledWith('folder', 'default'))
    await userEvent.click(screen.getByRole('button', { name: 'Company documents' }))
    await waitFor(() => expect(drive.listFiles).toHaveBeenLastCalledWith('root', 'default'))
  })
})
