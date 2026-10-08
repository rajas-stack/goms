import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DMS_SETTINGS, DMS_SETTINGS_KEY, folderIdFromInput, loadSettings, saveSettings, validateSettings, validateUpload } from './settings'

describe('DMS configuration', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts Drive folder links, shared-drive links and IDs', () => {
    expect(folderIdFromInput('https://drive.google.com/drive/u/0/folders/folder_123-abc?usp=sharing')).toBe('folder_123-abc')
    expect(folderIdFromInput('https://drive.google.com/open?id=shared-folder')).toBe('shared-folder')
    expect(folderIdFromInput(' folder-123 ')).toBe('folder-123')
    expect(() => folderIdFromInput('https://example.com/folders/123')).toThrow('Google Drive folder')
  })

  it('persists the user-entered client ID and normalizes the root folder', () => {
    const settings = saveSettings({ ...DEFAULT_DMS_SETTINGS, clientId: ' 123-user.apps.googleusercontent.com ', rootFolderId: 'https://drive.google.com/drive/folders/company-docs' })
    expect(loadSettings()).toEqual(settings)
    expect(settings.clientId).toBe('123-user.apps.googleusercontent.com')
    expect(settings.rootFolderId).toBe('company-docs')
  })

  it('persists provider changes and keeps Google configuration available for switching back', () => {
    saveSettings({ ...DEFAULT_DMS_SETTINGS, provider: 'external', externalUrl: 'https://portal.example.com', clientId: '123-user.apps.googleusercontent.com' })
    expect(loadSettings().provider).toBe('external')
    expect(loadSettings().clientId).toBe('123-user.apps.googleusercontent.com')
  })

  it('rejects unsafe portal URLs and invalid client IDs', () => {
    for (const externalUrl of ['javascript:alert(1)', 'http://example.com', '']) {
      expect(() => validateSettings({ ...DEFAULT_DMS_SETTINGS, provider: 'external', externalUrl })).toThrow()
    }
    expect(() => validateSettings({ ...DEFAULT_DMS_SETTINGS, clientId: 'not-a-client-id' })).toThrow('OAuth')
  })

  it('does not persist tokens or arbitrary fields', () => {
    saveSettings({ ...DEFAULT_DMS_SETTINGS, accessToken: 'never-store-this' } as typeof DEFAULT_DMS_SETTINGS)
    expect(storage.get(DMS_SETTINGS_KEY)).not.toContain('never-store-this')
  })

  it('recovers safely from malformed saved configuration', () => {
    storage.set(DMS_SETTINGS_KEY, '{broken')
    expect(loadSettings()).toEqual(DEFAULT_DMS_SETTINGS)
    storage.set(DMS_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_DMS_SETTINGS, maxUploadMb: -5 }))
    expect(loadSettings()).toEqual(DEFAULT_DMS_SETTINGS)
  })

  it('enforces file sizes and file policies before upload', () => {
    expect(() => validateUpload({ name: 'proposal.pdf', size: 2048 }, DEFAULT_DMS_SETTINGS)).not.toThrow()
    expect(() => validateUpload({ name: 'proposal.pdf', size: 51 * 1024 * 1024 }, DEFAULT_DMS_SETTINGS)).toThrow('50 MB')
    expect(() => validateUpload({ name: 'empty.pdf', size: 0 }, DEFAULT_DMS_SETTINGS)).toThrow('empty')
    expect(() => validateUpload({ name: 'app.exe', size: 10 }, DEFAULT_DMS_SETTINGS)).toThrow('supported document')
    expect(() => validateUpload({ name: 'proposal.docx', size: 10 }, { ...DEFAULT_DMS_SETTINGS, allowedFiles: 'pdf' })).toThrow('Only PDF')
    expect(() => validateUpload({ name: 'archive.zip', size: 10 }, { ...DEFAULT_DMS_SETTINGS, allowedFiles: 'all' })).not.toThrow()
  })
  it('allows a cleared upload limit and limits above the previous 100 MB cap', () => {
    expect(validateSettings({ ...DEFAULT_DMS_SETTINGS, maxUploadMb: null }).maxUploadMb).toBeNull()
    expect(validateSettings({ ...DEFAULT_DMS_SETTINGS, maxUploadMb: 500 }).maxUploadMb).toBe(500)
    expect(() => validateUpload({ name: 'large.pdf', size: 999 * 1024 * 1024 }, { ...DEFAULT_DMS_SETTINGS, maxUploadMb: null })).not.toThrow()
  })
})
