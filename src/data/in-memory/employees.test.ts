import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

// 2026-08-26 backend hardening pass. `deleteEmployee` used to look up the
// removed employee (for its manager-fallback) AFTER already filtering it out
// of `this.data.employees` — so the lookup always returned undefined, and
// every direct report's managerId was unconditionally set to null instead of
// falling back to the removed person's own manager, contradicting the
// function's own "orphaned reports fall back to the removed person's
// manager" comment. Mirrors apps/api/src/routers/employees.ts's `delete`,
// which reads manager_id before deleting for exactly this reason.
describe('InMemoryRepository.deleteEmployee', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('reassigns direct reports to the removed manager\'s own manager, not null', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const grandparent = await repository.createEmployee({
      name: 'GP', designation: 'VP', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const middleManager = await repository.createEmployee({
      name: 'Middle Manager', designation: 'Manager', email: '', phone: '', orgNodeId: dept.id, managerId: grandparent.id,
    })
    const report = await repository.createEmployee({
      name: 'Report', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: middleManager.id,
    })

    await repository.deleteEmployee(middleManager.id)

    const updatedReport = await repository.getEmployee(report.id)
    expect(updatedReport?.managerId).toBe(grandparent.id)
  })

  it('clears a dangling deptHead pointer on a hierarchy node when the department head is deleted', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept With Head' })
    const head = await repository.createEmployee({
      name: 'Head', designation: 'Head', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    await repository.updateNode(dept.id, { metadata: { deptHead: head.id } })
    expect((await repository.getNode(dept.id))?.metadata?.deptHead).toBe(head.id)

    await repository.deleteEmployee(head.id)

    expect((await repository.getNode(dept.id))?.metadata?.deptHead).toBeUndefined()
  })
})

// Item 13: Agenda/Outcome/Next Steps are new optional TimelineEvent fields
// that must round-trip through the in-memory repository the same way the
// Postgres router does (apps/api/src/routers/employees.test.ts covers that
// side), and must remain fully optional for every existing call site.
describe('InMemoryRepository.addTimelineEvent', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('round-trips agenda/outcome/nextSteps when provided', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const emp = await repository.createEmployee({
      name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const evt = await repository.addTimelineEvent({
      employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
      agenda: 'Discuss Q1 budget', outcome: 'Approved with revisions', nextSteps: 'Send revised sheet by Friday',
    })
    expect(evt.agenda).toBe('Discuss Q1 budget')
    expect(evt.outcome).toBe('Approved with revisions')
    expect(evt.nextSteps).toBe('Send revised sheet by Friday')

    const timeline = await repository.listTimeline(emp.id)
    const fetched = timeline.find((t) => t.id === evt.id)
    expect(fetched?.agenda).toBe('Discuss Q1 budget')
    expect(fetched?.outcome).toBe('Approved with revisions')
    expect(fetched?.nextSteps).toBe('Send revised sheet by Friday')
  })

  it('still works when agenda/outcome/nextSteps are omitted', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const emp = await repository.createEmployee({
      name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const evt = await repository.addTimelineEvent({
      employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
    })
    expect(evt.agenda).toBeUndefined()
    expect(evt.outcome).toBeUndefined()
    expect(evt.nextSteps).toBeUndefined()
  })
})

// Task 8.4 (Item 14): editing must mutate the same in-memory record — same
// id, no new entry pushed onto `data.timeline` — and support a mixed
// legacy/new attendees array unchanged when the patch doesn't touch it.
describe('InMemoryRepository.updateTimelineEvent', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('updates fields in place on the same record', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const emp = await repository.createEmployee({
      name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const evt = await repository.addTimelineEvent({
      employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
    })
    const before = (await repository.listTimeline(emp.id)).length

    const updated = await repository.updateTimelineEvent(evt.id, {
      title: 'Rescheduled call', date: '2026-01-03', agenda: 'Discuss renewal',
    })

    expect(updated.id).toBe(evt.id)
    expect(updated.title).toBe('Rescheduled call')
    expect(updated.date).toBe('2026-01-03')
    expect(updated.agenda).toBe('Discuss renewal')
    expect(await repository.listTimeline(emp.id)).toHaveLength(before)
  })

  it('leaves a mixed legacy/new attendees array unchanged when the patch omits attendees', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const emp = await repository.createEmployee({
      name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const evt = await repository.addTimelineEvent({
      employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
      attendees: ['Legacy Person', { salesPersonId: 'sp-1', name: 'New Snapshot Name' }],
    })

    const updated = await repository.updateTimelineEvent(evt.id, { note: 'Went well' })

    expect(updated.note).toBe('Went well')
    expect(updated.attendees).toEqual(['Legacy Person', { salesPersonId: 'sp-1', name: 'New Snapshot Name' }])
  })
})
