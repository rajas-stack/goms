import { describe, expect, it } from 'vitest'
import { diffText, tokenize } from './textDiff'

const changed = (segments: { type: string; text: string }[], type: string) => segments.filter((s) => s.type === type).map((s) => s.text)

describe('tokenize', () => {
  it('keeps currency amounts, percentages and words as single tokens', () => {
    expect(tokenize('₹100 Crore, 40% on Go-Live').map((t) => t.word)).toEqual(['₹100', 'Crore', ',', '40%', 'on', 'Go', '-', 'Live'])
  })
})

describe('diffText', () => {
  it('reports identical text as having no changes', () => {
    const d = diffText('Same clause text.', 'Same clause text.')
    expect(d.identical).toBe(true)
    expect(d.hunks).toEqual([])
    expect(d.original).toEqual([{ type: 'same', text: 'Same clause text.' }])
  })

  it('highlights only the changed number, and widens WHAT CHANGED to include the unit', () => {
    const d = diffText(
      'Average annual turnover of ₹100 Crore over the last three financial years.',
      'Average annual turnover of ₹75 Crore over the last three financial years.',
    )
    expect(changed(d.original, 'removed')).toEqual(['₹100'])
    expect(changed(d.modified, 'added')).toEqual(['₹75'])
    expect(d.hunks).toEqual([{ kind: 'modified', before: '₹100 Crore', after: '₹75 Crore', valueKind: 'number' }])
  })

  it('reads a changed day as a whole date change', () => {
    const d = diffText('Bid submission end date: 30 Oct 2026, 15:00 hrs', 'Bid submission end date: 14 Nov 2026, 15:00 hrs')
    expect(changed(d.original, 'removed')).toEqual(['30 Oct'])
    expect(changed(d.modified, 'added')).toEqual(['14 Nov'])
    expect(d.hunks).toEqual([{ kind: 'modified', before: '30 Oct 2026', after: '14 Nov 2026', valueKind: 'date' }])
  })

  it('detects numeric dates', () => {
    const d = diffText('Due on 15/10/2026.', 'Due on 20/10/2026.')
    expect(d.hunks[0]).toMatchObject({ before: '15/10/2026', after: '20/10/2026', valueKind: 'date' })
  })

  it('marks added and deleted words separately from modifications', () => {
    const d = diffText('Supply of cameras with installation', 'Supply of IP cameras')
    expect(changed(d.modified, 'added')).toEqual(['IP'])
    expect(changed(d.original, 'removed')).toEqual(['with installation'])
    expect(d.hunks.map((h) => h.kind)).toEqual(['added', 'removed'])
    expect(d.hunks[1]).toMatchObject({ before: 'with installation', after: '', valueKind: 'text' })
  })

  it('handles a wholly new clause and a deleted clause', () => {
    expect(diffText('', 'New clause').hunks).toEqual([{ kind: 'added', before: '', after: 'New clause', valueKind: 'text' }])
    expect(diffText('Old clause', '').hunks).toEqual([{ kind: 'removed', before: 'Old clause', after: '', valueKind: 'text' }])
  })

  it('reports several independent changes in order', () => {
    const d = diffText('40% on Go-Live and 60% over 5 years', '30% on Go-Live and 70% over 5 years')
    expect(d.hunks.map((h) => [h.before, h.after])).toEqual([['40%', '30%'], ['60%', '70%']])
  })

  it('reconstructs both texts exactly from the segments', () => {
    const before = 'Project Manager: 1 No., minimum 15 years experience in ITS projects.'
    const after = 'Project Manager: 1 No., minimum 12 years experience in Smart City or ITS projects.'
    const d = diffText(before, after)
    expect(d.original.map((s) => s.text).join('')).toBe(before)
    expect(d.modified.map((s) => s.text).join('')).toBe(after)
  })
})
