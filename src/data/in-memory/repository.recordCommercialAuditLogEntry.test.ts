import { describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from '@/modules/commercial-calculator/seed-defaults'
import { listAuditLogsLogic, writeAuditLogEntry } from '@/modules/commercial-calculator/repository-logic'

// `recordCommercialAuditLogEntry` (the Repository interface bridge method,
// see in-memory/repository.ts) is a one-line delegation to writeAuditLogEntry
// — tested here directly against the pure logic function/fixture data,
// matching this file's sibling repository-logic.test.ts convention, rather
// than through the persistence-wrapped `repository` singleton (which pulls
// in DOM APIs unavailable in this suite's Node test environment).
describe('writeAuditLogEntry (backs recordCommercialAuditLogEntry)', () => {
  it('appends an entry visible through listAuditLogsLogic', () => {
    const data = buildDefaultCommercialCalculatorData()
    writeAuditLogEntry(data, {
      entityType: 'feature', entityId: 'test-feature-1', field: 'status',
      oldValue: 'new', newValue: 'existing', reason: 'test reason', action: 'status_change', changedBy: null,
    })
    const logs = listAuditLogsLogic(data, { entityType: 'feature', entityId: 'test-feature-1' })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      entityType: 'feature', entityId: 'test-feature-1', field: 'status',
      oldValue: 'new', newValue: 'existing', reason: 'test reason', action: 'status_change',
    })
    expect(logs[0].id).toBeTruthy()
    expect(logs[0].changedAt).toBeTruthy()
  })
})
