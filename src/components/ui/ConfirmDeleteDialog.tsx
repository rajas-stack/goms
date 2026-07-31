import { useState } from 'react'
import { Dialog } from './Dialog'
import { Button } from './Button'

/** Generic "are you sure" gate for a one-click delete anywhere in the app —
 *  pairs with a local `open` boolean at the call site. `onConfirm` performs
 *  the actual mutation (and any toast/cleanup); throwing from it keeps the
 *  dialog open and surfaces the message instead of silently closing.
 *
 *  Domain-specific deletes that already have richer guidance of their own
 *  (e.g. node deletion, which offers Archive as a non-destructive
 *  alternative) keep their own dedicated dialog — this is for every other
 *  delete that previously had no confirmation at all. */
export function ConfirmDeleteDialog({ open, onClose, itemLabel, onConfirm }: {
  open: boolean
  onClose: () => void
  /** The name of the thing being deleted, e.g. a person's name — shown in the title. */
  itemLabel: string
  onConfirm: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${itemLabel}?`}
      description="This action can't be reverted."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Are you sure you want to delete {itemLabel}? This action can't be reverted.</p>
      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      )}
    </Dialog>
  )
}
