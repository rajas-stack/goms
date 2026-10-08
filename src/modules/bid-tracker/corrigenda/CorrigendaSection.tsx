import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidCorrigenda, useBidCorrigendaMutations, useDeliveryTeamMembers, useDocuments } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CorrigendumComparison } from './CorrigendumComparison'
import { EditRegisterDialog } from './EditRegisterDialog'
import { HistoryView } from './HistoryView'
import { RecordCorrigendumDialog } from './RecordCorrigendumDialog'
import { RegisterStrip } from './RegisterStrip'
import { loadSampleCorrigenda } from './sampleCorrigenda'
import { buildTenderPosition, versionChain } from './tenderPosition'
import { TenderPositionView } from './TenderPositionView'

type View = 'corrigendum' | 'current' | 'history'
const VIEWS: { value: View; label: string }[] = [
  { value: 'corrigendum', label: 'Comparison' }, { value: 'current', label: 'Current View' }, { value: 'history', label: 'History View' },
]
/** Local, dev-only QA aid: never offered against the real API. */
const SAMPLE_ENABLED = import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL

/** Corrigenda for one bid: the register, a per-corrigendum comparison, the
 *  Current Tender Position and the full version history. */
export function CorrigendaSection({ bidId }: { bidId: string }) {
  const { data: corrigenda = [], isLoading } = useBidCorrigenda(bidId)
  const { data: members = [] } = useDeliveryTeamMembers()
  const { data: documents = [] } = useDocuments('bid', bidId)
  const { create, reviewChange } = useBidCorrigendaMutations(bidId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>('corrigendum')
  const [highlight, setHighlight] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  const clauses = useMemo(() => buildTenderPosition(corrigenda), [corrigenda])
  const selected = corrigenda.find((c) => c.id === selectedId) ?? corrigenda[corrigenda.length - 1] ?? null
  const nextNumber = Math.max(0, ...corrigenda.map((c) => c.corrigendumNumber)) + 1
  const ownerName = (id: string | null) => members.find((m) => m.id === id)?.name ?? null

  useEffect(() => {
    if (!highlight || view !== 'corrigendum') return
    const frame = requestAnimationFrame(() => document.getElementById(`corrigendum-change-${highlight}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [highlight, view, selected?.id])

  const openSource = (corrigendumId: string, changeId: string) => { setSelectedId(corrigendumId); setHighlight(changeId); setView('corrigendum') }

  async function loadSample() {
    setSampleError(null)
    try {
      const [, c2] = await loadSampleCorrigenda(bidId, corrigenda, (input) => create.mutateAsync(input))
      setSelectedId(c2.id)
    } catch (e) { setSampleError(e instanceof Error ? e.message : 'Could not load the sample.') }
  }

  return (
    <section aria-labelledby="corrigenda-heading" className="border-t border-line pt-5" data-testid="corrigenda-section">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="corrigenda-heading" className="font-display text-base font-semibold text-ink-900">Corrigenda</h2>
          <p className="text-[12px] text-muted">Every version is kept — Original Tender → C1 → C2 → Current Effective.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SAMPLE_ENABLED && corrigenda.length === 0 && (
            <Button size="sm" variant="ghost" disabled={create.isPending} onClick={loadSample} title="Dev only — local data">
              <Icon name="Database" size={13} /> Load sample corrigenda
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setRecording(true)}><Icon name="Plus" size={13} /> Record corrigendum</Button>
        </div>
      </div>
      {sampleError && <p role="alert" className="mb-2 text-[13px] text-crimson">{sampleError}</p>}

      {isLoading && <p className="text-sm text-muted">Loading corrigenda…</p>}
      {!isLoading && corrigenda.length === 0 && (
        <div className="neu-inset rounded-2xl px-5 py-8 text-center">
          <Icon name="FileText" size={22} className="mx-auto text-muted" />
          <p className="mt-2 text-sm font-medium text-ink-800">No corrigenda recorded for this tender yet.</p>
          <p className="mt-1 text-[12.5px] text-muted">Record one to compare clauses and keep the tender’s current position up to date.</p>
        </div>
      )}

      {corrigenda.length > 0 && selected && (
        <div className="space-y-4">
          <RegisterStrip corrigenda={corrigenda} selectedId={selected.id} ownerName={ownerName} onSelect={(id) => { setSelectedId(id); setHighlight(null); setView('corrigendum') }} />
          <div role="tablist" aria-label="Corrigendum views" className="neu-inset inline-flex rounded-xl p-1">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" role="tab" aria-selected={view === v.value} onClick={() => setView(v.value)}
                className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:focus-ring',
                  view === v.value ? 'bg-white text-ink-900 shadow-sm' : 'text-muted hover:text-ink')}>
                {v.label}
              </button>
            ))}
          </div>
          {view === 'corrigendum' && (
            <CorrigendumComparison
              corrigendum={selected}
              owner={ownerName(selected.reviewOwnerId) ? { name: ownerName(selected.reviewOwnerId)! } : null}
              document={documents.find((d) => d.id === selected.sourceDocumentId) ?? null}
              highlightedChangeId={highlight}
              onEditRegister={() => setEditing(true)}
              onDecide={(changeId, decision) => reviewChange.mutateAsync({ changeId, decision })}
            />
          )}
          {view === 'current' && <TenderPositionView clauses={clauses} onOpenSource={openSource} />}
          {view === 'history' && <HistoryView chain={versionChain(corrigenda)} clauses={clauses} onOpenSource={openSource} />}
        </div>
      )}

      {recording && (
        <RecordCorrigendumDialog bidId={bidId} nextNumber={nextNumber} clauses={clauses} onClose={() => setRecording(false)}
          onCreated={(id) => { setSelectedId(id); setView('corrigendum'); setHighlight(null) }} />
      )}
      {editing && selected && <EditRegisterDialog bidId={bidId} corrigendum={selected} onClose={() => setEditing(false)} />}
    </section>
  )
}
