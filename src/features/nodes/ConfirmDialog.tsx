import { NO_PERMISSION_TITLE, useAllowed, usePermissions } from '@/lib/permissions'
import { moduleForDomain, salesPersonRow } from '@/lib/routeModules'
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useNodeMutations } from '@/lib/api'
import type { HierNode } from '@/lib/types'

export function ConfirmDialog({ open, node, onClose, onDeleted }: {
  open: boolean
  node: HierNode | null
  onClose: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const { remove } = useNodeMutations()
  const allowed = useAllowed(moduleForDomain(node?.domain), 'delete')
  const [error, setError] = useState<string | null>(null)

  function close() { setError(null); onClose() }

  async function confirm() {
    if (!node) return
    setError(null)
    try {
      await remove.mutateAsync(node.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete � please try again.")
      return
    }
    toast(`Deleted ${node.name}`)
    onDeleted()
    close()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Delete ${node?.name ?? ''}?`}
      description="This removes the node and everything beneath it, including any employees posted there. This can't be undone."
      footer={
        <>
          <Button onClick={close} disabled={remove.isPending}>Keep</Button>
          <Button variant="danger" onClick={confirm} disabled={(remove.isPending) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
            {remove.isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Prefer to hide it instead? Archive keeps the record and its history, and you can restore it later.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-crimson/40 bg-crimson/5 px-3 py-2 text-[13px] text-crimson">{error}</p>}
    </Dialog>
  )
}
