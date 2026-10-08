import { Gate, useAllowed } from '@/lib/permissions'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { useProtectedValueMutations, useProtectedValues } from '@/lib/api'

/** The facts that can actually be protected: exactly the keys the API's shared
 *  guard checks on direct edits, milestone date edits, opportunity edits and
 *  corrigendum accepts (spec §13). Offering a field nothing enforces would
 *  be a freeze that silently doesn't hold, so identity/owner fields that no
 *  write path guards are deliberately not listed. */
export const PROTECTABLE_FIELDS = [
  { key: 'gemTenderId', label: 'Tender ID' },
  { key: 'valueAmount', label: 'Estimated Value' },
  { key: 'emdAmount', label: 'EMD / Tender Fee' },
  { key: 'submissionDeadline', label: 'Submission Deadline' },
  { key: 'tenderLink', label: 'Tender Link' },
] as const

export function ProtectedValuesTab({ bidId }: { bidId: string }) {
  const { data: values = [] } = useProtectedValues('bid', bidId)
  const { freeze, unfreeze } = useProtectedValueMutations('bid', bidId)
  const allowed = useAllowed('bid.protected', 'update')
  const [unfreezing, setUnfreezing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const frozen = new Set(values.filter((v) => v.frozen).map((v) => v.fieldKey))

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try { await action(); return true } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); return false }
  }

  return (
    <Gate allowed={allowed}>
    <div className="p-4" data-testid="protected-values-tab">
      <p className="mb-4 text-sm text-muted">
        Protect Value: freeze specific facts to prevent accidental overrides during team edits, imports or corrigenda.
        Changes are rejected until the value is unfrozen, and every unfreeze needs a reason.
      </p>
      {error && <p role="alert" className="mb-3 text-[13px] text-crimson">{error}</p>}
      {PROTECTABLE_FIELDS.map(({ key, label }) => {
        const isFrozen = frozen.has(key)
        return (
          <div key={key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3" data-testid="protected-row">
            <span className="flex items-center gap-2 text-sm text-ink">
              {label}
              {isFrozen && <Badge tone="blue"><Icon name="Lock" size={11} /> Frozen</Badge>}
            </span>
            {unfreezing === key ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Reason for unfreezing ${label}`} placeholder="Reason for unfreezing" autoFocus
                  className="h-8 w-64 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring"
                  value={reason} onChange={(e) => setReason(e.target.value)}
                />
                <LockSwitch
                  unlocked={false} lockedLabel="Confirm Unfreeze" unlockedLabel="Freeze value"
                  text="Confirm Unfreeze" className="lock-switch--wide" disabled={!reason.trim() || unfreeze.isPending}
                  onToggle={async () => {
                    if (await run(() => unfreeze.mutateAsync({ fieldKey: key, reason: reason.trim() }))) { setUnfreezing(null); setReason('') }
                  }}
                />
                <Button variant="ghost" size="sm" onClick={() => { setUnfreezing(null); setReason('') }}>Cancel</Button>
              </div>
            ) : (
              <LockSwitch
                unlocked={!isFrozen} lockedLabel={`Unfreeze ${label}`} unlockedLabel={`Freeze ${label}`}
                disabled={freeze.isPending || unfreeze.isPending}
                onToggle={() => { setError(null); if (isFrozen) setUnfreezing(key); else void run(() => freeze.mutateAsync(key)) }}
              />
            )}
          </div>
        )
      })}
    </div>
    </Gate>
  )
}
