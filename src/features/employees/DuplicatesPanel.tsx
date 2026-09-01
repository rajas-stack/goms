import { useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { useAllEmployees, useEmployeeDepartments } from '@/lib/api'
import { useDismissedDuplicatePairs } from '@/lib/dismissed-pairs'
import { findDuplicateCandidates, type DuplicateCandidate } from './duplicate-detection'
import { MergeEmployeesDialog } from './MergeEmployeesDialog'

/** App-wide sweep for likely duplicate contacts — a suggestion list, never an
 *  automatic merge. Each row can be reviewed (opens the hybrid merge dialog)
 *  or dismissed (persisted locally so it stops resurfacing). */
export function DuplicatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: employees = [] } = useAllEmployees()
  const { data: departmentOf = {} } = useEmployeeDepartments()
  const { isDismissed, dismiss } = useDismissedDuplicatePairs()
  const [reviewing, setReviewing] = useState<DuplicateCandidate | null>(null)

  // Only computed while the panel is actually open — this is an O(n²) sweep,
  // fine for an explicit user-triggered scan but wasteful on every render.
  const candidates = useMemo(
    () => (open ? findDuplicateCandidates(employees, { departmentOf }).filter((c) => !isDismissed(c.a.id, c.b.id)) : []),
    [open, employees, departmentOf, isDismissed],
  )

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Possible duplicate contacts"
        description={candidates.length > 0 ? `${candidates.length} pair${candidates.length === 1 ? '' : 's'} found, by name/email/phone/department match` : 'No likely duplicates found'}
        size="lg"
        footer={<Button onClick={onClose}>Close</Button>}
      >
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No two contacts look like the same person right now.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={`${c.a.id}:${c.b.id}`} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Avatar person={{ name: c.a.name, photoUrl: c.a.photoUrl, vacant: c.a.vacant }} size="xs" />
                      <p className="break-words text-sm font-medium text-ink-900">
                        {c.a.name || 'Unnamed'} <span className="text-muted">↔</span> {c.b.name || 'Unnamed'}
                      </p>
                      <Avatar person={{ name: c.b.name, photoUrl: c.b.photoUrl, vacant: c.b.vacant }} size="xs" />
                    </div>
                    <p className="text-[12px] text-muted">{c.a.designation || '—'} · {c.b.designation || '—'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.matchedOn.map((m) => (
                        <span key={m} className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-700">{m}</span>
                      ))}
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                        {Math.round(c.score * 100)}% match
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => setReviewing(c)}>
                      <Icon name="GitMerge" size={13} /> Review merge
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss(c.a.id, c.b.id)}>
                      <Icon name="X" size={13} /> Not a duplicate
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {reviewing && (
        <MergeEmployeesDialog
          open={!!reviewing}
          onClose={() => setReviewing(null)}
          employeeA={reviewing.a}
          employeeB={reviewing.b}
          onMerged={() => setReviewing(null)}
        />
      )}
    </>
  )
}
