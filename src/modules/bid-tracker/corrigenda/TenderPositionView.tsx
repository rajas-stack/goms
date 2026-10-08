import { CORRIGENDUM_MODULE_LABELS, type CorrigendumAffectedModule } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { currentSourceLabel, type ClauseHistory } from './tenderPosition'
import { displayValue, eyebrow } from './ui'

export type OpenSource = (corrigendumId: string, changeId: string) => void

function groupByModule(clauses: ClauseHistory[]) {
  return clauses.reduce<{ module: CorrigendumAffectedModule; items: ClauseHistory[] }[]>((groups, h) => {
    const last = groups[groups.length - 1]
    return last && last.module === h.module
      ? [...groups.slice(0, -1), { module: last.module, items: [...last.items, h] }]
      : [...groups, { module: h.module, items: [h] }]
  }, [])
}

/** Current View: every affected clause at its latest valid value, with the
 *  corrigendum it came from. Clicking the source opens that comparison. */
export function TenderPositionView({ clauses, onOpenSource }: { clauses: ClauseHistory[]; onOpenSource: OpenSource }) {
  return (
    <div className="space-y-5" data-testid="current-view">
      {groupByModule(clauses).map((g) => (
        <section key={g.module} aria-label={`${CORRIGENDUM_MODULE_LABELS[g.module]} — current position`}>
          <h4 className={cn(eyebrow, 'mb-2 text-muted')}>{CORRIGENDUM_MODULE_LABELS[g.module]}</h4>
          <ul className="space-y-2">
            {g.items.map((h) => {
              const src = h.current.source
              return (
                <li key={h.key} data-testid="position-row" className="neu-raised-sm grid gap-2 rounded-xl px-4 py-3 md:grid-cols-[minmax(10rem,14rem)_1fr_auto] md:items-start md:gap-4">
                  <div className="text-[13px] font-semibold text-ink-900">{h.title}</div>
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-800" data-testid="position-value">
                    {displayValue(h, h.current.value) || <span className="italic text-muted">Deleted</span>}
                  </p>
                  {src ? (
                    <button
                      type="button" onClick={() => onOpenSource(src.corrigendumId, src.changeId)}
                      className="inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full border border-blue/40 bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700 transition-colors hover:border-blue hover:bg-blue-100 focus-visible:focus-ring md:justify-self-end"
                    >
                      <Icon name="History" size={12} /> {currentSourceLabel(h)}
                      {src.decision === 'pending' && <span className="font-normal text-muted">· pending review</span>}
                    </button>
                  ) : (
                    <span className="justify-self-start whitespace-nowrap rounded-full bg-panel px-2.5 py-1 text-[12px] text-muted md:justify-self-end">{currentSourceLabel(h)}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
