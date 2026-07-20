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

  async function confirm() {
    if (!node) return
    await remove.mutateAsync(node.id)
    toast(`Deleted ${node.name}`)
    onDeleted()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${node?.name ?? ''}?`}
      description="This removes the node and everything beneath it, including any employees posted there. This can't be undone."
      footer={
        <>
          <Button onClick={onClose}>Keep</Button>
          <Button variant="danger" onClick={confirm}>Delete permanently</Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Prefer to hide it instead? Archive keeps the record and its history, and you can restore it later.
      </p>
    </Dialog>
  )
}
