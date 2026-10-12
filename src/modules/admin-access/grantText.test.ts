import { describe, expect, it } from 'vitest'
import { grantChips, levelText, scopeWord } from './grantText'

describe('levelText', () => {
  it('words each level the way the generated permission matrix does', () => {
    expect(levelText('N', 'all', [])).toBe('No access')
    expect(levelText('R', 'all', [])).toBe('Read only')
    expect(levelText('W', 'all', [])).toBe('Read + edit all')
    expect(levelText('P', 'all', ['L2'])).toBe('Read + edit some fields (L2)')
  })
  it('adds the scope for edit levels and lists several field sets', () => {
    expect(levelText('W', 'own', [])).toBe('Read + edit all · own rows only')
    expect(levelText('P', 'asg', ['P1', 'X1'])).toBe('Read + edit some fields (P1, X1) · assigned rows only')
  })
  it('never adds a scope to a level that cannot edit', () => {
    expect(levelText('R', 'own', [])).toBe('Read only')
    expect(levelText('N', 'asg', [])).toBe('No access')
  })
})

describe('scopeWord', () => {
  it('names own and assigned scopes and says nothing for all', () => {
    expect(scopeWord('own')).toBe('own rows only')
    expect(scopeWord('asg')).toBe('assigned rows only')
    expect(scopeWord('all')).toBe('')
  })
})

describe('grantChips', () => {
  it('lists Create and Delete only when granted', () => {
    expect(grantChips({ create: true, delete: false })).toEqual(['Create'])
    expect(grantChips({ create: true, delete: true })).toEqual(['Create', 'Delete'])
    expect(grantChips({ create: false, delete: false })).toEqual([])
  })
})
