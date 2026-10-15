import { useEffect, useState } from 'react'
import { MAKER_LIMITS, type MakerDocument } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'

export function RenameDialog({ doc, onClose, onRename }: {
  doc: MakerDocument | null
  onClose: () => void
  onRename: (title: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => { if (doc) { setTitle(doc.title); setError(null) } }, [doc])

  const submit = async () => {
    setPending(true); setError(null)
    try { await onRename(title); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename the file.') } finally { setPending(false) }
  }

  return (
    <Dialog open={!!doc} onClose={onClose} title="Rename file" footer={<>
      <Button size="sm" onClick={onClose}>Cancel</Button>
      <Button size="sm" variant="primary" disabled={pending || !title.trim()} onClick={() => void submit()}>Rename</Button>
    </>}>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="space-y-2">
        <label htmlFor="dm-rename" className="text-[13px] font-medium text-ink">Name</label>
        <Input id="dm-rename" autoFocus maxLength={MAKER_LIMITS.title} value={title} onChange={(event) => setTitle(event.target.value)} />
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </form>
    </Dialog>
  )
}
