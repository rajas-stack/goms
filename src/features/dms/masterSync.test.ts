import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveConnection, type DmsConnection } from './connections'
import { DEFAULT_DMS_SETTINGS } from './settings'
import { syncMaster } from './masterSync'

const drive = vi.hoisted(() => ({ listFiles: vi.fn(), createFolder: vi.fn(), copyFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn(), getDriveSession: vi.fn() }))
vi.mock('./googleDrive', () => ({ ...drive, FOLDER_MIME: 'application/vnd.google-apps.folder' }))
const source: DmsConnection = { id: 'sales', name: 'Sales Drive', modules: ['sales'], isMaster: false, settings: { ...DEFAULT_DMS_SETTINGS, rootFolderId: 'sales-root' } }
const master: DmsConnection = { id: 'master', name: 'Master', modules: [], isMaster: true, settings: { ...DEFAULT_DMS_SETTINGS, rootFolderId: 'master-root' } }
const document = { id: 'proposal', name: 'Proposal.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-08T10:00:00Z' }
describe('Master DMS collection', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.clearAllMocks(); storage.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    saveConnection(source); saveConnection(master)
    drive.getDriveSession.mockReturnValue({ email: 'master@example.com' })
    drive.listFiles.mockImplementation(async (id: string) => id === 'sales-root' ? [document] : [])
    drive.createFolder.mockImplementation(async (name: string) => ({ id: 'sales-target', name, mimeType: 'application/vnd.google-apps.folder' }))
    drive.copyFile.mockResolvedValue({ id: 'master-copy' })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('groups copies into a subfolder named after their DMS', async () => {
    const result = await syncMaster(master)
    expect(result).toEqual({ copied: 1, skipped: 0, errors: [] })
    expect(drive.createFolder).toHaveBeenCalledWith('Sales Drive', 'master-root', 'master', { gomsSourceDms: 'sales', gomsSourceFile: 'sales-root' })
    expect(drive.copyFile).toHaveBeenCalledWith(document, 'sales-target', 'master', expect.objectContaining({ gomsSourceDms: 'sales', gomsSourceFile: 'proposal' }))
    expect(drive.trashFile).not.toHaveBeenCalled()
  })
  it('skips current copies instead of duplicating documents on every collection', async () => {
    drive.listFiles.mockImplementation(async (id: string) => id === 'sales-root' ? [document] : id === 'master-root' ? [{ id: 'sales-target', name: 'Sales Drive', mimeType: 'application/vnd.google-apps.folder', appProperties: { gomsSourceDms: 'sales', gomsSourceFile: 'sales-root' } }] : [{ ...document, id: 'copy', appProperties: { gomsSourceDms: 'sales', gomsSourceFile: 'proposal', gomsSourceModified: document.modifiedTime } }])
    expect(await syncMaster(master)).toEqual({ copied: 0, skipped: 1, errors: [] })
    expect(drive.copyFile).not.toHaveBeenCalled()
  })
  it('copies a valid replacement before retiring an outdated master copy', async () => {
    drive.listFiles.mockImplementation(async (id: string) => id === 'sales-root' ? [document] : id === 'sales-target' ? [{ ...document, id: 'old-copy', appProperties: { gomsSourceDms: 'sales', gomsSourceFile: 'proposal', gomsSourceModified: 'old' } }] : [])
    await syncMaster(master)
    expect(drive.trashFile).toHaveBeenCalledWith('old-copy', 'master')
    expect(drive.copyFile.mock.invocationCallOrder[0]).toBeLessThan(drive.trashFile.mock.invocationCallOrder[0])
  })
  it('reports inaccessible sources while preserving successful copies', async () => {
    saveConnection({ ...source, id: 'bids', name: 'Bid Drive', modules: ['opportunity'], settings: { ...source.settings, rootFolderId: 'bid-root' } })
    drive.listFiles.mockImplementation(async (id: string) => { if (id === 'bid-root') throw new Error('Share this folder with the master account.'); return id === 'sales-root' ? [document] : [] })
    const result = await syncMaster(master)
    expect(result.copied).toBe(1)
    expect(result.errors).toEqual(['Bid Drive: Share this folder with the master account.'])
  })
  it('requires the master connection and prevents collecting into a source root', async () => {
    drive.getDriveSession.mockReturnValue(null)
    await expect(syncMaster(master)).rejects.toThrow('Connect the master')
    drive.getDriveSession.mockReturnValue({})
    expect((await syncMaster({ ...master, settings: { ...master.settings, rootFolderId: 'sales-root' } })).errors[0]).toContain('different root folders')
  })
})
