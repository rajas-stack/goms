import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateGeneralDocument, type CustomValue } from '@goms/domain'
import { repository } from '@/data/repository'
import { isoToday } from '@/lib/dates'
import { useBidMutations, useDepartments, useFollowUpMutations, useOpportunityMutations, useOwnershipMutations, useSetBidCustomValue } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'
import type { CellDraft } from './components/EditableCell'
import type { EntityLookups, GridColumnMeta } from './gridColumns'
import { useSaveSynopsis } from './synopsis/api'

const editsByBid = new Map<string, Promise<void>>()
const dayAfter = (date: string) => {
  const next = new Date(`${date}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

/** Both the grid and General save through the same typed, optimistic edit paths. */
export function useBidColumnMutation(lookups: EntityLookups) {
  const qc = useQueryClient()
  const { data: departments = [] } = useDepartments()
  const { update: updateBid, markVerified } = useBidMutations()
  const { update: updateOpportunity } = useOpportunityMutations()
  const { assign, end: endOwnership } = useOwnershipMutations()
  const { create: createFollowUp, setStatus: setFollowUpStatus } = useFollowUpMutations()
  const setCustomValue = useSetBidCustomValue()
  const saveSynopsis = useSaveSynopsis()
  const today = isoToday
  const personIdByEmail = (email: CellDraft) => {
    if (email === null || email === '') return null
    const person = lookups.persons.find((p) => p.email === email)
    if (!person) throw new Error('Choose a person from the Sales Team.')
    return person.value
  }

  /** Ends the open Sales/Solution Lead(s) and records the new one, so the history is kept. */
  const replaceSolutionLead = async (row: BidGridRow, email: CellDraft) => {
    const salesPersonId = personIdByEmail(email)
    const history = await repository.listOwnershipFor('bid', row.id)
    const open = history.filter((a) => a.role === 'solutionLead' && a.endDate === null)
    const asOf = today()
    for (const lead of open) {
      // An assignment must end after it starts; one made today closes tomorrow.
      const endDate = lead.startDate < asOf ? asOf : dayAfter(lead.startDate)
      await endOwnership.mutateAsync({ id: lead.id, endDate })
    }
    if (salesPersonId) {
      await assign.mutateAsync({ entityType: 'bid', entityId: row.id, salesPersonId, role: 'solutionLead', startDate: asOf, reason: 'reassignment' })
    }
  }

  /** The Next Action columns show the bid's earliest open follow-up. Editing one
   *  cancels it and opens a replacement carrying the change (follow-ups have no
   *  in-place edit), so the earlier version stays in the bid's history. */
  const replaceNextAction = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    const followUps = await repository.listFollowUps('bid', row.id)
    const current = followUps.filter((f) => f.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    const next = {
      note: current?.note ?? '',
      dueDate: current?.dueDate ?? today(),
      assigneeId: current?.assigneeId ?? null,
    }
    if (col.id === 'nextActionNote') next.note = value === null ? '' : String(value)
    else if (col.id === 'nextActionDueDate') {
      if (value === null || value === '') throw new Error('An action needs a due date.')
      next.dueDate = String(value)
    } else next.assigneeId = personIdByEmail(value)
    if (current) await setFollowUpStatus.mutateAsync({ id: current.id, status: 'cancelled' })
    await createFollowUp.mutateAsync({ entityType: 'bid', entityId: row.id, ...next })
  }

  // --- inline edit: optimistic, with rollback + inline error -------------------
  const commitCell = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    // Of the editable opportunity attributes only City is nullable; clearing the others stores ''.
    const opportunityValue = col.type === 'state'
      ? (value === null || value === '' ? null : Number(value))
      : value === null && col.id !== 'city' ? '' : value
    const snapshot = qc.getQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] })
    const department = col.editable === 'department' ? departments.find((d) => d.id === value) : undefined
    const patchRow = (r: BidGridRow): BidGridRow => {
      if (department) return { ...r, departmentId: department.id, departmentName: department.name, stateCode: department.stateCode ?? r.stateCode }
      if (col.editable === 'general' && col.generalField) return { ...r, generalValues: { ...r.generalValues, [col.generalField.key]: String(value ?? '') } }
      if (col.custom) {
        const customValues = { ...r.customValues }
        if (value === null) delete customValues[col.custom.key]
        else customValues[col.custom.key] = value as CustomValue
        return { ...r, customValues }
      }
      return { ...r, [col.id]: opportunityValue } as BidGridRow
    }
    qc.setQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] }, (old) => old?.map((r) => (r.id === row.id ? patchRow(r) : r)))
    try {
      if (col.editable === 'general' && col.generalField) {
        const saved = await repository.getBidSynopsis(row.id, 'general')
        let document = updateGeneralDocument(saved?.document, col.generalField.key, String(value ?? ''))
        const latest = snapshot.flatMap(([, data]) => data ?? []).find(candidate => candidate.id === row.id) ?? row
        for (const [key, linked] of [['tenderId', latest.gemTenderId], ['referenceNo', latest.referenceNo], ['assignmentName', latest.assignmentName]] as const) {
          document = updateGeneralDocument(document, key, String(linked ?? ''))
        }
        await saveSynopsis.mutateAsync({ bidId: row.id, section: 'general', document, expectedRevision: saved?.revision ?? 0 })
      }
      else if (col.custom) await setCustomValue.mutateAsync({ bidId: row.id, fieldId: col.custom.id, value })
      else if (col.editable === 'owner') {
        // Picking a person records a new ownership assignment from today (the history is kept).
        const person = lookups.persons.find((p) => p.email === value)
        if (!person) throw new Error('Choose a person from the Sales Team.')
        await assign.mutateAsync({ entityType: 'bid', entityId: row.id, salesPersonId: person.value, startDate: new Date().toISOString().slice(0, 10) })
      } else if (col.editable === 'department') {
        if (!department) throw new Error('Choose a department from Account Mapping.')
        await updateOpportunity.mutateAsync({ id: row.opportunityId, patch: { departmentId: department.id, stateCode: department.stateCode ?? null } })
      } else if (col.editable === 'solutionLead') {
        await replaceSolutionLead(row, value)
      } else if (col.editable === 'nextAction') {
        await replaceNextAction(row, col, value)
      } else if (col.editable === 'verify') {
        if (value !== 'verified') throw new Error('Only Verified can be set here - Needs Review comes from corrigenda and imports.')
        await markVerified.mutateAsync(row.id)
      } else if (col.editable === 'bid') {
        // Stage, Decision and Tender Link go through the bid's own update (its stage / Go / protected-value rules apply).
        await updateBid.mutateAsync({ id: row.id, patch: { [col.id]: value } as { stageKey?: string; decision?: 'pending' | 'go' | 'no_go'; tenderLink?: string | null } })
      } else await updateOpportunity.mutateAsync({ id: row.opportunityId, patch: { [col.id]: opportunityValue } })
      await qc.invalidateQueries({ queryKey: ['bidSynopsis', row.id] })
    } catch (error) {
      for (const [key, data] of snapshot) qc.setQueryData<BidGridRow[]>(key, current => current?.map(candidate => candidate.id === row.id ? (data?.find(previous => previous.id === row.id) ?? candidate) : candidate))
      throw error
    }
  }

  return useMutation({ mutationFn: ({ row, col, value }: { row: BidGridRow; col: GridColumnMeta; value: CellDraft }) => {
    // Serialize edits for one bid so two fields cannot overwrite the same General revision.
    const previous = editsByBid.get(row.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => commitCell(row, col, value))
    editsByBid.set(row.id, next)
    void next.finally(() => { if (editsByBid.get(row.id) === next) editsByBid.delete(row.id) }).catch(() => {})
    return next
  } })
}
