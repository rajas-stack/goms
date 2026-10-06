import {
  BID_PATCH_ATOMS, IGNORED_PATCH_KEYS, OPPORTUNITY_PATCH_ATOMS, isOwnedSheet, type ScopeFacts,
} from '@goms/domain'
import { pendingUploads } from '../../../lib/pendingUploads.js'
import { DenyCall } from '../denial.js'
import {
  assignmentInfo, corrigendumChangeInfo, milestoneInfo, rowForBid, rowForCitation, rowForDocument, rowForFollowUp,
  rowForOwnedEntity, rowForSalesPerson, savedViewScope, sheetModule,
} from '../rows.js'
import { bidRow, oppRow, patchAtoms } from './builders.js'
import { ROW_MODULES, create, read, readRows, remove, write } from './helpers.js'
import type { Check, PolicyEntry, Requirement } from './types.js'

const same = (paths: string[], ...requirements: Requirement[]): Record<string, PolicyEntry> =>
  Object.fromEntries(paths.map((p) => [p, { requirements }]))

const bidPatch = (raw: any) => patchAtoms(raw?.patch, (k) => BID_PATCH_ATOMS[k] ?? null)
const oppPatch = (raw: any) =>
  patchAtoms(raw?.patch, (k) => (IGNORED_PATCH_KEYS.has(k) ? undefined : OPPORTUNITY_PATCH_ATOMS[k] ?? null))

// ---- bids ---------------------------------------------------------------------------------------------------

const sheetCreate: Requirement = (raw) => ({ module: sheetModule(raw?.sheet), action: 'create' })
const departmentCreate: Requirement = (raw) =>
  raw?.department?.mode === 'create' ? { module: 'am.departments', action: 'create' } : null

/** A sheet move also needs the move right on the DESTINATION sheet (the source side is checked by the patch atoms). */
const sheetMove: Requirement = async (raw) => {
  const dest = raw?.patch?.sheet
  if (!isOwnedSheet(dest)) return null
  const row = await rowForBid(raw?.id)
  return { module: sheetModule(dest), action: 'update', atoms: ['bid.move'], row: row?.facts }
}

const bidNextAction = async (bidId: unknown): Promise<Check> => {
  const row = await rowForBid(bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['bid.nextAction'], row: row?.facts }
}

const opportunityDatesOf = async (bidId: unknown): Promise<Check> => {
  const row = await rowForBid(bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['opp.dates'], row: row?.facts }
}

// ---- milestones: the Submission Deadline milestone also writes opportunities.submission_date -------------------

const submissionDateOnCreate: Requirement = (raw) => (raw?.key === 'submissionDeadline' ? opportunityDatesOf(raw?.bidId) : null)
const submissionDateSync = (applies: (raw: any) => boolean): Requirement => async (raw) => {
  const milestone = await milestoneInfo(raw?.id)
  return milestone?.key === 'submissionDeadline' && applies(raw) ? opportunityDatesOf(milestone.bidId) : null
}

// ---- corrigenda: an accepted change rewrites the tender link or a milestone (and maybe the opportunity date) -----

const acceptedChange = async (raw: any) => (raw?.decision === 'accepted' ? corrigendumChangeInfo(raw?.changeId) : null)
const corrigendumTenderLink: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  if (change?.fieldKey !== 'tenderLink') return null
  const row = await rowForBid(change.bidId)
  return { module: row?.module ?? 'opp.bidTracker', action: 'update', atoms: ['opp.identity'], row: row?.facts }
}
const corrigendumMilestone: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  return change && change.fieldKey !== 'tenderLink' ? { module: 'bid.milestones', action: 'update' } : null
}
const corrigendumSubmissionDate: Requirement = async (raw) => {
  const change = await acceptedChange(raw)
  return change?.fieldKey === 'submissionDeadline' ? opportunityDatesOf(change.bidId) : null
}

// ---- saved views (gap A3) ------------------------------------------------------------------------------------

const viewIsGlobal = async (raw: any): Promise<boolean> =>
  raw?.scope === 'global' || raw?.patch?.scope === 'global' || (await savedViewScope(raw?.id)) === 'global'
const savedViewWrite: Requirement = async (raw) =>
  (await viewIsGlobal(raw)) ? { module: 'bid.columns', action: 'update' } : { module: 'opp.bidTracker', action: 'read', anyOf: ROW_MODULES }

// ---- documents & protected values attach to bids only ------------------------------------------------------------

const BID_ONLY = 'Documents can only be attached to bids.'
const documentRead = (raw: any): Check => {
  if (raw?.entityType !== 'bid') throw new DenyCall(BID_ONLY)
  return { module: 'bid.documents', action: 'read' }
}
const documentCreate = async (entityType: unknown, entityId: unknown): Promise<Check> => {
  if (entityType !== 'bid') throw new DenyCall(BID_ONLY)
  const row = await rowForBid(entityId)
  return { module: 'bid.documents', action: 'create', row: row?.facts }
}
const confirmUpload: Requirement = async (raw) => {
  const pending = pendingUploads.get(raw?.uploadId)
  if (!pending) throw new DenyCall('That upload was not found or has expired.')
  return documentCreate(pending.entityType, pending.entityId)
}
const citationWrite = (by: 'document' | 'citation'): Requirement => async (raw) => {
  const row: ScopeFacts | null = by === 'document' ? await rowForDocument(raw?.documentId) : await rowForCitation(raw?.id)
  return { module: 'bid.documents', action: 'update', atoms: ['doc.upload'], row: row ?? undefined }
}
const protectedValueRead = (raw: any): Check => {
  if (raw?.entityType !== 'bid') throw new DenyCall('Protected values apply to bids only.')
  return { module: 'bid.protected', action: 'read' }
}
const protectedValueWrite = (action: 'create' | 'delete'): Requirement => (raw) => {
  if (raw?.entityType !== 'bid') throw new DenyCall('Protected values apply to bids only.')
  return { module: 'bid.protected', action }
}

// ---- follow-ups: bid-typed ones are the bid's "next action" field; the rest belong to Account Mapping --------------

const followUpWrite = (action: 'update' | 'delete'): Requirement => async (raw) => {
  const followUp = await rowForFollowUp(raw?.id)
  if (followUp?.entityType === 'bid') return bidNextAction(followUp.entityId)
  return { module: 'am.followUps', action, row: followUp?.facts }
}

// ---- ownership: Solution Lead is frozen (read-only for every role in v1) ---------------------------------------------

/** Atoms for an ownership write. `ownership.solutionLead` is held by nobody, so it can never pass. */
export function ownershipAtoms(entityType: unknown, role: unknown): string[] {
  const r = role ?? 'owner'
  if (r === 'solutionLead') return ['ownership.solutionLead']
  if (r === 'owner' && entityType === 'bid') return ['ownership.bidEntity']
  return ['ownership.assign']
}
const ownershipWrite = (kind: 'assign' | 'end'): Requirement => async (raw) => {
  const info = kind === 'assign' ? { entityType: raw?.entityType, entityId: raw?.entityId, role: raw?.role } : await assignmentInfo(raw?.id)
  if (!info) return { module: 'am.ownership', action: 'update', atoms: ['ownership.assign'] }
  const row = await rowForOwnedEntity(info.entityType, info.entityId)
  return { module: 'am.ownership', action: 'update', atoms: ownershipAtoms(info.entityType, info.role), row: row ?? undefined }
}
const bookOfBusinessTransfer: Requirement = async (raw) => ({
  module: 'am.ownership', action: 'update', atoms: ['ownership.assign'], row: (await rowForSalesPerson(raw?.fromSalesPersonId)) ?? undefined,
})

export const opportunityPolicy: Record<string, PolicyEntry> = {
  // reads: any role that can read at least one of the three sheet modules
  ...same([
    'bids.listForGrid', 'bids.get', 'bids.getForOpportunity', 'bids.actionQueue.list',
    'opportunities.list', 'opportunities.listByDepartment', 'opportunities.get', 'opportunities.listStageChanges',
    'bidCustomFields.valuesForBid', 'bidSavedViews.list', 'bidSavedViews.get',
  ], readRows),

  'bids.create': { requirements: [sheetCreate, departmentCreate] },
  'bids.update': { requirements: [bidRow('update', (r) => r?.id, bidPatch), sheetMove] },
  ...same(['bids.archive', 'bids.unarchive'], bidRow('update', (r) => r?.id, () => ['bid.archive'])),
  'bids.markVerified': { requirements: [bidRow('update', (r) => r?.id, () => ['bid.verify'])] },
  'bids.delete': { requirements: [bidRow('delete', (r) => r?.id)] },

  'opportunities.create': { requirements: [create('opp.bidTracker')] },
  'opportunities.update': { requirements: [oppRow('update', (r) => r?.id, oppPatch)] },
  'opportunities.delete': { requirements: [oppRow('delete', (r) => r?.id)] },

  ...same(['bidMilestones.listForBid', 'bidMilestones.listAll'], read('bid.milestones')),
  'bidMilestones.create': { requirements: [create('bid.milestones'), submissionDateOnCreate] },
  'bidMilestones.update': { requirements: [write('bid.milestones'), submissionDateSync((r) => r?.patch?.dueAt !== undefined)] },
  'bidMilestones.delete': { requirements: [remove('bid.milestones'), submissionDateSync(() => true)] },

  'bidCorrigenda.listForBid': { requirements: [read('bid.corrigenda')] },
  'bidCorrigenda.create': { requirements: [create('bid.corrigenda')] },
  'bidCorrigenda.reviewChange': {
    requirements: [write('bid.corrigenda', ['corrigendum.review']), corrigendumTenderLink, corrigendumMilestone, corrigendumSubmissionDate],
  },

  'bidCustomFields.list': { requirements: [read('bid.columns')] },
  'bidCustomFields.create': { requirements: [create('bid.columns')] },
  ...same(['bidCustomFields.update', 'bidCustomFields.reorder', 'bidCustomFields.archive', 'bidCustomFields.unarchive'], write('bid.columns')),
  'bidCustomFields.delete': { requirements: [remove('bid.columns')] },
  'bidCustomFields.setValue': { requirements: [bidRow('update', (r) => r?.bidId, () => ['bid.custom'])] },

  ...same(['bidSavedViews.create', 'bidSavedViews.update', 'bidSavedViews.delete'], savedViewWrite),

  'documents.listFor': { requirements: [documentRead] },
  'documents.getDownloadUrl': { requirements: [read('bid.documents')] },
  'documents.requestUploadUrl': { requirements: [(raw) => documentCreate(raw?.entityType, raw?.entityId)] },
  'documents.confirmUpload': { requirements: [confirmUpload] },
  'documents.delete': { requirements: [remove('bid.documents')] },
  'documents.citations.list': { requirements: [read('bid.documents')] },
  'documents.citations.create': { requirements: [citationWrite('document')] },
  'documents.citations.delete': { requirements: [citationWrite('citation')] },

  'protectedValues.listFor': { requirements: [protectedValueRead] },
  'protectedValues.freeze': { requirements: [protectedValueWrite('create')] },
  'protectedValues.unfreeze': { requirements: [protectedValueWrite('delete')] },

  'followUps.listForEntity': {
    requirements: [(raw) => (raw?.entityType === 'bid'
      ? { module: 'opp.bidTracker', action: 'read', anyOf: ROW_MODULES }
      : { module: 'am.followUps', action: 'read' })],
  },
  'followUps.listOpen': { requirements: [read('am.followUps')] },
  'followUps.create': {
    requirements: [(raw) => (raw?.entityType === 'bid' ? bidNextAction(raw?.entityId) : { module: 'am.followUps', action: 'create' })],
  },
  'followUps.setStatus': { requirements: [followUpWrite('update')] },
  'followUps.delete': { requirements: [followUpWrite('delete')] },

  // ownership: the assignment history screens need the module; owner badges on rows only need to see the owner (gap A4)
  ...same(['ownership.listAssignments', 'ownership.listFor', 'ownership.listOwnedBy'], read('am.ownership')),
  ...same(['ownership.resolveOwner', 'ownership.resolveOwners'], (() => ({
    module: 'am.ownership', action: 'read', anyOf: ['am.ownership', ...ROW_MODULES, 'am.contacts', 'am.departments'],
  })) as Requirement),
  'ownership.assign': { requirements: [ownershipWrite('assign')] },
  'ownership.end': { requirements: [ownershipWrite('end')] },
  'ownership.transferBookOfBusiness': { requirements: [bookOfBusinessTransfer] },
}
