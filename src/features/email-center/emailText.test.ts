import { describe, expect, it } from 'vitest'
import { headerNames, linkLabel, parseEmailBody, parseQuotedHeader, unquote } from './emailText'

describe('parseEmailBody', () => {
  it('splits body, footer and quoted history', () => {
    const parsed = parseEmailBody('Hi team,\nSee below.\n\n--\nDisclaimer : confidential\n\nOn Mon, Ana wrote:\n> old text')
    expect(parsed.body).toBe('Hi team,\nSee below.')
    expect(parsed.footer).toBe('--\nDisclaimer : confidential')
    expect(parsed.quoted).toBe('On Mon, Ana wrote:\n> old text')
  })
  it('detects an Outlook header block without ">" quoting', () => {
    expect(parseEmailBody('FYI\n\nFrom: A <a@x.com>\nSent: today\nSubject: x').body).toBe('FYI')
  })
  it('keeps "From:" in normal prose when no Sent line follows', () => {
    expect(parseEmailBody('From: the field team\nall good').quoted).toBe('')
  })
  it('returns everything as body for a plain message', () => {
    expect(parseEmailBody('hello\nworld')).toEqual({ body: 'hello\nworld', footer: '', quoted: '' })
  })
})

describe('quoted header', () => {
  it('rejoins wrapped header fields and lists names', () => {
    const header = parseQuotedHeader(unquote('>\n> *From:* Hritika <h@x.com>\n> *To:* Saurabh Gupta <s@x.com>; Harsh\n> Pandit <h2@x.com>; sw@x.com\n> *Subject:* REC :- Design\n> and Maintenance\n>\n> Hello All,'))
    expect(header.fields.map(f => f.label)).toEqual(['From', 'To', 'Subject'])
    expect(headerNames(header.fields[1].value)).toEqual(['Saurabh Gupta', 'Harsh Pandit', 'sw@x.com'])
    expect(header.fields[2].value).toBe('REC :- Design and Maintenance')
    expect(header.rest).toBe('Hello All,')
  })
  it('labels links by host and first path segment', () => {
    expect(linkLabel('https://calendar.google.com/calendar/event?action=VIEW&eid=abc')).toBe('calendar.google.com/calendar')
  })
})
