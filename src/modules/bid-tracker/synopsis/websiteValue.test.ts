import { describe, expect, it } from 'vitest'
import type { TenderWebsite } from '@goms/domain'
import { entryLabel, formatWebsiteLine, parseWebsiteValue, websitesFromLabels } from './websiteValue'

const site = (id: string, name: string, url: string): TenderWebsite => ({ id, name, url, createdAt: '', updatedAt: '' })
const saved = [site('1', 'E-Proc', 'https://eproc.example.gov.in'), site('2', 'GeM', 'https://gem.gov.in')]

describe('website value', () => {
  it('parses named links, bare links and legacy free text', () => {
    expect(parseWebsiteValue('E-Proc (https://eproc.example.gov.in)\nhttps://cppp.gov.in\nsee tender notice')).toEqual([
      { kind: 'site', name: 'E-Proc', url: 'https://eproc.example.gov.in', line: 'E-Proc (https://eproc.example.gov.in)' },
      { kind: 'site', name: 'https://cppp.gov.in', url: 'https://cppp.gov.in', line: 'https://cppp.gov.in' },
      { kind: 'text', text: 'see tender notice', line: 'see tender notice' },
    ])
  })

  it('never treats a non-http link as a site', () => {
    expect(parseWebsiteValue('Evil (javascript:alert(1))')[0].kind).toBe('text')
  })

  it('labels stored lines with the current saved name for the same link', () => {
    const [entry] = parseWebsiteValue('Old name (https://gem.gov.in)')
    expect(entryLabel(entry, saved)).toBe('GeM')
  })

  it('adds chosen saved sites and keeps legacy lines that stay selected', () => {
    const current = 'see tender notice'
    expect(websitesFromLabels(['see tender notice', 'GeM'], current, saved)).toBe(`see tender notice\n${formatWebsiteLine(saved[1])}`)
    expect(websitesFromLabels(['GeM'], current, saved)).toBe('GeM (https://gem.gov.in)')
    expect(websitesFromLabels([], current, saved)).toBe('')
  })
})
