import { describe, expect, it } from 'vitest'
import type { Permissions } from '@/lib/permissions'
import { accessFor, allows, type Role, type UserFacts } from '@goms/domain'
import { COLUMN_ATOM, canEditCell, rowScopeFacts } from './gridPermissions'
import { STANDARD_COLUMNS } from './gridColumns'

const perms = (roles: Role[], salesPersonId: string | null = null, ids = { presales: [] as string[], legal: [] as string[], bid: [] as string[] }): Permissions => {
  const user: UserFacts = { email: 'me@amnex.com', roles, salesPersonId, teamMemberIds: ids }
  return {
    enforced: true, roles, level: (m) => accessFor(user, m).level, can: () => true, canReadAtom: () => true, mayWrite: () => true,
    canEdit: (m, atom, row) => allows(accessFor(user, m, row), atom),
  }
}
const row = (extra: Record<string, unknown> = {}) => ({ sheet: 'bidTracker', ownerEmail: null, solutionLeadEmail: null, geoSalesPersonId: null, buSalesPersonId: null, preSalesPersonId: null, legalPersonId: null, bidTeamMemberId: null, ...extra }) as any
const me = { email: 'me@amnex.com', salesPersonId: 'sp1' }

describe('column → atom map', () => {
  it('covers every standard column that has a write path, and none that does not', () => {
    for (const c of STANDARD_COLUMNS) {
      if (c.editable) expect(COLUMN_ATOM[c.id], c.id).toBeTruthy()
    }
  })
})

describe('canEditCell', () => {
  it('is always true when RBAC is not enforced', () => {
    expect(canEditCell({ enforced: false } as Permissions, row(), 'stageKey', me)).toBe(true)
  })
  it('Sales (S1) edits client/value-type cells on an own Bid Tracker row, not stage or decision', () => {
    const p = perms(['sales'], 'sp1')
    const own = row({ geoSalesPersonId: 'sp1' })
    expect(canEditCell(p, own, 'city', me)).toBe(true)
    expect(canEditCell(p, own, 'stageKey', me)).toBe(false)
    expect(canEditCell(p, own, 'decision', me)).toBe(false)
    expect(canEditCell(p, row({ geoSalesPersonId: 'sp9' }), 'city', me)).toBe(false)
  })
  it('Solution Lead is read-only for every ordinary role, even a W role — only System Admin edits it', () => {
    for (const role of ['bid', 'cxo', 'it', 'sales', 'presales', 'legal', 'finance', 'delivery'] as const) {
      expect(canEditCell(perms([role]), row(), 'solutionLeadEmail', me), role).toBe(false)
    }
    expect(canEditCell(perms(['system_admin']), row(), 'solutionLeadEmail', me)).toBe(true)
  })
  it('System Admin edits every cell, on any sheet and any row', () => {
    const p = perms(['system_admin'])
    for (const col of ['stageKey', 'decision', 'gemTenderId', 'opportunityName', 'custom:region', 'ownerEmail', 'solutionLeadEmail', 'dataConfidence']) {
      expect(canEditCell(p, row(), col, me), col).toBe(true)
    }
    expect(canEditCell(p, row({ sheet: 'campaign', geoSalesPersonId: 'sp9' }), 'stageKey', me)).toBe(true)
  })
  it('CXO may edit only the decision cell', () => {
    const p = perms(['cxo'])
    expect(canEditCell(p, row(), 'decision', me)).toBe(true)
    expect(canEditCell(p, row(), 'stageKey', me)).toBe(false)
  })
  it('a custom column needs bid.custom on the row', () => {
    expect(canEditCell(perms(['legal'], null, { presales: [], legal: ['l1'], bid: [] }), row({ legalPersonId: 'l1' }), 'custom:region', me)).toBe(true)
    expect(canEditCell(perms(['legal']), row({ legalPersonId: 'l1' }), 'custom:region', me)).toBe(false)
  })
  it('judges a Pipeline row on the Pipeline module', () => {
    const p = perms(['sales'], 'sp1')
    expect(canEditCell(p, row({ sheet: 'pipeline-funnel', geoSalesPersonId: 'sp1' }), 'stageKey', me)).toBe(true) // W·own on Pipeline
  })
  it('builds scope facts from the row, lower-casing the owner match', () => {
    expect(rowScopeFacts(row({ ownerEmail: 'ME@amnex.com', geoSalesPersonId: 'sp2' }), 'me@amnex.com', 'sp1').salesOwnerIds).toEqual(expect.arrayContaining(['sp1', 'sp2']))
  })
})
