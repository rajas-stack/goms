import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LIFECYCLE_FIELDS, OPPORTUNITY_LIFECYCLE, isOwnedSheet, lifecycleIndex, lifecycleLabel,
  lifecycleSections, sheetModule, type LifecycleData, type OwnedSheet,
} from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { Icon } from '@/components/ui/Icon'
import { useBidMutations, useMyAccess } from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import { useNodeFilter } from '@/lib/rbacTree/access'
import type { Bid, BidGridRow } from '@/lib/types'
import { rowScopeFacts } from '../gridPermissions'
import { SHEET_NODE } from '../sheets'

export function lifecyclePath(sheet: OwnedSheet): string {
  return sheet === 'campaign' ? '/live-bids/campaign' : sheet === 'bidTracker' ? '/live-bids' : `/live-bids/pipeline/${sheet.slice('pipeline-'.length)}`
}

/** A link from an earlier list opens only that stage's cumulative workspace. */
export function lifecycleViewingSheet(current: OwnedSheet, requested: string | null): OwnedSheet {
  return requested && isOwnedSheet(requested) && lifecycleIndex(requested) < lifecycleIndex(current) ? requested : current
}

/** Stage moves happen only from the Live Bids grid's selection toolbar; here the stage is shown, not changed. */
export function LifecycleStageActions({ bid }: { bid: Bid }) {
  return <div className="flex flex-wrap items-center gap-2">
    <span className="mr-1 text-xs text-muted">Current stage: <strong className="text-ink">{lifecycleLabel(bid.sheet)}</strong></span>
  </div>
}

export function LifecycleWorkspace({ bid, row, viewingSheet, compact = false }: { bid: Bid; row?: BidGridRow; viewingSheet: OwnedSheet; compact?: boolean }) {
  const [draft, setDraft] = useState<LifecycleData>({})
  const [invalidDates, setInvalidDates] = useState<string[]>([])
  const [formRevision, setFormRevision] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { update } = useBidMutations()
  const perms = usePermissions()
  const allowedNode = useNodeFilter()
  const { data: myAccess } = useMyAccess()
  const facts = row ? rowScopeFacts(row, myAccess?.email ?? '', myAccess?.facts?.salesPersonId ?? null) : undefined
  const canEdit = allowedNode(SHEET_NODE[bid.sheet], 'edit') && (!perms.enforced || perms.canEdit(sheetModule(bid.sheet), 'opp.identity', facts))
  const dirty = Object.keys(draft).length > 0
  const sections = lifecycleSections(viewingSheet).filter(stage => stage.sheet !== 'bidTracker')
  const save = async () => {
    setError(null); setMessage(null)
    try {
      if (invalidDates.length) return
      await update.mutateAsync({ id: bid.id, patch: { lifecycleData: draft } })
      setDraft({}); setMessage('Stage details saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save stage details.') }
  }
  return <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
    {!compact && <>
      <Link to={lifecyclePath(viewingSheet)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"><Icon name="ArrowLeft" size={12} /> {lifecycleLabel(viewingSheet)} opportunities</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-lg font-semibold text-ink-900">{row?.opportunityName ?? 'Opportunity'}</h1>
          <p className="mt-1 text-sm text-muted">{[row?.departmentName, row?.city, row?.vertical].filter(Boolean).join(' · ')}</p>
          {row?.opportunityCode && <p className="mt-1 font-mono text-xs text-muted">{row.opportunityCode}</p>}
        </div>
        <span className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium">{lifecycleLabel(viewingSheet)} workspace{bid.status === 'archived' ? ' · Archived' : ''}</span>
      </div>
      <ol aria-label="Opportunity lifecycle" className="my-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-line py-3">
        {lifecycleSections(viewingSheet).map((stage, index) => <li key={stage.sheet} className="text-xs text-ink"><span className="mr-1.5 font-mono text-muted">0{index + 1}</span>{stage.label}</li>)}
      </ol>
    </>}
    <LifecycleStageActions bid={bid} />
    {viewingSheet !== bid.sheet && <p className="mt-2 text-xs text-muted">Showing information through {lifecycleLabel(viewingSheet)}. <Link className="text-goms-navy underline" to={`/live-bids/bid/${bid.id}`}>Open the current {lifecycleLabel(bid.sheet)} workspace</Link></p>}
    <form key={formRevision} onSubmit={event => { event.preventDefault(); void save() }}>
      {sections.map(stage => <section key={stage.sheet} aria-label={`${stage.label} details`} className="border-b border-line py-5">
        <div className="mb-4"><h2 className="text-sm font-semibold text-ink-900">{stage.label} details</h2><p className="mt-1 text-xs text-muted">{OPPORTUNITY_LIFECYCLE[lifecycleIndex(stage.sheet)].description}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">{LIFECYCLE_FIELDS.filter(field => field.sheet === stage.sheet).map(field => {
          const value = draft[field.key] ?? bid.lifecycleData?.[field.key] ?? ''
          return <Field key={field.key} label={field.label}>
            {canEdit ? field.multiline
              ? <Textarea value={value} maxLength={10000} disabled={update.isPending} onChange={event => { setDraft(current => ({ ...current, [field.key]: event.target.value })); setMessage(null) }} />
              : field.type === 'date' ? <FriendlyDateInput aria-label={field.label} format="optional-time" value={value} disabled={update.isPending}
                onChange={(next, change) => {
                  setInvalidDates(current => change.invalid ? [...new Set([...current, field.key])] : current.filter(key => key !== field.key))
                  setDraft(current => ({ ...current, [field.key]: next })); setMessage(null)
                }} />
              : <Input value={value} maxLength={10000} disabled={update.isPending} onChange={event => { setDraft(current => ({ ...current, [field.key]: event.target.value })); setMessage(null) }} />
              : <span className="block whitespace-pre-wrap text-sm text-ink">{value || 'Not recorded'}</span>}
          </Field>
        })}</div>
      </section>)}
      {canEdit && <div className="flex flex-wrap items-center gap-3 py-4">
        <Button type="submit" size="sm" variant="primary" disabled={!dirty || update.isPending || invalidDates.length > 0}>{update.isPending ? 'Saving…' : 'Save stage details'}</Button>
        {dirty && <Button size="sm" onClick={() => { setDraft({}); setInvalidDates([]); setFormRevision(value => value + 1); setError(null) }} disabled={update.isPending}>Discard changes</Button>}
        {dirty && <span className="text-xs text-muted">Save changes before moving stage.</span>}
      </div>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    </form>
  </div>
}
