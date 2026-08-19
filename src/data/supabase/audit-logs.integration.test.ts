import { describe, expect, it } from 'vitest'
import { listAuditLogs, recordAuditLogEntry } from './audit-logs'

describe('audit logs (Supabase integration)', () => {
  it('recordAuditLogEntry + listAuditLogs round-trips, filtered by entityType/entityId', async () => {
    const entityId = `test-entity-${Date.now()}`
    await recordAuditLogEntry({
      entityType: 'testEntity', entityId, field: 'status', oldValue: 'draft', newValue: 'active',
      reason: 'integration test', action: 'status_change', changedBy: null,
    })
    const rows = await listAuditLogs({ entityType: 'testEntity', entityId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entityType: 'testEntity', entityId, field: 'status',
      oldValue: 'draft', newValue: 'active', reason: 'integration test', action: 'status_change',
    })
    expect(rows[0].id).toBeTruthy()
    expect(rows[0].changedAt).toBeTruthy()
  })

  it('newest entries sort first', async () => {
    const entityId = `test-order-${Date.now()}`
    await recordAuditLogEntry({
      entityType: 'testEntity', entityId, field: 'a', oldValue: '', newValue: '1', reason: '', action: 'create', changedBy: null,
    })
    await recordAuditLogEntry({
      entityType: 'testEntity', entityId, field: 'a', oldValue: '1', newValue: '2', reason: '', action: 'update', changedBy: null,
    })
    const rows = await listAuditLogs({ entityType: 'testEntity', entityId })
    expect(rows).toHaveLength(2)
    expect(rows[0].newValue).toBe('2')
    expect(rows[1].newValue).toBe('1')
  })

  it('entries written by multiple distinct entity types are all queryable through the same shared table', async () => {
    const suffix = Date.now()
    await recordAuditLogEntry({
      entityType: 'boq', entityId: `boq-${suffix}`, field: 'status', oldValue: 'draft', newValue: 'submitted',
      reason: '', action: 'status_change', changedBy: null,
    })
    await recordAuditLogEntry({
      entityType: 'employee', entityId: `emp-${suffix}`, field: 'designation', oldValue: 'Officer', newValue: 'Senior Officer',
      reason: '', action: 'update', changedBy: null,
    })
    const boqRows = await listAuditLogs({ entityType: 'boq', entityId: `boq-${suffix}` })
    const empRows = await listAuditLogs({ entityType: 'employee', entityId: `emp-${suffix}` })
    expect(boqRows).toHaveLength(1)
    expect(empRows).toHaveLength(1)
  })
})
