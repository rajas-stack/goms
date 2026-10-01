import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import {
  useBidCustomFields, useBidsForGrid, useCorrigendumBidMap, useOwnershipAssignments, useSalesPersons,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuditLogs } from '@/modules/commercial-calculator/api'
import {
  ACTIVITY_KIND_LABEL, NO_ACTIVITY_FILTERS, buildActivityItems, filterActivity, formatDay, formatWhen, groupActivity,
  type ActivityChange, type ActivityFilters, type ActivityGroup, type ActivityItem, type ActivityKind,
} from '../activityFeed'
import { useEntityLookups } from '../useEntityLookups'

const PAGE_SIZE = 40

const KIND_ICON: Record<ActivityKind, string> = {
  edit: 'Pencil', stage: 'ArrowRight', decision: 'Flag', verify: 'ShieldCheck', ownership: 'User',
  protect: 'Lock', corrigendum: 'FileText', column: 'List',
}
const KIND_TONE: Record<ActivityKind, string> = {
  edit: 'bg-goms-sky/[0.18] text-goms-navy', stage: 'bg-goms-navy/10 text-goms-navy', decision: 'bg-goms-green/20 text-goms-navy',
  verify: 'bg-emerald-100 text-emerald-700', ownership: 'bg-amber-100 text-amber-700', protect: 'bg-panel text-ink-600',
  corrigendum: 'bg-blue-100 text-blue-700', column: 'bg-panel text-ink-600',
}

const control = 'h-8 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

/** "Today" / "Yesterday" / "01 Oct 2026" for a day heading. */
function dayHeading(iso: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return formatDay(iso)
}
const dayKey = (iso: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function Value({ v }: { v: string | null }) {
  return v === null ? <span className="text-muted">—</span> : <span>{v}</span>
}

/** `old → new`, the old value struck through so the direction reads at a glance. */
function Delta({ change }: { change: ActivityChange }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span className="text-muted [&_span:not(.text-muted)]:line-through"><Value v={change.from} /></span>
      <Icon name="ArrowRight" size={12} className="text-muted" />
      <span className="font-medium text-ink"><Value v={change.to} /></span>
    </span>
  )
}

function ChangeLines({ item, showLabel }: { item: ActivityItem; showLabel: boolean }) {
  if (!item.changes.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
      {item.changes.map((c, i) => (
        <li key={i}>
          {showLabel && <span className="mr-1.5 text-muted">{c.label}</span>}
          <Delta change={c} />
        </li>
      ))}
    </ul>
  )
}

function Entry({ group, bidLabel, bidExists }: {
  group: ActivityGroup
  bidLabel: (bidId: string) => { code: string; name: string } | null
  bidExists: (bidId: string) => boolean
}) {
  const [first] = group.items
  const many = group.items.length > 1
  const bid = group.bidId ? bidLabel(group.bidId) : null
  const deleted = !!group.bidId && !bidExists(group.bidId)
  return (
    <li data-testid="activity-entry" className="flex gap-3 rounded-xl border border-line bg-white p-3">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', KIND_TONE[first.kind])}>
        <Icon name={KIND_ICON[first.kind]} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink">
          {many ? `${group.byName} made ${group.items.length} changes` : first.title}
        </p>
        {many
          ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
              {group.items.map((it) => (
                <li key={it.id}>
                  {it.changes.length
                    ? it.changes.map((c, i) => <Fragment key={i}><span className="mr-1.5 text-muted">{c.label}</span><Delta change={c} /></Fragment>)
                    : it.title}
                  {it.note && <span className="ml-2 text-[12px] text-muted">{it.note}</span>}
                </li>
              ))}
            </ul>
          )
          : <ChangeLines item={first} showLabel={first.kind === 'corrigendum'} />}
        {!many && first.note && <p className="mt-0.5 text-[12px] text-muted">{first.note}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
          <span>by <span className="font-medium text-ink-600">{group.byName}</span></span>
          <span aria-hidden>·</span>
          <time dateTime={group.at}>{formatWhen(group.at)}</time>
        </p>
      </div>
      {group.bidId && (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {bid && <span className="max-w-[14rem] truncate text-[12px] font-semibold text-goms-navy" title={bid.name}>{bid.code}</span>}
          {bid && <span className="hidden max-w-[14rem] truncate text-[12px] text-muted sm:block">{bid.name}</span>}
          {deleted
            ? <span className="text-[12px] italic text-muted">(this bid was deleted)</span>
            : <Link to={`/bid-tracker/bid/${group.bidId}`} className="text-[12px] font-medium text-goms-navy underline decoration-goms-sky underline-offset-2">Open bid</Link>}
        </div>
      )}
    </li>
  )
}

/** Bid Tracker history as a readable feed: what happened, who did it, when, to
 *  which bid, and old → new values — built from the audit log and the ownership
 *  history, which stay exactly as they are. Entries for a hard-deleted bid keep
 *  showing, labelled, because audit rows outlive their bid. */
export function ActivityHistoryPage() {
  const { data: logs = [], isLoading: logsLoading } = useAuditLogs()
  const { data: assignments = [], isLoading: assignmentsLoading } = useOwnershipAssignments()
  const { data: people = [] } = useSalesPersons()
  const { data: bids = [], isLoading: bidsLoading } = useBidsForGrid()
  const { data: customFields = [] } = useBidCustomFields(true)
  const lookups = useEntityLookups()
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS)
  const [shown, setShown] = useState(PAGE_SIZE)

  const corrigendumBid = useCorrigendumBidMap(useMemo(() => bids.filter((b) => b.latestCorrigendumStatus !== null).map((b) => b.id), [bids]))
  const corrigendumKey = [...corrigendumBid].join('|')

  const bidById = useMemo(() => new Map(bids.map((b) => [b.id, b])), [bids])
  const bidLabel = (id: string) => { const b = bidById.get(id); return b ? { code: b.bidCode, name: b.opportunityName } : null }

  const items = useMemo(
    () => buildActivityItems(logs, assignments, { customFields, lookups, people, corrigendumBid }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, assignments, customFields, lookups, people, corrigendumKey],
  )

  const visibleItems = useMemo(
    () => filterActivity(items, filters, (id) => { const l = bidLabel(id); return l ? `${l.code} ${l.name}` : '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filters, bidById],
  )
  const groups = useMemo(() => groupActivity(visibleItems), [visibleItems])

  // The pick-lists only offer what the feed actually contains.
  const bidOptions = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.bidId).filter((x): x is string => !!x))]
    return ids.map((id) => ({ id, label: bidLabel(id) ? `${bidLabel(id)!.code} · ${bidLabel(id)!.name}` : 'Deleted bid' }))
      .sort((a, b) => a.label.localeCompare(b.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, bidById])
  const userOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) if (i.by) m.set(i.by, i.byName)
    return [...m].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [items])
  const kindOptions = useMemo(
    () => (Object.keys(ACTIVITY_KIND_LABEL) as ActivityKind[]).filter((k) => items.some((i) => i.kind === k)),
    [items],
  )

  if (logsLoading || assignmentsLoading || bidsLoading) return <div className="p-4 text-sm text-muted">Loading history…</div>
  if (items.length === 0) return <div className="p-6 text-center text-sm text-muted" data-testid="history-empty">No activity yet.</div>

  const set = (patch: Partial<ActivityFilters>) => { setFilters((f) => ({ ...f, ...patch })); setShown(PAGE_SIZE) }
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_ACTIVITY_FILTERS)
  const page = groups.slice(0, shown)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2" role="search" aria-label="Filter activity">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" aria-label="Search activity" placeholder="Search activity…" value={filters.query}
            onChange={(e) => set({ query: e.target.value })} className={cn(control, 'w-52 pl-7')}
          />
        </div>
        <select aria-label="Bid" className={cn(control, 'max-w-[15rem]')} value={filters.bidId} onChange={(e) => set({ bidId: e.target.value })}>
          <option value="">All bids</option>
          {bidOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <select aria-label="User" className={control} value={filters.by} onChange={(e) => set({ by: e.target.value })}>
          <option value="">All users</option>
          {userOptions.map((u) => <option key={u.email} value={u.email}>{u.name}</option>)}
        </select>
        <select aria-label="Activity type" className={control} value={filters.kind} onChange={(e) => set({ kind: e.target.value as ActivityKind | '' })}>
          <option value="">All activity</option>
          {kindOptions.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          From
          <input type="date" aria-label="From date" className={control} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          To
          <input type="date" aria-label="To date" className={control} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </label>
        {filtered && <Button variant="ghost" size="sm" onClick={() => set(NO_ACTIVITY_FILTERS)}>Clear filters</Button>}
        <span className="ml-auto text-[12px] text-muted" aria-live="polite">
          {groups.length} {groups.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="activity-feed">
        {page.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted" data-testid="history-no-match">
            Nothing matches these filters.
            <Button variant="ghost" size="sm" onClick={() => set(NO_ACTIVITY_FILTERS)}>Clear filters</Button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-2">
            {page.map((g, i) => {
              const newDay = i === 0 || dayKey(page[i - 1].at) !== dayKey(g.at)
              return (
                <Fragment key={g.id}>
                  {newDay && <h3 className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-muted first:mt-0">{dayHeading(g.at)}</h3>}
                  <ul className="contents"><Entry group={g} bidLabel={bidLabel} bidExists={(id) => bidById.has(id)} /></ul>
                </Fragment>
              )
            })}
            {groups.length > shown && (
              <Button variant="secondary" size="sm" className="mx-auto mt-2" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                Show more ({groups.length - shown} older)
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
