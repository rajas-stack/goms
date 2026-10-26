import { describe, expect, it } from 'vitest'
import {
  allocateDirectoryNumber, BUILTIN_DIRECTORY_RANGES, directoryCategoryKey, DirectoryRangeFullError, employeeNumberClash,
  ensureCategoryRanges, formatAmnexId, matchCategoryPhotos,
  nextDirectoryRange, parseEmployeeNumber, parsePhotoFilename, type DirectoryRange,
} from './index.js'

describe('directory ID ranges', () => {
  it('ships the five built-in 5,000-wide external ranges', () => {
    expect(BUILTIN_DIRECTORY_RANGES.map(r => [r.categoryKey, r.rangeStart, r.rangeEnd])).toEqual([
      ['clientDepartment', 1001, 6000], ['oem', 6001, 11000], ['competitor', 11001, 16000],
      ['consortium', 16001, 21000], ['external', 21001, 26000],
    ])
    for (const r of BUILTIN_DIRECTORY_RANGES) expect(r.rangeEnd - r.rangeStart + 1).toBe(5000)
  })

  it('gives a new category the next unallocated range, never reusing a gap', () => {
    expect(nextDirectoryRange(BUILTIN_DIRECTORY_RANGES)).toEqual({ rangeStart: 26001, rangeEnd: 31000 })
    const withCustom = [...BUILTIN_DIRECTORY_RANGES, { rangeStart: 26001, rangeEnd: 31000 }]
    expect(nextDirectoryRange(withCustom)).toEqual({ rangeStart: 31001, rangeEnd: 36000 })
    // A deleted category's range stays recorded, so leaving it out of the list is the caller's bug, not a gap to refill.
    expect(nextDirectoryRange([{ rangeStart: 31001, rangeEnd: 36000 }])).toEqual({ rangeStart: 36001, rangeEnd: 41000 })
    expect(nextDirectoryRange([])).toEqual({ rangeStart: 26001, rangeEnd: 31000 })
  })

  it('allocates sequentially up to the last number in range, then refuses', () => {
    const range: DirectoryRange = { categoryKey: 'oem', rangeStart: 6001, rangeEnd: 11000, nextValue: 6001 }
    const first = allocateDirectoryNumber(range)
    expect(first.number).toBe(6001)
    expect(first.range.nextValue).toBe(6002)
    expect(range.nextValue).toBe(6001)
    const last = allocateDirectoryNumber({ ...range, nextValue: 11000 })
    expect(last.number).toBe(11000)
    expect(() => allocateDirectoryNumber(last.range)).toThrow(DirectoryRangeFullError)
  })
})

describe('Amnex employee numbers', () => {
  it('keeps digits exactly, including leading zeros, and accepts a typed prefix', () => {
    expect(parseEmployeeNumber('1234')).toBe('1234')
    expect(parseEmployeeNumber(' 0123 ')).toBe('0123')
    expect(parseEmployeeNumber('AIPL_0123')).toBe('0123')
    expect(parseEmployeeNumber('aipl-77')).toBe('77')
    expect(formatAmnexId('0123')).toBe('AIPL_0123')
  })

  it('rejects anything that is not a whole number', () => {
    for (const bad of ['', '12a', '1 2', '-5', '1.5', 'AIPL_', 'x1234']) expect(parseEmployeeNumber(bad)).toBeNull()
  })
})

describe('parsePhotoFilename', () => {
  it('reads plain IDs and every AIPL/APIL separator and case variant', () => {
    expect(parsePhotoFilename('6001.jpg')).toEqual({ number: '6001', nameKey: null })
    for (const name of ['aipl1234.png', 'APIL_1234.jpg', 'Aipl 1234.webp', 'AIPL-1234.jpeg', 'aipl__1234.jpg'])
      expect(parsePhotoFilename(name)).toEqual({ number: '1234', nameKey: null })
  })

  it('reads names alone and names combined with an ID in either order', () => {
    expect(parsePhotoFilename('Mr. Asha Rao.jpg')).toEqual({ number: null, nameKey: 'asharao' })
    expect(parsePhotoFilename('Asha Rao 6001.jpg')).toEqual({ number: '6001', nameKey: 'asharao' })
    expect(parsePhotoFilename('6001 - Asha Rao.png')).toEqual({ number: '6001', nameKey: 'asharao' })
    expect(parsePhotoFilename('Asha_Rao_AIPL-0042.jpg')).toEqual({ number: '0042', nameKey: 'asharao' })
  })

  it('ignores non-image files', () => {
    expect(parsePhotoFilename('6001.gif')).toBeNull()
    expect(parsePhotoFilename('notes.pdf')).toBeNull()
  })
})

describe('matchCategoryPhotos', () => {
  const people = [
    { id: 'asha', name: 'Asha Rao', numbers: ['6001'] },
    { id: 'ravi', name: 'Ravi Kumar', numbers: ['6002'] },
    { id: 'amit1', name: 'Amit Shah', numbers: ['6003'] },
    { id: 'amit2', name: 'Amit Shah', numbers: ['6004'] },
    { id: 'zero', name: 'Zed', numbers: ['0123'] },
  ]
  const file = (id: string, name: string) => ({ id, name })

  it('matches by exact ID, by unique name, and by name plus ID', () => {
    const result = matchCategoryPhotos([file('f1', '6001.jpg'), file('f2', 'Ravi Kumar.png'), file('f3', 'Amit Shah 6004.jpg')], people)
    expect(result.mappings).toEqual({ asha: 'f1', ravi: 'f2', amit2: 'f3' })
  })

  it('never guesses digits', () => {
    const result = matchCategoryPhotos([file('f1', '123.jpg'), file('f2', '600.jpg'), file('f3', '60010.jpg')], people)
    expect(result.mappings).toEqual({})
    expect(result.unmatched).toHaveLength(3)
  })

  it('flags a name and ID that point at different people instead of matching', () => {
    const result = matchCategoryPhotos([file('f1', 'Asha Rao 6002.jpg')], people)
    expect(result.mappings).toEqual({})
    expect(result.conflicts).toEqual(['Asha Rao 6002.jpg: the name is Asha Rao but ID 6002 belongs to Ravi Kumar.'])
  })

  it('leaves a shared name unmatched unless an ID settles it', () => {
    const result = matchCategoryPhotos([file('f1', 'Amit Shah.jpg')], people)
    expect(result.mappings).toEqual({})
    expect(result.unmatched).toEqual(['Amit Shah.jpg: more than one person is named Amit Shah. Add their ID to the file name.'])
  })

  it('matches by ID with a warning when the file name carries an unknown name', () => {
    const result = matchCategoryPhotos([file('f1', 'A Rao 6001.jpg')], people)
    expect(result.mappings).toEqual({ asha: 'f1' })
    expect(result.warnings).toEqual(['A Rao 6001.jpg: matched by ID 6001 to Asha Rao; the name in the file differs.'])
  })

  it('reports two photos for one person as a duplicate and uses neither', () => {
    const result = matchCategoryPhotos([file('f1', '6001.jpg'), file('f2', 'Asha Rao.jpg')], people)
    expect(result.mappings).toEqual({})
    expect(result.duplicates).toEqual(['Asha Rao has 2 photos (6001.jpg, Asha Rao.jpg). Keep one.'])
  })

  it('lists people still without a photo', () => {
    const result = matchCategoryPhotos([file('f1', '6001.jpg')], people)
    expect(result.missing).toEqual(['ravi', 'amit1', 'amit2', 'zero'])
  })
})

describe('category ranges from the Directory Types master', () => {
  it('maps built-in codes to their ranges and skips Amnex', () => {
    expect(directoryCategoryKey('department')).toBe('clientDepartment')
    expect(directoryCategoryKey('competitors')).toBe('competitor')
    expect(directoryCategoryKey('oem')).toBe('oem')
    expect(directoryCategoryKey('internal')).toBeNull()
    expect(directoryCategoryKey(' Govt-Bodies ')).toBe('govt-bodies')
  })

  it('adds a range for each new category in order, keeping existing ones untouched', () => {
    const ranges = ensureCategoryRanges(BUILTIN_DIRECTORY_RANGES, ['internal', 'department', 'govt', 'ngo', 'govt'])
    expect(ranges.slice(0, 5)).toEqual(BUILTIN_DIRECTORY_RANGES)
    expect(ranges.slice(5).map(r => [r.categoryKey, r.rangeStart, r.rangeEnd, r.nextValue])).toEqual([
      ['govt', 26001, 31000, 26001], ['ngo', 31001, 36000, 31001],
    ])
    expect(ensureCategoryRanges(ranges, ['govt'])).toBe(ranges)
  })
})

describe('employee number uniqueness', () => {
  const holders = [
    { number: '1234', email: 'asha@amnex.com', name: 'Asha Rao' },
    { number: '0042', email: '', name: 'No Mail' },
  ]
  it('allows a number held only by the same person (same email on another roster)', () => {
    expect(employeeNumberClash('1234', 'ASHA@amnex.com', holders)).toBeNull()
    expect(employeeNumberClash('9999', 'x@amnex.com', holders)).toBeNull()
  })
  it('rejects a number held by someone else, comparing digits exactly', () => {
    expect(employeeNumberClash('1234', 'ravi@amnex.com', holders)?.name).toBe('Asha Rao')
    expect(employeeNumberClash('0042', '', holders)?.name).toBe('No Mail')
    expect(employeeNumberClash('42', 'z@amnex.com', holders)).toBeNull()
  })
})
