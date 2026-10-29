import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { trashFile } from '@/features/dms/googleDrive'
import type { DmsConnection } from '@/features/dms/connections'
import { cn } from '@/lib/utils'
import { attachmentCode, attachmentFileName, billState, formatINR, type Attachment, type Expense } from './model'
import { attachmentBlob, connectFinanceDrive, forgetPendingFile, isDriveConnected, keepPendingFile, saveAttachment } from './drive'
import { ExpenseForm, type ExpenseValues } from './ExpenseForm'
import { DriveDeleteDialog } from './DriveDeleteDialog'

const MAX_BYTES = 25 * 1024 * 1024
const accepted = (f: File) => f.type === 'application/pdf' || f.type.startsWith('image/')

/** One row: its bills (add, preview, save to the Finance DMS under the row's code) and its details. */
export function AttachmentPane({ month, projects, code, expense, editable, drive, onChange, onDelete, onClose }: {
  month: string
  projects: string[]
  code: string
  expense: Expense
  editable: boolean
  drive: DmsConnection | null
  onChange: (expense: Expense) => void
  /** Starts the page's two-step row delete (row, then its Drive files). */
  onDelete: () => void
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState(expense.attachments[0]?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<Attachment | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const selected = expense.attachments.find((a) => a.id === selectedId) ?? null

  function addFiles(files: FileList | File[]) {
    const list = [...files]
    const bad = list.find((f) => !accepted(f) || f.size > MAX_BYTES)
    if (bad) { setError(`${bad.name}: attach a PDF or an image up to 25 MB.`); return }
    const added = list.map((file, i): Attachment => {
      const id = crypto.randomUUID()
      keepPendingFile(id, file)
      return { id, code: attachmentCode(code, expense.attachments.length + i), originalName: file.name, mimeType: file.type, size: file.size, state: 'pending' }
    })
    setError('')
    onChange({ ...expense, attachments: [...expense.attachments, ...added] })
    if (added[0]) setSelectedId(added[0].id)
  }

  async function save(targets: Attachment[]) {
    if (!drive) { setError('No DMS is assigned to Finance yet. Assign one in Settings → DMS, then save.'); return }
    setBusy('Saving to your Drive…'); setError('')
    try {
      await connectFinanceDrive(drive)
      const saved = await Promise.all(targets.map((a) => saveAttachment(drive, month, a)))
      const byId = new Map(saved.map((a) => [a.id, a]))
      onChange({ ...expense, attachments: expense.attachments.map((a) => byId.get(a.id) ?? a) })
      const failed = saved.find((a) => a.state === 'error')
      if (failed) setError(`${failed.code}: ${failed.error}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect to Google Drive.') } finally { setBusy('') }
  }

  /** Throws (keeping the dialog open with the message) when Drive is unreachable or refuses the trash. */
  async function remove(attachment: Attachment) {
    if (attachment.driveId) {
      if (!drive) throw new Error('No DMS is assigned to Finance, so the file cannot be removed from Drive.')
      await connectFinanceDrive(drive)
      await trashFile(attachment.driveId, drive.id)
    }
    setRemoving(null)
    forgetPendingFile(attachment.id)
    const rest = expense.attachments.filter((a) => a.id !== attachment.id)
    onChange({ ...expense, attachments: rest })
    setSelectedId(rest[0]?.id ?? null)
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (editable) addFiles(e.dataTransfer.files) }
  const pending = expense.attachments.filter((a) => a.state !== 'saved')

  return (
    <aside aria-label={`Row ${code}`} className="flex h-full min-h-0 flex-col border-l border-line bg-white">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-wide text-muted">{code}</p>
          <h2 className="truncate text-[15px] font-semibold text-ink-900">{expense.particulars}</h2>
          <p className="text-[12px] text-muted">{expense.mode}{expense.kms != null ? ` · ${expense.kms} km` : ''} · <span className="font-semibold text-ink-900">{formatINR(expense.amount)}</span> · Bills {billState(expense)}</p>
        </div>
        {editable && <Button size="icon" variant="ghost" title="Edit row" aria-label="Edit row" onClick={() => setEditing((v) => !v)}><Icon name="Pencil" size={15} /></Button>}
        <Button size="icon" variant="ghost" title="Close" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {editing && <div className="rounded-xl border border-line bg-panel/60 p-3">
          <ExpenseForm month={month} projects={projects} initial={expense} submitLabel="Save row" onCancel={() => setEditing(false)}
            onSubmit={(v: ExpenseValues) => { onChange({ ...expense, ...v }); setEditing(false) }} />
          <button type="button" onClick={onDelete} className="mt-3 text-[12px] text-crimson underline">Delete this row</button>
        </div>}

        <div onDragOver={(e) => { e.preventDefault(); if (editable) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          className={cn('rounded-xl border-2 border-dashed p-4 text-center transition-colors', dragging ? 'border-indigo bg-indigo-100/40' : 'border-line')}>
          <Icon name="Upload" size={20} className="mx-auto text-muted" />
          <p className="mt-1 text-[13px] text-ink-800">{editable ? 'Drop bills here — PDF or any image' : 'This claim is submitted; bills are read-only.'}</p>
          {editable && <Button size="sm" className="mt-2" onClick={() => input.current?.click()}>Choose files</Button>}
          <input ref={input} type="file" multiple hidden accept="application/pdf,image/*" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {expense.attachments.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Bills">
          {expense.attachments.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setSelectedId(a.id)} aria-pressed={a.id === selectedId}
                className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]', a.id === selectedId ? 'border-ink-900 bg-ink-900/[0.04]' : 'border-line')}>
                <Icon name={a.mimeType === 'application/pdf' ? 'FileText' : 'FileImage'} size={13} />
                <span className="font-mono">{a.code.slice(-2)}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', a.state === 'saved' ? 'bg-emerald' : a.state === 'error' ? 'bg-crimson' : 'bg-amber')} aria-label={a.state} />
              </button>
            </li>
          ))}
        </ul>}

        {selected && <Preview key={selected.id} attachment={selected} drive={drive} />}
        {selected && <div className="rounded-xl bg-panel/70 p-3 text-[12px]">
          <p className="text-muted">{selected.state === 'saved' ? 'Saved in your Drive as' : 'Will be saved as'}</p>
          <p className="font-mono text-[13px] text-ink-900">{attachmentFileName(selected.code, selected.originalName)}</p>
          <p className="text-muted">from {selected.originalName}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.state !== 'saved' && editable && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void save([selected])}><Icon name="Check" size={14} />Looks right — save to DMS</Button>}
            {selected.webViewLink && <a href={selected.webViewLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 px-2 text-indigo underline"><Icon name="ExternalLink" size={13} />Open in Drive</a>}
            {editable && <Button size="sm" variant="ghost" onClick={() => setRemoving(selected)}><Icon name="Trash2" size={14} />Remove</Button>}
          </div>
        </div>}

        {pending.length > 1 && editable && <Button size="sm" disabled={!!busy} onClick={() => void save(pending)}>Save all {pending.length} bills to DMS</Button>}
        {busy && <p className="text-[13px] text-muted" role="status">{busy}</p>}
        {error && <p role="alert" className="text-[13px] text-crimson">{error} {!drive && <Link to="/settings/dms" className="underline">Open DMS settings</Link>}</p>}
      </div>

      <ConfirmDeleteDialog open={!!removing && !removing.driveId} onClose={() => setRemoving(null)} itemLabel={removing?.code ?? ''} onConfirm={async () => { if (removing) await remove(removing) }} />
      <DriveDeleteDialog open={!!removing?.driveId} files={removing ? [removing.code] : []} keepLabel="Cancel"
        onKeep={() => setRemoving(null)} onDelete={async () => { if (removing) await remove(removing) }} />
    </aside>
  )
}

function Preview({ attachment, drive }: { attachment: Attachment; drive: DmsConnection | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const needsToken = attachment.state === 'saved' && !isDriveConnected(drive)
  useEffect(() => {
    let alive = true, made: string | null = null
    if (needsToken) return
    setError('')
    attachmentBlob(attachment, drive).then((blob) => {
      made = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: attachment.mimeType }))
      if (alive) setUrl(made); else URL.revokeObjectURL(made)
    }).catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load the bill.'))
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attempt re-runs the load after reconnecting
  }, [attachment, drive, attempt])

  // Google hands out a fresh Drive token only from a click; with the GOMS account known it opens no account picker.
  if (needsToken && drive) return (
    <div className="rounded-xl border border-line p-6 text-center">
      <Button size="sm" onClick={() => connectFinanceDrive(drive).then(() => setAttempt((n) => n + 1)).catch((e) => setError(e instanceof Error ? e.message : 'Could not reach Google Drive.'))}>
        <Icon name="Eye" size={14} />Load preview
      </Button>
      {error && <p className="mt-2 text-[12px] text-crimson">{error}</p>}
    </div>
  )
  if (error) return <p className="rounded-xl border border-line p-6 text-center text-[13px] text-muted">{error}</p>
  if (!url) return <div className="h-72 animate-pulse rounded-xl bg-panel" aria-label="Loading preview" />
  return attachment.mimeType === 'application/pdf'
    ? <iframe title={`Preview ${attachment.code}`} src={url} className="h-[28rem] w-full rounded-xl border border-line" />
    : <img src={url} alt={`Bill ${attachment.code}`} className="max-h-[28rem] w-full rounded-xl border border-line object-contain" />
}
