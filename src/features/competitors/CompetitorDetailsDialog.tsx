import type { ReactNode } from 'react'
import type { Competitor } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Can } from '@/lib/permissions'
import { CompetitorLogo } from './CompetitorLogo'
import { formatUpdated } from './CompetitorRow'
import { RelationshipPill } from './RelationshipPill'
import { TagChips } from './TagChips'

interface Props {
  competitor: Competitor | null
  onClose: () => void
  onEdit: (competitor: Competitor) => void
  onDelete: (competitor: Competitor) => void
}

function displayHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  )
}

const none = <p className="text-[13px] text-muted">Not set</p>

/** Every field of one competitor, with the Edit and Delete actions. */
export function CompetitorDetailsDialog({ competitor, onClose, onEdit, onDelete }: Props) {
  if (!competitor) return null
  const c = competitor
  return (
    <Dialog open size="lg" title={c.name} onClose={onClose}
      footer={<>
        <Can module="bid.columns" action="delete">
          <Button variant="ghost" className="mr-auto text-crimson hover:text-crimson" onClick={() => onDelete(c)}><Icon name="Trash2" size={14} /> Delete</Button>
        </Can>
        <Button onClick={onClose}>Close</Button>
        <Can module="bid.columns" action="update">
          <Button variant="primary" onClick={() => onEdit(c)}><Icon name="Pencil" size={14} /> Edit</Button>
        </Can>
      </>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <CompetitorLogo name={c.name} logo={c.logo} size="lg" />
          <div className="min-w-0 space-y-1.5">
            <RelationshipPill relationship={c.relationship} />
            {c.website && (
              <a href={c.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 rounded text-[13px] text-goms-navy hover:underline focus-visible:focus-ring">
                <Icon name="Globe" size={13} />{displayHost(c.website)}<Icon name="ExternalLink" size={11} />
              </a>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-paper p-3 text-[13px] sm:grid-cols-4">
          <div className="col-span-2"><dt className="text-[11px] text-muted">Industry / Category</dt><dd className="font-semibold text-ink-900">{c.category || '—'}</dd>
            {c.subCategories.length > 0 && <dd className="text-[12px] text-muted">{c.subCategories.join(', ')}</dd>}</div>
          <div><dt className="text-[11px] text-muted">Last updated</dt><dd className="text-ink-900">{formatUpdated(c.updatedAt)}</dd></div>
          <div><dt className="text-[11px] text-muted">Added</dt><dd className="text-ink-900">{formatUpdated(c.createdAt)}</dd></div>
        </dl>
        {c.description && <Block title="Notes"><p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-800">{c.description}</p></Block>}
        <div className="grid gap-5 sm:grid-cols-2">
          <Block title="Offerings">{c.offerings.length ? <TagChips tags={c.offerings} label={`${c.name} offerings`} /> : none}</Block>
          <Block title="Verticals">{c.verticals.length ? <TagChips tags={c.verticals} label={`${c.name} verticals`} /> : none}</Block>
          <Block title="Certifications">{c.certifications.length ? <TagChips tags={c.certifications} label={`${c.name} certifications`} /> : none}</Block>
          <Block title="Key strengths">
            {c.strengths.length ? (
              <ul className="space-y-1">
                {c.strengths.map(item => (
                  <li key={item} className="flex gap-1.5 text-[13px] text-ink-800">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-goms-navy" />{item}
                  </li>
                ))}
              </ul>
            ) : none}
          </Block>
        </div>
      </div>
    </Dialog>
  )
}
