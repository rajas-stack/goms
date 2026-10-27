import { describe, expect, it } from 'vitest'
import { fileName, formatSize, parseVCards, previewOf } from './Attachments'

describe('parseVCards', () => {
  it('reads every card: name, organisation, all numbers, folded lines', () => {
    const text = [
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Rao;Asha;;;', 'FN:Asha Rao', 'ORG:Amnex;', 'item1.TEL;waid=919811111111:+91 98111 11111',
      'item1.X-ABLabel:Mobile', 'TEL;TYPE=WORK:+91 79 4000', ' 0000', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul', 'END:VCARD',
    ].join('\r\n')
    const cards = parseVCards(text)
    expect(cards.map(({ vcard: _, ...card }) => card)).toEqual([
      { name: 'Asha Rao', org: 'Amnex', phones: ['+91 98111 11111', '+91 79 40000000'] },
      { name: 'Rahul', phones: [] },
    ])
    expect(cards[0].vcard).toMatch(/^BEGIN:VCARD[\s\S]*END:VCARD$/)
  })
  it('finds nothing in plain text', () => expect(parseVCards('hello')).toEqual([]))
})

describe('previewOf', () => {
  it('opens spreadsheets and Word files in their own format, converts only what browsers cannot draw, plays media, downloads the rest', () => {
    expect(previewOf({ mimetype: 'application/pdf', filename: 'Tender.pdf' })).toBe('pdf')
    expect(previewOf({ mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'BOQ.xlsx' })).toBe('sheet')
    expect(previewOf({ mimetype: 'application/vnd.ms-excel', filename: 'Old.xls' })).toBe('sheet')
    expect(previewOf({ mimetype: 'text/csv', filename: 'rates.csv' })).toBe('sheet')
    expect(previewOf({ mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'Letter.docx' })).toBe('word')
    expect(previewOf({ mimetype: 'text/plain', filename: 'notes.txt' })).toBe('text')
    expect(previewOf({ mimetype: 'application/msword', filename: 'Letter.doc' })).toBe('convert')
    expect(previewOf({ mimetype: 'application/octet-stream', filename: 'Deck.PPTX' })).toBe('convert')
    expect(previewOf({ mimetype: 'image/png', filename: 'scan.png' })).toBe('image')
    expect(previewOf({ mimetype: 'application/zip', filename: 'files.zip' })).toBeNull()
  })
})

describe('fileName and formatSize', () => {
  it('names unnamed media from its type and time, and keeps real names', () => {
    expect(fileName({ type: 'image', timestamp: 1700000000 }, { mimetype: 'image/jpeg' })).toBe('WhatsApp image 2023-11-14-22-13-20.jpg')
    expect(fileName({ type: 'voice', timestamp: 1700000000 }, { mimetype: 'audio/ogg; codecs=opus' })).toMatch(/\.ogg$/)
    expect(fileName({ type: 'document', timestamp: 1 }, { mimetype: 'application/pdf', filename: 'Tender.pdf' })).toBe('Tender.pdf')
  })
  it('shows KB below a megabyte and one decimal above', () => {
    expect(formatSize(9 * 1024)).toBe('9 KB')
    expect(formatSize(151.7 * 1024 * 1024)).toBe('151.7 MB')
  })
})
