import { Link, useInRouterContext, useNavigate } from 'react-router-dom'
import { CORRIGENDUM_CLASSIFICATION_LABELS } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { HistoryView } from '../../../corrigenda/HistoryView'
import type { AfterCell } from './gridComparison'

const overviewSearch = (corrigendumId: string, changeId: string) =>
  `?${new URLSearchParams({ tab: 'overview', corrigendum: corrigendumId, change: changeId }).toString()}`

/** Overview link that opens the corrigendum comparison at this change. */
function OpenInOverview({ corrigendumId, changeId, onClose }: { corrigendumId: string; changeId: string; onClose: () => void }) {
  return (
    <Link to={{ search: overviewSearch(corrigendumId, changeId) }} onClick={onClose}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-panel focus-visible:focus-ring">
      <Icon name="ExternalLink" size={13} /> Open in Corrigenda
    </Link>
  )
}

/** The History View whose C-chips jump to that corrigendum's comparison on the Overview tab. */
function NavigableHistory({ cell, chain, onClose }: { cell: AfterCell; chain: string[]; onClose: () => void }) {
  const navigate = useNavigate()
  return <HistoryView chain={chain} clauses={[cell.history]} onOpenSource={(c, ch) => { onClose(); navigate({ search: overviewSearch(c, ch) }) }} />
}

/** Original → C1 → C2 → Current for one grid cell, reusing the History View. */
export function CellHistoryDialog({ cell, chain, onClose }: { cell: AfterCell; chain: string[]; onClose: () => void }) {
  // Outside a router (isolated component tests) there is no Overview to go to.
  const routed = useInRouterContext()
  return (
    <Dialog open onClose={onClose} size="lg" title={cell.history.title}
      description={`${CORRIGENDUM_CLASSIFICATION_LABELS[cell.source.classification]} by ${cell.code} — every version is kept.`}
      footer={<>
        {routed && <OpenInOverview corrigendumId={cell.source.corrigendumId} changeId={cell.source.changeId} onClose={onClose} />}
        <Button size="sm" variant="primary" onClick={onClose}>Close</Button>
      </>}>
      {routed
        ? <NavigableHistory cell={cell} chain={chain} onClose={onClose} />
        : <HistoryView chain={chain} clauses={[cell.history]} onOpenSource={() => undefined} />}
    </Dialog>
  )
}
