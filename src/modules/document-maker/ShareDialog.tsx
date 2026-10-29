import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MAKER_PERMISSIONS, type MakerDocument, type MakerPermission, type MakerShare } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { repository } from '@/data/repository'

export const PERMISSION_LABELS: Record<MakerPermission, string> = { read: 'Read', comment: 'Comment', write: 'Write' }

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')

function PermissionBoxes({ value, onChange, name, disabled }: {
  value: MakerPermission[]; onChange: (next: MakerPermission[]) => void; name: string; disabled?: boolean
}) {
  return (
    <span className="flex items-center gap-3">
      {MAKER_PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-1.5 text-[12px] text-ink">
          <Checkbox
            checked={value.includes(p)} disabled={disabled} aria-label={`${PERMISSION_LABELS[p]} for ${name}`}
            onChange={(on) => onChange(MAKER_PERMISSIONS.filter((x) => (x === p ? on : value.includes(x))))}
          />
          {PERMISSION_LABELS[p]}
        </label>
      ))}
    </span>
  )
}

/** Owner only: share a file with Amnex employees from the directory, each with any mix of read / comment / write. */
export function ShareDialog({ doc, onClose }: { doc: MakerDocument | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const sharesKey = ['makerShares', doc?.id]
  const directory = useQuery({ queryKey: ['makerShareDirectory'], queryFn: () => repository.listMakerShareDirectory(), enabled: !!doc, staleTime: 5 * 60_000 })
  const shares = useQuery({ queryKey: sharesKey, queryFn: () => repository.listMakerShares(doc!.id), enabled: !!doc })
  const [email, setEmail] = useState('')
  const [picked, setPicked] = useState<MakerPermission[]>(['read'])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (doc) { setEmail(''); setPicked(['read']); setError(null) } }, [doc])

  const done = (next: MakerShare[]) => { queryClient.setQueryData(sharesKey, next); setError(null) }
  const share = useMutation({
    mutationFn: (input: { email: string; permissions: MakerPermission[] }) => repository.shareMakerDocument(doc!.id, input.email, input.permissions),
    onSuccess: done, onError: (e) => setError(errorText(e)),
  })
  const unshare = useMutation({
    mutationFn: (who: string) => repository.unshareMakerDocument(doc!.id, who),
    onSuccess: done, onError: (e) => setError(errorText(e)),
  })

  const sharedWith = useMemo(() => new Set((shares.data ?? []).map((s) => s.email)), [shares.data])
  const options = useMemo(() => (directory.data ?? [])
    .filter((person) => !sharedWith.has(person.email))
    .map((person) => ({ value: person.email, label: person.name || person.email, searchText: `${person.name} ${person.email}`, person: { name: person.name || person.email } })),
  [directory.data, sharedWith])

  const add = () => share.mutate({ email, permissions: picked }, { onSuccess: () => { setEmail(''); setPicked(['read']) } })
  const busy = share.isPending || unshare.isPending

  return (
    <Dialog open={!!doc} onClose={onClose} title={`Share "${doc?.title ?? ''}"`} description="Only Amnex employees can be added. Anyone you add can open the file; tick what else they may do." size="lg"
      footer={<Button size="sm" onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (email && picked.length) add() }}>
          <Combobox value={email} onChange={setEmail} options={options} aria-label="Employee to share with"
            placeholder={directory.isLoading ? 'Loading the directory…' : 'Search Amnex employees'} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PermissionBoxes value={picked} onChange={setPicked} name="the new person" />
            <Button size="sm" variant="primary" type="submit" disabled={!email || !picked.length || busy}>Share</Button>
          </div>
        </form>

        {(directory.isError || error) && <p role="alert" className="text-[13px] text-crimson">{error ?? errorText(directory.error)}</p>}

        <section aria-labelledby="dm-share-list" className="space-y-2">
          <h3 id="dm-share-list" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">People with access</h3>
          {shares.isLoading && <p className="text-[13px] text-muted">Loading…</p>}
          {shares.isSuccess && !shares.data.length && <p className="text-[13px] text-muted">Only you can see this file.</p>}
          <ul className="divide-y divide-line">
            {(shares.data ?? []).map((s) => (
              <li key={s.email} className="flex flex-wrap items-center gap-3 py-2">
                <PersonName person={{ name: s.name || s.email }} subtitle={s.email} size="sm" className="mr-auto" />
                <PermissionBoxes value={s.permissions} name={s.name || s.email} disabled={busy}
                  onChange={(next) => (next.length ? share.mutate({ email: s.email, permissions: next }) : unshare.mutate(s.email))} />
                <button type="button" onClick={() => unshare.mutate(s.email)} disabled={busy} aria-label={`Remove ${s.name || s.email}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-ink-900/[0.06] hover:text-crimson focus-visible:focus-ring disabled:opacity-40">
                  <Icon name="X" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  )
}
