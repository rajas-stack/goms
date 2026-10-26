import { describe, expect, it } from 'vitest'
import { isProfileImage, mapProfileImages, profileFolderId, profileVersion, type ProfileFile } from './mapping.js'

const people = [{ id: 'u-1', email: 'one@amnex.com', name: 'José A. Mehra' }, { id: 'u-2', email: 'two@amnex.com', name: 'Jane Doe' }]
const image = (name: string, id = name, mimeType = 'image/jpeg'): ProfileFile => ({ id, name, mimeType, version: '1', parents: ['folder-a'] })
describe('Drive profile matching', () => {
  it('extracts validated folder IDs, including account-specific Drive URLs', () => {
    for (const value of ['folder-a', 'https://drive.google.com/drive/folders/folder-a?usp=sharing', 'https://drive.google.com/drive/u/0/folders/folder-a', 'https://drive.google.com/open?id=folder-a']) expect(profileFolderId(value)).toBe('folder-a')
    for (const value of ['https://evil.example/drive/folders/folder-a', 'http://drive.google.com/drive/folders/folder-a', 'https://drive.google.com/file/d/image-a/view', "folder' or true"]) expect(() => profileFolderId(value)).toThrow('Google Drive folder')
  })
  it('indexes only supported raster files with matching MIME types', () => {
    expect(isProfileImage(image('one.JPG'))).toBe(true)
    expect(isProfileImage(image('one.webp', 'w', 'image/webp'))).toBe(true)
    for (const file of [image('one.svg'), image('one.png', 'x', 'text/html'), { ...image('one.jpg'), trashed: true }]) expect(isProfileImage(file)).toBe(false)
  })
  it('matches by normalized full name only and leaves people without a photo as initials', () => {
    const result = mapProfileImages('folder-a', [image('Jose_A_Mehra.jpg'), image('Jane-Doe.png', 'j', 'image/png'), image('one@amnex.com.jpg')], people)
    expect(result.mappings['u-1'].fileId).toBe('Jose_A_Mehra.jpg')
    expect(result.mappings['u-2'].fileId).toBe('j')
    expect(mapProfileImages('folder-a', [], people).mappings).toEqual({})
  })
  it('keeps photos without a matching person waiting, not as errors, and binds them once the person exists', () => {
    const before = mapProfileImages('folder-a', [image('New Joiner.jpg')], people)
    expect(before.mappings).toEqual({}); expect(before.errors).toEqual([]); expect(before.waiting).toEqual(['New Joiner.jpg'])
    const after = mapProfileImages('folder-a', [image('New Joiner.jpg')], [...people, { id: 'u-3', email: null, name: 'New Joiner' }])
    expect(after.mappings['u-3'].fileId).toBe('New Joiner.jpg'); expect(after.waiting).toEqual([])
  })
  it('refuses duplicate full names and multiple photos for one person', () => {
    const duplicates = people.map(person => ({ ...person, name: 'Same Name' }))
    const result = mapProfileImages('folder-a', [image('Same_Name.jpg')], duplicates)
    expect(result.mappings).toEqual({}); expect(result.errors[0]).toContain('more than one person')
    const multiple = mapProfileImages('folder-a', [image('Jane Doe.jpg'), image('jane-doe.png', 'second', 'image/png')], people)
    expect(multiple.mappings).toEqual({}); expect(multiple.errors[0]).toContain('has 2 photos')
  })
  it('versions replacements and folder switches independently', () => {
    const file = image('one.jpg')
    expect(profileVersion('folder-a', file)).not.toBe(profileVersion('folder-a', { ...file, version: '2' }))
    expect(profileVersion('folder-a', file)).not.toBe(profileVersion('folder-b', file))
  })
  it('binds an employee photo to their org, linked team and Sales records', () => {
    const rows = [
      { id: 'org', name: 'Mr. User One', email: '', source: 'org' },
      { id: 'team', name: 'User One', email: '', source: 'preSales', orgPersonId: 'org' },
      { id: 'sales', name: 'User One', email: 'one@amnex.com', source: 'sales' },
    ]
    const result = mapProfileImages('folder-a', [image('User One.png', 'photo', 'image/png')], rows)
    expect(Object.keys(result.mappings).sort()).toEqual(['org', 'sales', 'team'])
    expect(result.mappings.org.scope).toBe('internal'); expect(result.mappings.sales.scope).toBe('sales')
    expect(new Set(Object.values(result.mappings).map(m => m.fileId)).size).toBe(1)
    expect(mapProfileImages('folder-a', [image('User One.jpg')], rows).errors).toEqual([])
  })
  it('keeps duplicate people in a roster and same-name people with different emails ambiguous', () => {
    const rows = [{ ...people[0], name: 'Same Name', source: 'org' }, { ...people[1], name: 'Same Name', source: 'sales' }]
    expect(mapProfileImages('folder-a', [image('Same Name.jpg')], rows).mappings).toEqual({})
    const duplicate = rows.map(p => ({ ...p, source: 'sales', email: 'shared@amnex.com' }))
    expect(mapProfileImages('folder-a', [image('Same Name.jpg')], duplicate).mappings).toEqual({})
  })
})
