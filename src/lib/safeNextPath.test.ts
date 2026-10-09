import { describe, it, expect } from 'vitest'
import { safeNextPath } from './safeNextPath'

describe('safeNextPath', () => {
  it('keeps app-relative paths including query and hash', () => {
    expect(safeNextPath('/sales/roster?tab=a#x')).toBe('/sales/roster?tab=a#x')
    expect(safeNextPath('/bid-tracker/bid/42')).toBe('/bid-tracker/bid/42')
  })

  it.each([null, undefined, '', 'sales', 'https://evil.example/x', '//evil.example', '/\\evil.example', '/\\/evil.example', 'javascript:alert(1)', '/a\nb', '/a\u0000b'])(
    'falls back to / for %j',
    (raw) => {
      expect(safeNextPath(raw as string | null | undefined)).toBe('/')
    },
  )

  it('never returns to /login itself', () => {
    expect(safeNextPath('/login')).toBe('/')
    expect(safeNextPath('/login?next=/sales')).toBe('/')
  })
})
