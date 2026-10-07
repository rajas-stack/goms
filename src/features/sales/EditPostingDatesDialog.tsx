import { NO_PERMISSION_TITLE, useAllowed, usePermissions } from '@/lib/permissions'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useSalesPersonMutations } from '@/lib/api'
import { displayEndDate } from '@/lib/intervals'
import type { SalesPerson, SalesPosting } from '@/lib/types'

/** Edits a posting's Effective from / Effective to.
 *
 *  Storage is a half-open interval (exclusive end), but people think in "last
 *  day held" — so this field is the last day, blank meaning Present, and the
 *  server converts. The boundary rules (contiguity with the previous posting,
 *  no overlap) are enforced by `planPostingDatesEdit` in @goms/domain, shared
 *  with the API; a rejected edit shows its reason here and keeps the dialog
 *  open rather than failing silently.
 *
 *  Because "current" IS "no end date", setting Effective to on the current
 *  posting ENDS it — the person shows "No current posting" until Change
 *  posting is used. That consequence is spelled out before saving, and the
 *  primary button says so, rather than being a surprise afterwards. */
export function EditPostingDatesDialog({ open, person, posting, onClose }: {
  open: boolean
  person: SalesPerson
  posting: SalesPosting | null
  onClose: () => void
}) {
  const toast = useToast()
  const { updatePostingDates } = useSalesPersonMutations()
  const allowed = useAllowed('team.sales', 'update')
  const [startDate, setStartDate] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [error, setError] = useState<string | null>(null)

  const initialLastDay = displayEndDate(posting?.endDate ?? null) ?? ''

  useEffect(() => {
    if (!open || !posting) return
    setStartDate(posting.startDate)
    setLastDay(displayEndDate(posting.endDate) ?? '')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, posting?.id])

  if (!posting) return null

  const wasOpen = posting.endDate === null
  const ending = wasOpen && lastDay !== ''
  const reopening = !wasOpen && lastDay === ''
  const startChanged = startDate !== posting.startDate
  const endChanged = lastDay !== initialLastDay
  const canSubmit = startDate !== '' && !updatePostingDates.isPending

  async function submit() {
    if (!posting) return
    if (!startChanged && !endChanged) { onClose(); return }
    setError(null)
    try {
      await updatePostingDates.mutateAsync({
        postingId: posting.id,
        ...(startChanged ? { startDate } : {}),
        ...(endChanged ? { lastDayHeld: lastDay === '' ? null : lastDay } : {}),
      })
      toast(ending ? `Ended ${person.name}'s posting` : `Updated ${person.name}'s posting dates`)
      onClose()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not save these dates.')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit posting dates"
      description={`${person.name} · ${posting.designation || 'Posting'}`}
      footer={
        <>
          <Button onClick={onClose} disabled={updatePostingDates.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={(!canSubmit) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
            {updatePostingDates.isPending ? 'Saving…' : ending ? 'End posting & save' : 'Save dates'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Effective from" required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Effective to" hint="The last day in this posting. Leave blank for Present (current).">
          <Input type="date" value={lastDay} min={startDate || undefined} onChange={(e) => setLastDay(e.target.value)} />
        </Field>

        {ending && (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            This ends the posting. {person.name} will show “No current posting” until you use Change posting.
          </p>
        )}
        {reopening && (
          <p role="status" className="rounded-lg border border-line bg-panel/50 px-3 py-2 text-[13px] text-ink-700">
            Clearing Effective to reopens this posting as {person.name}’s current posting.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}
      </div>
    </Dialog>
  )
}
