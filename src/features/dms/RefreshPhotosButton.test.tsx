import { describe, expect, it } from 'vitest'
import { refreshMessage } from './RefreshPhotosButton'

const base = { configured: true, folderName: 'Sales Team', lastSyncAt: null, warnings: [], error: null }
describe('Refresh photos result', () => {
  it('reports matches and photos still waiting for a matching name', () => {
    expect(refreshMessage({ ...base, imageCount: 31, matchedCount: 30, waiting: ['Aarushi Joshi.png'] })).toBe('Photos refreshed: 30 of 31 matched · 1 waiting for a matching name.')
    expect(refreshMessage({ ...base, imageCount: 31, matchedCount: 31, waiting: [] })).toBe('Photos refreshed: 31 of 31 matched.')
  })
  it('surfaces Drive errors instead of a success message', () => {
    expect(refreshMessage({ ...base, imageCount: 0, matchedCount: 0, waiting: [], error: 'Google Drive authorization expired. Reconnect Google Drive.' })).toContain('could not be refreshed')
  })
})
