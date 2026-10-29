import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  claimTotal, consolidatedBillsFileName, formatINR, isEditable, monthKey, orderedRows, recode, setStatus, statusIndex, type Claim, type ClaimStatus, type Expense,
} from './model'
import { useClaims } from './store'
import { useGoogleAccount } from '@/features/integrations/session'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import { connectFinanceDrive, financeDrive, isDriveConnected, renameAttachment } from './drive'
import { downloadBytes, mergeClaimPdf } from './exportFiles'
import { ExpenseForm, type ExpenseValues } from './ExpenseForm'
import { ExpenseTable } from './ExpenseTable'
import { AttachmentPane } from './AttachmentPane'
import { ClaimTotalCard, StatusTracker } from './ClaimSummary'
import { MasterView } from './MasterView'
import { ConveyanceExportDialog, downloadConveyance, useProfileClaimant } from './ConveyanceExportDialog'
import { isClaimantComplete } from './claimantProfile'
import { claimProjects } from './conveyanceForm'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { trashFile } from '@/features/dms/googleDrive'
import { DriveDeleteDialog } from './DriveDeleteDialog'

const STATUS_DOT: Record<ClaimStatus, string> = {
  collecting: 'bg-amber', submitted: 'bg-indigo', hod: 'bg-indigo', admin: 'bg-indigo', finance: 'bg-indigo', credited: 'bg-emerald', closed: 'bg-ink-600',
}
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function useDriveSessionTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('goms:dms-session-changed', bump)
    window.addEventListener('goms:dms-connections-changed', bump)
    return () => { window.removeEventListener('goms:dms-session-changed', bump); window.removeEventListener('goms:dms-connections-changed', bump) }
  }, [])
}

/** Finance › Reimbursements: one claim per month — capture expenses and bills, track approval, export the claim sheet. */
export function ReimbursementsPage() {
  const toast = useToast()
  const { user } = useAuthUser()
  const { claims, claimFor, putClaim } = useClaims()
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : monthKey(new Date())
  const view = params.get('view') === 'master' ? 'master' : 'month'
  const year = month.slice(0, 4)
  const claim = claimFor(month)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [conveyance, setConveyance] = useState(false)
  const [conveyanceBusy, setConveyanceBusy] = useState(false)
  const profile = useProfileClaimant()
  /** A complete Directory profile downloads straight away; otherwise ask for what's missing. */
  async function exportConveyance() {
    if (!profile || !isClaimantComplete(profile)) { setConveyance(true); return }
    setConveyanceBusy(true)
    try { await downloadConveyance(claim, { ...profile, project: claimProjects(claim) || profile.project }) }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not build the conveyance report.', undefined, 'error') }
    finally { setConveyanceBusy(false) }
  }
  useDriveSessionTick()
  const drive = financeDrive()
  const connected = isDriveConnected(drive)
  // Signed in with Google: saving reuses that account (no account picker), so there is nothing to connect.
  const linked = useGoogleAccount()

  const go = (next: { month?: string; view?: 'month' | 'master' }) => {
    setParams({ month: next.month ?? month, ...((next.view ?? 'month') === 'master' ? { view: 'master' } : {}) })
    setSelectedId(null)
  }

  /** Saves the claim with codes matching row positions; saved bills whose code changed are renamed in Drive. */
  function put(next: Claim) {
    const { claim: coded, renamed } = recode(next)
    if (!putClaim(coded)) toast('This browser refused to store the claim. Free some space, then try again.', undefined, 'error')
    if (renamed.length && drive && connected) {
      Promise.all(renamed.map((a) => renameAttachment(drive, a)))
        .catch(() => toast('Some bills in Drive could not be renamed to their new row codes.', undefined, 'error'))
    }
  }

  const rows = orderedRows(claim)
  const last = rows[rows.length - 1]?.expense
  const lastAnywhere = last ?? Object.values(claims).flatMap((c) => c.expenses).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const nextTrip = Math.max(0, ...claim.expenses.map((e) => e.trip)) + 1
  const selected = claim.expenses.find((e) => e.id === selectedId) ?? null
  const selectedCode = rows.find((r) => r.expense.id === selectedId)?.code ?? ''
  const editable = isEditable(claim)
  const today = todayIso()
  const defaultDate = today.startsWith(month) ? today : `${month}-01`

  function add(values: ExpenseValues) {
    const expense: Expense = { ...values, id: crypto.randomUUID(), attachments: [], createdAt: new Date().toISOString() }
    put({ ...claim, expenses: [...claim.expenses, expense] })
    toast(`Added ${formatINR(values.amount)} · month total ${formatINR(Math.round((claimTotal(claim) + values.amount) * 100) / 100)}`)
  }
  const update = (expense: Expense) => put({ ...claim, expenses: claim.expenses.map((e) => (e.id === expense.id ? expense : e)) })
  /** Two deliberate steps: delete the row, then (only if it has bills in Drive) the files, behind a typed code. */
  const [deleting, setDeleting] = useState<{ expense: Expense; code: string; stage: 'row' | 'drive' } | null>(null)
  const requestDelete = (id: string) => {
    const row = rows.find((r) => r.expense.id === id)
    if (row) setDeleting({ expense: row.expense, code: row.code, stage: 'row' })
  }
  async function deleteRow() {
    if (!deleting) return
    put({ ...claim, expenses: claim.expenses.filter((e) => e.id !== deleting.expense.id) })
    setSelectedId(null)
    if (deleting.expense.attachments.some((a) => a.driveId)) setDeleting({ ...deleting, stage: 'drive' })
    else { setDeleting(null); toast(`Deleted row ${deleting.code}`) }
  }
  async function deleteDriveFiles() {
    const files = deleting?.expense.attachments.filter((a) => a.driveId) ?? []
    if (!drive) throw new Error('No DMS is assigned to Finance, so the files cannot be removed from Drive.')
    await connectFinanceDrive(drive)
    const results = await Promise.allSettled(files.map((a) => trashFile(a.driveId!, drive.id)))
    const failed = files.filter((_, i) => results[i].status === 'rejected').map((a) => a.code)
    if (failed.length) throw new Error(`Google Drive did not delete ${failed.join(', ')}. Try again, or delete them in Drive.`)
    toast(`Deleted ${files.length === 1 ? 'the bill' : `${files.length} bills`} from Drive (in Drive trash for 30 days)`)
    setDeleting(null)
  }
  function changeStatus(status: ClaimStatus) {
    put(setStatus(claim, status, today))
    if (statusIndex(status) > statusIndex(claim.status)) toast(status === 'closed' ? '🎉 Claim closed — all done for this month' : `Status: ${status === 'submitted' ? 'submitted' : 'moved forward'}`)
  }

  async function mergePdf() {
    setBusy('Merging bills…')
    try {
      if (drive && claim.expenses.some((e) => e.attachments.some((a) => a.state === 'saved'))) await connectFinanceDrive(drive)
      const { pdf, skipped } = await mergeClaimPdf(claim, drive)
      downloadBytes(pdf, consolidatedBillsFileName(user?.displayName || user?.email?.split('@')[0] || '', month), 'application/pdf')
      if (skipped.length) toast(`Merged, but skipped ${skipped.join(', ')} (could not be read).`, undefined, 'error')
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not merge the bills.', undefined, 'error') } finally { setBusy('') }
  }

  const billCount = claim.expenses.reduce((n, e) => n + e.attachments.length, 0)
  const projects = useMemo(() => [...new Set(Object.values(claims).flatMap((c) => c.expenses.map((e) => e.project)).filter(Boolean))].sort(), [claims])
  const yearClaims = useMemo(() => MONTHS.map((m) => claims[`${year}-${m}`]), [claims, year])

  return (
    <div className="space-y-4">
      <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Reimbursements</h1>
            <div role="tablist" aria-label="View" className="flex rounded-lg bg-ink-900/[0.05] p-0.5">
              {(['month', 'master'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => go({ view: v })}
                  className={cn('h-8 rounded-md px-3 text-[13px] font-medium', view === v ? 'bg-white text-ink-900 shadow-sm' : 'text-muted hover:text-ink')}>
                  {v === 'month' ? 'Month' : 'Master'}
                </button>
              ))}
            </div>
          </div>
        {view === 'month' && <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-line bg-white">
              <button aria-label="Previous year" className="h-9 px-2 text-muted hover:text-ink" onClick={() => go({ month: `${Number(year) - 1}-${month.slice(5)}` })}><Icon name="ChevronLeft" size={16} /></button>
              <span className="px-1 text-[13px] font-semibold tabular-nums">{year}</span>
              <button aria-label="Next year" className="h-9 px-2 text-muted hover:text-ink" onClick={() => go({ month: `${Number(year) + 1}-${month.slice(5)}` })}><Icon name="ChevronRight" size={16} /></button>
            </div>
            <nav aria-label="Months" className="flex flex-1 flex-wrap gap-1">
              {MONTHS.map((m, i) => {
                const key = `${year}-${m}`, c = yearClaims[i], active = key === month
                return (
                  <button key={m} onClick={() => go({ month: key })} aria-current={active ? 'page' : undefined}
                    className={cn('flex min-w-[64px] flex-1 flex-col items-start rounded-lg border px-2 py-1 text-left transition-all active:scale-95',
                      active ? 'border-ink-900 bg-ink-900 text-paper shadow-sm' : 'border-line bg-white hover:border-ink-600')}>
                    <span className="flex items-center gap-1 text-[12px] font-semibold">
                      {new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })}
                      {c?.expenses.length ? <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[c.status])} aria-label={c.status} /> : null}
                    </span>
                    <span className={cn('text-[11px] tabular-nums', active ? 'text-paper/70' : 'text-muted')}>{c?.expenses.length ? formatINR(Math.round(claimTotal(c))) : '—'}</span>
                  </button>
                )
              })}
            </nav>
            </div>
            <StatusTracker claim={claim} onChange={changeStatus} />
          </div>
          <ClaimTotalCard claim={claim} />
        </div>}
      </div>

      {view === 'master' ? <MasterView claims={Object.values(claims)} onOpen={(m, id) => { go({ month: m }); setSelectedId(id) }} /> : <>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!claim.expenses.length || conveyanceBusy} onClick={() => void exportConveyance()}><Icon name="FileSpreadsheet" size={15} />Export Conveyance report</Button>
          <Button disabled={!billCount || !!busy} onClick={() => void mergePdf()}><Icon name="Layers" size={15} />{busy || `Merge ${billCount} bills to one PDF`}</Button>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[12px]">
            <span className={cn('h-2 w-2 rounded-full', drive && (connected || linked) ? 'bg-emerald' : drive ? 'bg-amber' : 'bg-crimson')} />
            {!drive ? <>No DMS for Finance · <Link to="/settings/dms" className="underline">assign one</Link></>
              : connected || linked ? <>Bills save to {drive.name}{linked ? <span className="text-muted"> · {linked.email}</span> : null}</>
              : <button className="underline" onClick={() => void connectFinanceDrive(drive).catch((e) => toast(e instanceof Error ? e.message : 'Could not connect.', undefined, 'error'))}>Connect {drive.name}</button>}
          </span>
        </div>

        {editable && <section aria-label="Add expense" className="rounded-xl border border-line bg-white px-3 py-2.5 shadow-panel">
          <ExpenseForm key={month} month={month} projects={projects} last={last} nextTrip={nextTrip} submitLabel="Add expense" onSubmit={add}
            initial={{ trip: last?.trip ?? 1, date: last?.date ?? defaultDate, project: lastAnywhere?.project ?? '', mode: last?.mode ?? 'Cab' }} />
        </section>}

        <div className={cn('grid gap-4', selected && 'lg:grid-cols-[minmax(0,1fr)_420px]')}>
          <ExpenseTable claim={claim} selectedId={selectedId} onSelect={setSelectedId} onDelete={editable ? requestDelete : undefined} />
          {selected && <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-180px)]">
            <AttachmentPane key={selected.id} month={month} projects={projects} code={selectedCode} expense={selected} editable={editable} drive={drive}
              onChange={update} onDelete={() => requestDelete(selected.id)} onClose={() => setSelectedId(null)} />
          </div>}
        </div>
      </>}

      <ConfirmDeleteDialog open={deleting?.stage === 'row'} onClose={() => setDeleting((d) => (d?.stage === 'row' ? null : d))} itemLabel={`row ${deleting?.code ?? ''}`} onConfirm={deleteRow}>
        {deleting?.expense && <p className="mt-2 text-sm text-ink-800">{deleting.expense.particulars} · {formatINR(deleting.expense.amount)}</p>}
        {deleting?.expense.attachments.some((a) => a.driveId) && <p className="mt-1 text-[13px] text-muted">Its bills in Google Drive are asked about next, separately.</p>}
      </ConfirmDeleteDialog>
      <ConveyanceExportDialog open={conveyance} claim={claim} projects={projects} onClose={() => setConveyance(false)} />
      <DriveDeleteDialog open={deleting?.stage === 'drive'} files={deleting?.expense.attachments.filter((a) => a.driveId).map((a) => a.code) ?? []}
        onDelete={deleteDriveFiles} onKeep={() => { if (deleting) toast(`Deleted row ${deleting.code}; its bills stay in Drive`); setDeleting(null) }} />
    </div>
  )
}
