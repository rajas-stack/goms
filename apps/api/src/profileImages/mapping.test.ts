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
  it('prioritizes IDs/emails, normalizes names and leaves unmatched people as initials', () => {
    const result = mapProfileImages('folder-a', [image(' ONE@AMNEX.COM.JPG'), image('Jose_A_Mehra.jpg'), image('Jane-Doe.png', 'j', 'image/png'), image('nobody.jpg')], people)
    expect(result.mappings['u-1'].fileId).toBe(' ONE@AMNEX.COM.JPG')
    expect(result.mappings['u-2'].fileId).toBe('j')
    expect(result.errors).toEqual([])
    expect(mapProfileImages('folder-a', [], people).mappings).toEqual({})
  })
  it('refuses duplicate full names and duplicate matching files, but accepts unique IDs for duplicate names', () => {
    const duplicates = people.map(person => ({ ...person, name: 'Same Name' }))
    const result = mapProfileImages('folder-a', [image('Same_Name.jpg'), image('u-1.jpg')], duplicates)
    expect(Object.keys(result.mappings)).toEqual(['u-1']); expect(result.errors[0]).toContain('Ambiguous')
    const multiple = mapProfileImages('folder-a', [image('u-1.jpg'), image('one@amnex.com.png', 'second', 'image/png')], people)
    expect(multiple.mappings).toEqual({}); expect(multiple.errors[0]).toContain('Multiple images')
  })
  it('refuses ambiguous email addresses, even when a name could match', () => {
    const result = mapProfileImages('folder-a', [image('one@amnex.com.jpg')], [people[0], { ...people[1], email: people[0].email }])
    expect(result.mappings).toEqual({}); expect(result.errors).toHaveLength(1)
  })
  it('versions replacements and folder switches independently', () => {
    const file = image('one.jpg')
    expect(profileVersion('folder-a', file)).not.toBe(profileVersion('folder-a', { ...file, version: '2' }))
    expect(profileVersion('folder-a', file)).not.toBe(profileVersion('folder-b', file))
  })
})
