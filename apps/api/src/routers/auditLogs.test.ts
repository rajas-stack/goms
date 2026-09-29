import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('auditLogs router (top-level)', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM commercial_audit_logs')
  })

  it('lists log entries for any entity type, including bid-related ones, via the same shared store commercial.auditLogs already reads', async () => {
    await pool.query(
      `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, action) VALUES ('bid', '00000000-0000-0000-0000-000000000001', 'stageKey', 'a', 'b', 'update')`,
    )
    const caller = appRouter.createCaller({})
    const viaTopLevel = await caller.auditLogs.list({ entityType: 'bid' })
    expect(viaTopLevel).toHaveLength(1)
    // Same underlying store — commercial.auditLogs.list still works unchanged (spec §16's regression requirement).
    const viaCommercial = await caller.commercial.auditLogs.list({ entityType: 'bid' })
    expect(viaCommercial).toEqual(viaTopLevel)
  })
})
