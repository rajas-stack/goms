import { describe, expect, it } from 'vitest'
import { CFB, read } from 'xlsx'
import {
  assertOfficeFile, blankOfficeFile, crc32, DOCUMENT_TYPE_FOR_FILE_TYPE, downloadName, fileTypeForName, hasZipMagic,
  keyBelongsTo, makerDocumentKey, MAKER_LIMITS, normalizeMakerTitle, titleFromFileName,
} from './index.js'

const decoder = new TextDecoder()

/** Entry name → text, read back with SheetJS's own zip reader (an independent implementation). */
function unzip(bytes: Uint8Array): Map<string, string> {
  const container = CFB.read(bytes, { type: 'array' })
  const out = new Map<string, string>()
  container.FullPaths.forEach((path, i) => {
    const entry = container.FileIndex[i]
    if (entry.type === 2 && entry.content) out.set(path.replace(/^[^/]*\//, ''), decoder.decode(entry.content as Uint8Array))
  })
  return out
}

/** Every start tag is closed in order (enough to catch a typo in a template). */
function wellFormed(xml: string): boolean {
  const stack: string[] = []
  for (const match of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    if (selfClosing) continue
    if (closing) { if (stack.pop() !== name) return false } else stack.push(name)
  }
  return stack.length === 0
}

describe('document maker rules', () => {
  it('normalizes titles and rejects empty or long ones', () => {
    expect(normalizeMakerTitle('  Q3\tplan  ')).toBe('Q3 plan')
    expect(() => normalizeMakerTitle('   ')).toThrow('Enter a name')
    expect(() => normalizeMakerTitle(42)).toThrow()
    expect(() => normalizeMakerTitle('x'.repeat(MAKER_LIMITS.title + 1))).toThrow('under')
  })

  it('issues a new key per version and recognises its own keys only', () => {
    const id = '1b2c3d4e-0000-4000-8000-000000000001'
    expect(makerDocumentKey(id, 1)).not.toBe(makerDocumentKey(id, 2))
    expect(makerDocumentKey(id, 3)).toMatch(/^[0-9A-Za-z._=-]{1,128}$/)
    expect(keyBelongsTo(id, makerDocumentKey(id, 7))).toBe(true)
    expect(keyBelongsTo(id, makerDocumentKey('1b2c3d4e-0000-4000-8000-000000000002', 7))).toBe(false)
    expect(keyBelongsTo(id, `${makerDocumentKey(id, 1)}x`)).toBe(false)
    expect(() => makerDocumentKey(id, 0)).toThrow()
  })

  it('maps file types to ONLYOFFICE document types', () => {
    expect(DOCUMENT_TYPE_FOR_FILE_TYPE).toEqual({ docx: 'word', xlsx: 'cell', pptx: 'slide' })
  })

  it('allows only Office extensions with zip content', () => {
    const zip = blankOfficeFile('docx')
    expect(fileTypeForName('Report.DOCX')).toBe('docx')
    expect(fileTypeForName('macro.docm')).toBeNull()
    expect(assertOfficeFile('a.xlsx', zip)).toBe('xlsx')
    expect(() => assertOfficeFile('a.exe', zip)).toThrow('.docx')
    expect(() => assertOfficeFile('a.docx', new TextEncoder().encode('<html>'))).toThrow('not a valid Office file')
    expect(() => assertOfficeFile('a.docx', new Uint8Array())).toThrow('empty')
    expect(() => assertOfficeFile('a.docx', zip, 10)).toThrow('smaller than')
  })

  it('builds file names and titles', () => {
    expect(downloadName({ title: 'Q3: plan/v2', fileType: 'pptx' })).toBe('Q3_ plan_v2.pptx')
    expect(titleFromFileName('Budget 2026.xlsx')).toBe('Budget 2026')
  })

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('blank Office files', () => {
  it.each(['docx', 'xlsx', 'pptx'] as const)('%s is a well-formed zip of well-formed XML', (type) => {
    const bytes = blankOfficeFile(type)
    expect(hasZipMagic(bytes)).toBe(true)
    const files = unzip(bytes)
    expect(files.get('[Content_Types].xml')).toContain('<Types')
    expect(files.get('_rels/.rels')).toContain('officeDocument')
    for (const [name, xml] of files) expect(wellFormed(xml), name).toBe(true)
  })

  it('opens the blank workbook in SheetJS', () => {
    const book = read(blankOfficeFile('xlsx'), { type: 'array' })
    expect(book.SheetNames).toEqual(['Sheet1'])
  })

  it('has the parts each editor needs', () => {
    expect([...unzip(blankOfficeFile('docx')).keys()]).toContain('word/document.xml')
    expect([...unzip(blankOfficeFile('pptx')).keys()]).toEqual(expect.arrayContaining([
      'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml',
    ]))
  })
})
