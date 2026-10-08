import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }))
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { orgPeopleRouter } from './orgPeople.js'

const row = (id: string, name: string, level: number, managerId: string | null = null) => ({
  id, name, level, manager_id: managerId, designation: '', departments: ['Leadership'], email: '', status: 'active', created_at: new Date('2026-10-05'),
})
const people = [row('root', 'Chairman', 0), row('boss', 'Director', 1, 'root'), row('report', 'Employee', 3, 'boss')]
const caller = () => orgPeopleRouter.createCaller({ user: { uid: 'editor', email: 'editor@amnex.com' } })

describe('company employee levels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.connect.mockResolvedValue(client)
    db.query.mockResolvedValue({ rows: people })
    client.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.startsWith('SELECT * FROM org_people')) return { rows: people }
      if (sql.startsWith('INSERT INTO org_people')) return { rows: [{ ...row('new', params![0], params![1], params![4]), designation: params![2], departments: params![3], email: params![5] }] }
      if (sql.startsWith('UPDATE org_people SET name=')) return { rows: [{ ...row(params![7], params![0], params![1], params![4]), status: params![6] }] }
      return { rows: [] }
    })
  })

  it('lists real company levels and validates their supported range', async () => {
    expect((await caller().list()).map(person => person.level)).toEqual([0, 1, 3])
    await expect(caller().create({ name: 'Bad level', level: 8 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.connect).not.toHaveBeenCalled()
  })

  it('allows a new employee to report only to a higher level', async () => {
    expect(await caller().create({ name: 'New senior', level: 2, managerId: 'boss' })).toMatchObject({ level: 2, managerId: 'boss' })
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    await expect(caller().create({ name: 'Invalid peer', level: 1, managerId: 'boss' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rejects a level change that leaves direct reports at their manager level', async () => {
    await expect(caller().update({ id: 'boss', patch: { level: 3 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(client.query.mock.calls.some(call => String(call[0]).startsWith('UPDATE org_people SET name='))).toBe(false)
  })

  it('clears DSC references and preserves reporting continuity when removing an employee', async () => {
    await caller().delete({ id: 'boss' })
    expect(client.query).toHaveBeenCalledWith('UPDATE org_people SET manager_id=$1 WHERE manager_id=$2', ['root', 'boss'])
    expect(client.query).toHaveBeenCalledWith('UPDATE tender_websites SET dsc_employee_id=NULL WHERE dsc_employee_id=$1', ['boss'])
    expect(client.query).toHaveBeenCalledWith('DELETE FROM org_people WHERE id=$1', ['boss'])
    expect(client.release).toHaveBeenCalled()
  })
})
