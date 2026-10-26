import { useMemo } from 'react'
import { BID_STAGES, resolveBidStages, type ResolvedBidStage } from '@goms/domain'
import { useMasterMutations, useMasters } from '@/modules/commercial-calculator/api'

/** Settings > Masters > Live Bids > Bid Stages over the built-in stages, in the user's order (bids.ts). */
export function useBidStages(): ResolvedBidStage[] {
  const { data = [] } = useMasters('bidStages')
  return useMemo(() => resolveBidStages(data), [data])
}

/** The Bid Stage dropdown: active stages in order; the value is the stage key stored on the bid. */
export function useBidStageOptions(): { value: string; label: string }[] {
  const stages = useBidStages()
  return useMemo(() => stages.filter((s) => s.active).map((s) => ({ value: s.key, label: s.label })), [stages])
}

/** Adds a stage (Settings, or typed into a Bid Stage cell) before the closing stages (Go Approved / Dropped)
 *  and returns its key. Bids store the code: the name as first typed (renames keep it), made unique. */
export function useAddBidStage(): { add: (name: string) => Promise<string>; isPending: boolean } {
  const { data = [] } = useMasters('bidStages')
  const { create, update } = useMasterMutations('bidStages')
  const add = async (name: string) => {
    const label = name.trim()
    const rows = [...data].sort((a, b) => a.displayOrder - b.displayOrder)
    if (rows.some((r) => r.name.trim().toLowerCase() === label.toLowerCase())) throw new Error(`A stage named "${label}" already exists.`)
    const codes = new Set(rows.map((r) => r.code.toLowerCase()))
    let code = label
    for (let n = 2; codes.has(code.toLowerCase()); n++) code = `${label} ${n}`
    const closing = rows.findIndex((r) => BID_STAGES.some((s) => s.closed && s.key === r.code))
    const at = closing < 0 ? rows.length : closing
    const created = await create.mutateAsync({ code, name: label, description: '', active: true, displayOrder: at } as never)
    // Renumber only the rows whose position changed.
    const list = [...rows.slice(0, at), created, ...rows.slice(at)]
    await Promise.all(list.flatMap((r, i) => (r.displayOrder === i ? [] : [update.mutateAsync({ id: r.id, patch: { displayOrder: i } })])))
    return code
  }
  return { add, isPending: create.isPending }
}
