import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), sync: vi.fn(), test: vi.fn(), folders: vi.fn(), connect: vi.fn(), notify: vi.fn(), canEdit: true }))
vi.mock('@/lib/auth', () => ({ useAuthUser: () => ({ user: { email: 'admin@amnex.com' } }) }))
vi.mock('@/lib/rbacTree', () => ({ useNodeAccess: () => mock.canEdit }))
vi.mock('./profileImagesClient', () => ({ PROFILE_IMAGES_QUERY: ['profileImages'], notifyProfileImages: mock.notify,
  profileImagesApi: { status: { query: mock.status }, save: { mutate: mock.save }, sync: { mutate: mock.sync }, test: { mutate: mock.test }, folders: { query: mock.folders }, connect: { mutate: mock.connect } } }))
import { ProfileImagesSettings } from './ProfileImagesSettings'
const saved = { folderId: 'folder-a', folderName: 'Team', accountEmail: 'admin@amnex.com', status: 'connected', imageCount: 2, matchedCount: 1, lastSyncAt: '2026-10-20T06:00:00Z', error: null, warnings: [], oauthReady: true }
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8088'); vi.clearAllMocks(); mock.canEdit = true
  mock.status.mockResolvedValue(saved); mock.save.mockResolvedValue({ ...saved, folderId: 'folder-b' }); mock.sync.mockResolvedValue(saved)
  mock.test.mockResolvedValue({ id: 'folder-b', name: 'New team' }); mock.folders.mockResolvedValue({ files: [{ id: 'folder-b', name: 'New team' }] })
})
afterEach(() => vi.unstubAllEnvs())
async function setup() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProfileImagesSettings /></QueryClientProvider>)
  await screen.findByLabelText(/^Profile Images folder/)
}
describe('Profile Images settings', () => {
  it('loads persisted status, extracts folder IDs, tests without saving, and refreshes after saving', async () => {
    await setup(); expect(screen.getByText('People matched')).toBeInTheDocument()
    const input = screen.getByLabelText(/^Profile Images folder/)
    fireEvent.change(input, { target: { value: 'https://drive.google.com/drive/folders/folder-b' } })
    expect(screen.getByText('Folder ID: folder-b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    await screen.findByText('Connection successful: New team'); expect(mock.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(mock.notify).toHaveBeenCalledTimes(1))
    expect(mock.save).toHaveBeenCalledWith({ folder: 'https://drive.google.com/drive/folders/folder-b' })
  })
  it('browses accessible folders and syncs the saved folder with an immediate refresh notification', async () => {
    await setup(); fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }))
    await waitFor(() => expect(mock.notify).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Browse folders' }))
    fireEvent.change(await screen.findByLabelText('Accessible Google Drive folders'), { target: { value: 'folder-b' } })
    expect(screen.getByLabelText(/^Profile Images folder/)).toHaveValue('folder-b')
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeDisabled()
  })
  it('rejects malformed URLs and disables configuration actions without DMS edit permission', async () => {
    await setup(); fireEvent.change(screen.getByLabelText(/^Profile Images folder/), { target: { value: 'https://evil.example/folder' } })
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
    mock.canEdit = false
    fireEvent.change(screen.getByLabelText(/^Profile Images folder/), { target: { value: 'folder-b' } })
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeDisabled()
  })
  it('shows persisted sync errors and ambiguous matching diagnostics', async () => {
    mock.status.mockResolvedValue({ ...saved, status: 'error', error: 'Google Drive access denied.', warnings: ['Ambiguous filename: Jane Doe.jpg'] })
    await setup(); expect(screen.getByRole('alert')).toHaveTextContent('Google Drive access denied.')
    expect(screen.getByText('1 matching errors')).toBeInTheDocument()
  })
})
