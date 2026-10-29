import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'

// No 0/O, 1/l/I: the code must be typeable exactly as shown.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** A random 6-character, case-sensitive code the user must type before Drive files are deleted. */
export function confirmCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join('')
}

/** Second, deliberate step before bills are removed from Google Drive (they move to Drive trash). */
export function DriveDeleteDialog({ open, files, onDelete, onKeep, keepLabel = 'Keep in Drive' }: {
  open: boolean
  /** Attachment codes of the Drive files that would be deleted. */
  files: string[]
  onDelete: () => Promise<void>
  onKeep: () => void
  keepLabel?: string
}) {
  const [code, setCode] = useState('')
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setCode(confirmCode()); setTyped(''); setError('') } }, [open])

  async function confirm() {
    if (typed !== code) return
    setPending(true); setError('')
    try { await onDelete() } catch (e) { setError(e instanceof Error ? e.message : 'Google Drive refused the delete.') } finally { setPending(false) }
  }

  return (
    <Dialog open={open} onClose={() => !pending && onKeep()} title={`Delete ${files.length === 1 ? 'this bill' : `${files.length} bills`} from Google Drive?`}
      description="The files move to your Drive trash, where Google keeps them for 30 days."
      footer={<>
        <Button onClick={onKeep} disabled={pending}>{keepLabel}</Button>
        <Button variant="danger" onClick={() => void confirm()} disabled={pending || typed !== code}>{pending ? 'Deleting…' : 'Delete from Drive'}</Button>
      </>}>
      <ul className="mb-3 max-h-28 overflow-auto rounded-lg bg-panel px-3 py-2 font-mono text-[12px] text-ink-800">
        {files.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <p className="text-sm text-muted">To confirm, type this code exactly — capitals matter:</p>
      <p className="my-2 select-none rounded-lg border border-dashed border-crimson/40 bg-crimson-100/40 py-2 text-center font-mono text-xl font-semibold tracking-[0.35em] text-ink-900" aria-label={`Code ${code.split('').join(' ')}`}>{code}</p>
      <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the code" autoFocus autoComplete="off" spellCheck={false}
        onPaste={(e) => e.preventDefault()} className="text-center font-mono tracking-[0.25em]"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirm() } }} />
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
    </Dialog>
  )
}
