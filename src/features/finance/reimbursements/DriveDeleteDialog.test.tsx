import { describe, expect, it } from 'vitest'
import { confirmCode } from './DriveDeleteDialog'

describe('Drive delete code', () => {
  it('is 6 characters of letters (both cases) and digits, without look-alikes', () => {
    const codes = Array.from({ length: 200 }, confirmCode)
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Za-km-z2-9]{6}$/)
    expect(new Set(codes).size).toBeGreaterThan(190)
  })
})
