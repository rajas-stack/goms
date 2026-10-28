import { describe, expect, it } from 'vitest'
import type { Employee } from '@/lib/types'
import type { HierNode } from '@goms/domain'
import { addedByEvent, autoMatchDepartments, deptKey, isConnected, matchParticipants, parseParticipants } from './eventParticipants'

const person = (name: string, connected: boolean) => ({ id: name, name, connected } as Employee)

describe('event participants', () => {
  it('reads columns by header in any order and drops nameless rows', () => {
    expect(parseParticipants([['Dept', 'Full Name', 'Designation'], ['IT', 'Asha Rao', 'Director'], ['HR', '', 'Clerk']]))
      .toEqual([{ name: 'Asha Rao', designation: 'Director', dept: 'IT', state: '' }])
  })

  it('needs a Name column', () => {
    expect(() => parseParticipants([['Designation'], ['Director']])).toThrow(/Name/)
  })

  it('matches names ignoring case and spacing, preferring the connected record', () => {
    const [a, b] = matchParticipants(
      [{ name: ' asha  RAO', designation: '', dept: '', state: '' }, { name: 'New Person', designation: '', dept: '', state: '' }],
      [person('Asha Rao', false), person('Asha Rao', true)],
    )
    expect(isConnected(a)).toBe(true)
    expect(b).toBeNull()
  })

  it('finds the people an event added: by stored ids, else unconnected name + designation matches', () => {
    const people = [
      { id: '1', name: 'Asha Rao', designation: 'Director', connected: false },
      { id: '2', name: 'Asha Rao', designation: 'Director', connected: true },
      { id: '3', name: 'Ravi K', designation: '—', connected: false },
      { id: '4', name: 'Ravi K', designation: 'Clerk', connected: false },
    ] as Employee[]
    const participants = [{ name: 'asha rao', designation: 'Director', dept: '', state: '' }, { name: 'Ravi K', designation: '', dept: '', state: '' }]
    const event = { id: 'e', name: 'E', date: '', participants }
    expect(addedByEvent(event, people).map((p) => p.id)).toEqual(['1', '3'])
    expect(addedByEvent({ ...event, addedIds: ['4'] }, people).map((p) => p.id)).toEqual(['4'])
  })

  it('matches departments by name, using State only to break ties', () => {
    const dept = (id: string, name: string, stateCode: number) => ({ id, name, stateCode } as HierNode)
    const departments = [dept('h-gj', 'Health', 24), dept('h-mh', 'Health', 27), dept('it-gj', 'IT Dept', 24)]
    const states = new Map([[24, 'Gujarat'], [27, 'Maharashtra']])
    const p = (dept: string, state: string) => ({ name: 'x', designation: '', dept, state })
    const rows = [p('it dept', ''), p('Health', 'maharashtra'), p('Health', ''), p('Unknown', '')]
    const m = autoMatchDepartments(rows, departments, states)
    expect(rows.map((r) => m.get(deptKey(r)))).toEqual(['it-gj', 'h-mh', '', ''])
  })
})
