import { expect, test } from 'vitest'
import { buildSampleMeetings, isSampleMeeting } from './sampleMeetings'
import type { SalesPerson, SalesPosting } from '@/lib/types'

const person = (id: string, name: string) => ({ id, name }) as SalesPerson
const posting = (designation: string) => ({ designation }) as SalesPosting

test('builds two tagged samples per logged type with roster-linked attendees', () => {
  const samples = buildSampleMeetings(['e1', 'e2', 'e3'], [person('am1', 'Ava'), person('bu1', 'Ben')],
    { am1: posting('Account Manager'), bu1: posting('BU Sales Data Fabrics') }, new Date(2026, 9, 22))

  const perType = new Map<string, number>()
  for (const s of samples) perType.set(s.input.type, (perType.get(s.input.type) ?? 0) + 1)
  expect([...perType.values()]).toEqual(Array(9).fill(2))
  expect(samples.every((s) => isSampleMeeting(s.input))).toBe(true)
  expect(samples[0].input.attendees).toEqual([{ salesPersonId: 'am1', name: 'Ava' }, { salesPersonId: 'bu1', name: 'Ben' }])
  expect(samples[0].input.date).toBe('2026-10-19')
})

test('returns nothing without an employee to attach to', () => {
  expect(buildSampleMeetings([], [], {})).toEqual([])
})
