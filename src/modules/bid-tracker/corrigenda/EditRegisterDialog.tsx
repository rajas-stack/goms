import { useState } from 'react'
import { corrigendumHeading } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useBidCorrigendaMutations } from '@/lib/api'
import type { BidCorrigendum, CorrigendumRegister } from '@/lib/types'
import { normalizeRegister } from './model'
import { RegisterFields } from './RegisterFields'

/** Edits a corrigendum's register entry. The recorded changes are not
 *  editable here (or anywhere) — history is append-only. */
export function EditRegisterDialog({ bidId, corrigendum, onClose }: { bidId: string; corrigendum: BidCorrigendum; onClose: () => void }) {
  const { updateRegister } = useBidCorrigendaMutations(bidId)
  const [draft, setDraft] = useState<CorrigendumRegister>(() => normalizeRegister(corrigendum))
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    try {
      await updateRegister.mutateAsync({ corrigendumId: corrigendum.id, patch: draft })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the register.')
    }
  }

  return (
    <Dialog
      open onClose={onClose} size="lg" title={`Register — ${corrigendumHeading(corrigendum.corrigendumNumber)}`}
      description="Number of changes and open actions are counted automatically."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={updateRegister.isPending} onClick={save}>Save register</Button>
      </>}
    >
      <RegisterFields value={draft} onChange={setDraft} />
      {error && <p role="alert" className="mt-3 text-[13px] text-crimson">{error}</p>}
    </Dialog>
  )
}
