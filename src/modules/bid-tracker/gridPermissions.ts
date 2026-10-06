import { sheetModule } from '@goms/domain'
import type { Permissions } from '@/lib/permissions'
import type { ScopeFacts } from '@goms/domain'
import type { BidGridRow } from '@/lib/types'

export const COLUMN_ATOM: Record<string, string | null> = {
  opportunityName: 'opp.identity', opportunityType: 'opp.identity', tenderLink: 'opp.identity', gemTenderId: 'opp.tenderId',
  departmentName: 'opp.client', city: 'opp.client', vertical: 'opp.client',
  geoSalesPersonId: 'opp.teamSales', buSalesPersonId: 'opp.teamSales',
  preSalesPersonId: 'opp.teamDelivery', legalPersonId: 'opp.teamDelivery', bidTeamMemberId: 'opp.teamDelivery',
  ownerEmail: 'ownership.bidEntity', solutionLeadEmail: 'ownership.solutionLead',
  stageKey: 'bid.stage', decision: 'bid.decision',
  nextActionNote: 'bid.nextAction', nextActionAssigneeEmail: 'bid.nextAction', nextActionDueDate: 'bid.nextAction',
  dataConfidence: 'bid.verify',
}
export const atomOf = (columnId: string): string | null => (columnId.startsWith('custom:') ? 'bid.custom' : COLUMN_ATOM[columnId] ?? null)

/** Mirrors the server's row facts from what a grid row already carries (the server stays authoritative). */
export function rowScopeFacts(row: BidGridRow, myEmail: string, mySalesPersonId: string | null): ScopeFacts {
  const email = myEmail.toLowerCase()
  const ids = new Set<string>()
  if (mySalesPersonId && (row.ownerEmail?.toLowerCase() === email || row.solutionLeadEmail?.toLowerCase() === email)) ids.add(mySalesPersonId)
  for (const id of [row.geoSalesPersonId, row.buSalesPersonId]) if (id) ids.add(id)
  return {
    salesOwnerIds: [...ids],
    createdBy: row.createdBy ?? null,
    assigned: { presales: row.preSalesPersonId ?? null, legal: row.legalPersonId ?? null, bid: row.bidTeamMemberId ?? null },
  }
}

export function canEditCell(perms: Permissions, row: BidGridRow, columnId: string, me: { email: string; salesPersonId: string | null }): boolean {
  if (!perms.enforced) return true
  const atom = atomOf(columnId)
  if (!atom) return false
  return perms.canEdit(sheetModule(row.sheet), atom, rowScopeFacts(row, me.email, me.salesPersonId))
}
