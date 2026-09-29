import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../db.js'
import { writeAuditLog, listAuditLogs } from './auditLog.js'

describe('shared audit log', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
  })

  it('writes and lists a log entry, filterable by entityType/entityId', async () => {
    const client = await pool.connect()
    try {
      await writeAuditLog(client, {
        entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000001',
        field: 'stageKey', oldValue: 'solutioning', newValue: 'qualification',
        reason: '', action: 'update', changedBy: 'test@amnex.com',
      })
    } finally {
      client.release()
    }
    const all = await listAuditLogs()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ entityType: 'bid', field: 'stageKey', changedBy: 'test@amnex.com' })

    const scoped = await listAuditLogs({ entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000001' })
    expect(scoped).toHaveLength(1)
    const scopedMiss = await listAuditLogs({ entityType: 'bid', entityId: '00000000-0000-0000-0000-000000000002' })
    expect(scopedMiss).toHaveLength(0)
  })
})
