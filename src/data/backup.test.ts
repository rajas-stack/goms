import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from './migrations'
import { BACKUP_KIND, buildBackupEnvelope, parseBackupFile } from './backup'
import type { GormsData } from './seed'

function minimalGormsData(): GormsData {
  return {
    nodes: [], employees: [], externalIds: [], timeline: [], transfers: [], opportunities: [],
    opportunityStageChanges: [], followUps: [], salesPersons: [], salesPostings: [],
    ownershipAssignments: [], mergeAudit: [],
    commercialCalculator: {} as GormsData['commercialCalculator'],
  }
}

describe('buildBackupEnvelope', () => {
  it('stamps the current schema version and kind', () => {
    const envelope = buildBackupEnvelope(minimalGormsData())
    expect(envelope.kind).toBe(BACKUP_KIND)
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION)
    expect(typeof envelope.exportedAt).toBe('string')
  })
})

describe('parseBackupFile', () => {
  it('round-trips a backup built by buildBackupEnvelope', () => {
    const data = minimalGormsData()
    const json = JSON.stringify(buildBackupEnvelope(data))
    const result = parseBackupFile(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.nodes).toEqual([])
  })

  it('rejects invalid JSON', () => {
    const result = parseBackupFile('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/)
  })

  it('rejects a file that is not a GOMS backup', () => {
    const result = parseBackupFile(JSON.stringify({ hello: 'world' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not a GOMS backup/)
  })

  it('rejects a backup from a newer schema version than this build supports', () => {
    const json = JSON.stringify({ kind: BACKUP_KIND, schemaVersion: SCHEMA_VERSION + 1, exportedAt: '', data: {} })
    const result = parseBackupFile(json)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/corrupt or from a newer version/)
  })
})
