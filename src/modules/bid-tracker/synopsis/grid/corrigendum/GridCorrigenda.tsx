import { useMemo, useState } from 'react'
import { corrigendumCode, type BidSynopsisSection, type SynopsisGrid } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidCorrigenda } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import type { ClauseDraft } from '../../../corrigenda/ClauseChangeEditor'
import { RecordCorrigendumDialog } from '../../../corrigenda/RecordCorrigendumDialog'
import { buildTenderPosition, versionChain, type ClauseHistory } from '../../../corrigenda/tenderPosition'
import type { GridCorrigendumOverlay } from './AfterColumnCells'
import { CellHistoryDialog } from './CellHistoryDialog'
import { buildGridComparison, EMPTY_COMPARISON, type AfterCell, type GridComparison } from './gridComparison'
import { clauseDraftFromCell } from './recordFromCell'

export interface GridCorrigendaState {
  comparison: GridComparison
  /** Derived columns are drawn (toolbar toggle, on by default). */
  visible: boolean
  setVisible: (next: boolean) => void
  /** Passed to SynopsisGridView; undefined while hidden. */
  overlay: GridCorrigendumOverlay | undefined
  dialogs: JSX.Element
}

/** Corrigendum comparison for one grid tab: derives the after-columns from the
 *  bid's corrigenda and owns the history / record dialogs. Nothing here is
 *  ever written into the grid itself. */
export function useGridCorrigenda(bidId: string, section: BidSynopsisSection, grid: SynopsisGrid, onError: (message: string) => void): GridCorrigendaState {
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const canRecord = useAllowed('bid.corrigenda', 'create')
  const histories = useMemo(() => buildTenderPosition(corrigenda), [corrigenda])
  const comparison = useMemo(() => (corrigenda.length ? buildGridComparison(grid, section, histories) : EMPTY_COMPARISON), [corrigenda.length, grid, section, histories])
  const [visible, setVisible] = useState(true)
  const [viewing, setViewing] = useState<AfterCell | null>(null)
  const [recording, setRecording] = useState<ClauseDraft | null>(null)
  const nextNumber = Math.max(0, ...corrigenda.map((c) => c.corrigendumNumber)) + 1

  const record = (rowId: string, columnId: string) => {
    try { setRecording(clauseDraftFromCell(grid, section, rowId, columnId, histories)) } catch (e) { onError(e instanceof Error ? e.message : 'Could not start recording.') }
  }
  const overlay: GridCorrigendumOverlay | undefined = visible
    ? { comparison, onOpen: setViewing, onRecord: canRecord ? record : undefined }
    : canRecord ? { comparison: EMPTY_COMPARISON, onOpen: setViewing, onRecord: record } : undefined

  const dialogs = (
    <>
      {viewing && <CellHistoryDialog cell={viewing} chain={versionChain(corrigenda)} onClose={() => setViewing(null)} />}
      {recording && (
        <RecordCorrigendumDialog bidId={bidId} nextNumber={nextNumber} clauses={histories} corrigenda={corrigenda} initialDraft={recording}
          onClose={() => setRecording(null)} onCreated={() => setVisible(true)} />
      )}
    </>
  )
  return { comparison, visible, setVisible, overlay, dialogs }
}

/** Toolbar toggle: "Corrigendum changes (3)". */
export function CorrigendaToggle({ state }: { state: GridCorrigendaState }) {
  const { comparison, visible, setVisible } = state
  if (!comparison.count && !comparison.orphans.length) return null
  return (
    <Button size="sm" aria-pressed={visible} title={visible ? 'Hide corrigendum changes' : 'Show corrigendum changes'} onClick={() => setVisible(!visible)}
      className={cn(visible && 'border-blue bg-blue-50 text-blue-700 hover:bg-blue-50')}>
      <Icon name="GitBranch" size={14} /> Show corrigendum changes{comparison.count ? ` (${comparison.count})` : ''}
    </Button>
  )
}

const effective = (h: ClauseHistory) => (h.current.source ? `${corrigendumCode(h.current.source.corrigendumNumber)}: ${h.current.value || 'Deleted'}` : 'Rejected — original stands')

/** Changes linked to rows/columns that were since removed from the grid. */
export function OrphanChanges({ comparison }: { comparison: GridComparison }) {
  if (!comparison.orphans.length) return null
  return (
    <details className="mx-4 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-ink">
      <summary className="cursor-pointer font-medium">
        {comparison.orphans.length} corrigendum change{comparison.orphans.length === 1 ? '' : 's'} point at rows or columns no longer in this grid
      </summary>
      <ul className="mt-2 space-y-1">
        {comparison.orphans.map((h) => (
          <li key={h.key} className="break-words"><span className="font-medium">{h.title}</span> — {effective(h)}</li>
        ))}
      </ul>
    </details>
  )
}
