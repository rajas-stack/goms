import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../db.js'
import { recordImportRun, listImportHistory } from './auditLog.js'

describe('auditLog', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM admin_import_runs')
  })

  it('records a run and lists it back, most recent first', async () => {
    await recordImportRun(pool, 'taxClasses', { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 }, [])
    const history = await listImportHistory('taxClasses')
    expect(history).toHaveLength(1)
    expect(history[0].summary.toCreate).toBe(1)
  })

  it('does not return another domain\'s history', async () => {
    await recordImportRun(pool, 'currencies', { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 }, [])
    expect(await listImportHistory('taxClasses')).toHaveLength(0)
  })

  it('orders multiple runs for the same domain most-recent-first', async () => {
    await recordImportRun(pool, 'taxClasses', { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 }, [])
    await recordImportRun(pool, 'taxClasses', { toCreate: 2, toUpdate: 0, unchanged: 0, rejected: 0, total: 2 }, [])
    const history = await listImportHistory('taxClasses')
    expect(history).toHaveLength(2)
    expect(history[0].summary.toCreate).toBe(2)
    expect(history[1].summary.toCreate).toBe(1)
  })

  it('stores only rejected rows and reports their count, not the full preview', async () => {
    await recordImportRun(
      pool,
      'taxClasses',
      { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 1, total: 2 },
      [
        { rowNumber: 1, businessKey: 'A', action: 'create', errors: [] },
        { rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['bad'] },
      ],
    )
    const history = await listImportHistory('taxClasses')
    expect(history[0].rejectedRowCount).toBe(1)
  })
})
