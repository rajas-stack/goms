import { describe, expect, it } from 'vitest'
import { blankOfficeFile, hasZipMagic } from '@goms/domain'
import {
  base64ToBytes, bytesToBase64, createLocal, duplicateLocal, LOCAL_OWNER, renameLocal, replaceLocal, requireLocal, toPublic, uploadLocal,
} from './makerDocuments'

const b64 = (type: 'docx' | 'xlsx' | 'pptx') => bytesToBase64(blankOfficeFile(type))

describe('local Document maker store', () => {
  it('creates a blank Office file of the requested kind', () => {
    const doc = createLocal('spreadsheet', ' Budget ', LOCAL_OWNER)
    expect(doc).toMatchObject({ kind: 'spreadsheet', fileType: 'xlsx', title: 'Budget', version: 1, ownerName: 'This device' })
    expect(hasZipMagic(base64ToBytes(doc.contentBase64))).toBe(true)
    expect(toPublic(doc)).not.toHaveProperty('contentBase64')
  })

  it('round-trips base64 for large files', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('uploads only Office files and derives kind and title from the name', () => {
    expect(uploadLocal('Deck v2.pptx', b64('pptx'), LOCAL_OWNER)).toMatchObject({ kind: 'presentation', title: 'Deck v2' })
    expect(() => uploadLocal('notes.txt', b64('docx'), LOCAL_OWNER)).toThrow('.docx')
    expect(() => uploadLocal('fake.docx', btoa('<html>'), LOCAL_OWNER)).toThrow('not a valid Office file')
  })

  it('renames and duplicates without changing the original', () => {
    const original = createLocal('document', 'Plan', LOCAL_OWNER)
    const renamed = renameLocal(original, 'Final plan')
    expect(original.title).toBe('Plan')
    expect(renamed).toMatchObject({ id: original.id, title: 'Final plan' })
    expect(() => renameLocal(original, '  ')).toThrow()
    const copy = duplicateLocal(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.title).toBe('Copy of Plan')
    expect(copy.contentBase64).toBe(original.contentBase64)
  })

  it('replacing content bumps the version and the document key; type must match', () => {
    const doc = createLocal('document', 'Plan', LOCAL_OWNER)
    const next = replaceLocal(doc, 'Plan.docx', b64('docx'))
    expect(next.version).toBe(2)
    expect(next.documentKey).not.toBe(doc.documentKey)
    expect(() => replaceLocal(doc, 'Plan.xlsx', b64('xlsx'))).toThrow('.docx')
  })

  it('reports a missing file', () => {
    expect(() => requireLocal([], 'nope')).toThrow('File not found.')
  })
})
