import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
describe('CSV spreadsheet safety', () => {
  it('neutralizes formulas, including whitespace and control-character prefixes', () => {
    for (const value of ['=1+1', '+cmd', '-1+cmd', '@SUM(A1)', '  =cmd', '\t=cmd']) expect(toCsv([[value]])).toBe(`'${value}`)
  })
  it('preserves ordinary text and negative numbers and still escapes delimiters', () => {
    expect(toCsv([['-12.5', 'name', 'a,b', 'a"b']])).toBe('-12.5,name,"a,b","a""b"')
  })
})
