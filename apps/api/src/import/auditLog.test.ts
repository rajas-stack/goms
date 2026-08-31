import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../db.js'
import { recordImportRun, listImportHistory, listSessionHistory } from './auditLog.js'

describe('auditLog', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM admin_import_runs')
  })

  it('records a run and lists it back, most recent first', async () => {
    await recordImportRun(pool, '11111111-1111-1111-1111-111111111111', 'taxClasses', { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 }, [], [])
    const history = await listImportHistory('taxClasses')
    expect(history).toHaveLength(1)
    expect(history[0].summary.toCreate).toBe(1)
  })

  it('does not return another domain\'s history', async () => {
    await recordImportRun(pool, '11111111-1111-1111-1111-111111111111', 'currencies', { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 }, [], [])
    expect(await listImportHistory('taxClasses')).toHaveLength(0)
  })

  it('orders multiple runs for the same domain most-recent-first', async () => {
    await recordImportRun(pool, '11111111-1111-1111-1111-111111111111', 'taxClasses', { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 }, [], [])
    await recordImportRun(pool, '22222222-2222-2222-2222-222222222222', 'taxClasses', { toCreate: 2, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 2 }, [], [])
    const history = await listImportHistory('taxClasses')
    expect(history).toHaveLength(2)
    expect(history[0].summary.toCreate).toBe(2)
    expect(history[1].summary.toCreate).toBe(1)
  })

  it('stores only rejected rows and reports their count, not the full preview', async () => {
    await recordImportRun(
      pool,
      '11111111-1111-1111-1111-111111111111',
      'taxClasses',
      { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 1, total: 2 },
      [
        { rowNumber: 1, businessKey: 'A', action: 'create', errors: [] },
        { rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['bad'] },
      ],
      [],
    )
    const history = await listImportHistory('taxClasses')
    expect(history[0].rejectedRowCount).toBe(1)
  })

  it('records session_id and excluded rows, and lists a whole session by id', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const summary = { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 }
    const excluded = [{ domain: 'employees' as const, rowNumber: 3, businessKey: 'E999', reason: 'admin chose to skip — bad legacy data' }]

    await recordImportRun(pool, sessionId, 'employees', summary, [], excluded)
    await recordImportRun(pool, sessionId, 'organizationHierarchy', summary, [], [])

    const rows = await listSessionHistory(sessionId)
    expect(rows.map((r) => r.domain).sort()).toEqual(['employees', 'organizationHierarchy'])
    const employeesRow = rows.find((r) => r.domain === 'employees')!
    expect(employeesRow.excludedRows).toEqual(excluded)
  })
})
