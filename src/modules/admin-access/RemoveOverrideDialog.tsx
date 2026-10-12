import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { errorMessage, roleLabel } from './format'

export interface RemoveTarget { id: string; email: string; role: string; effect: 'grant' | 'revoke' }

/** Confirmation before an override is removed. A refusal (for example the server saying only a System Admin can do this) keeps
 *  the dialog open and shows the server's message instead of closing silently. The removal itself is audited on the server. */
export function RemoveOverrideDialog({ target, onClose, onConfirm }: {
  target: RemoveTarget | null
  onClose: () => void
  onConfirm: (id: string) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [target?.id])

  async function confirm() {
    if (!target) return
    setPending(true)
    setError(null)
    try {
      await onConfirm(target.id)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause, 'Could not remove the override.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title="Remove override?"
      footer={(
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={pending}>{pending ? 'Removing…' : 'Remove'}</Button>
        </>
      )}
    >
      {target && (
        <p className="text-sm text-muted">
          Remove the {target.effect} of <span className="font-medium text-ink-900">{roleLabel(target.role)}</span> for <span className="font-medium text-ink-900">{target.email}</span>?
          It takes effect straight away. The change stays in the override history.
        </p>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
    </Dialog>
  )
}
