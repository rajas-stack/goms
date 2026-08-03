import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useEditionFeatures, useMasters, useSetEditionFeatures } from '../api'
import type { MasterBase } from '../types'

interface Selection {
  selected: boolean
  mandatory: boolean
}

/** The one hand-written master screen (spec §4.4) — everything else in
 *  Masters is generic. Lets an admin pick which Features belong to a
 *  Product Edition, and mark each mandatory vs optional. Submits the whole
 *  selected set at once via `setEditionFeaturesLogic`'s replace-all
 *  semantics, in the order Features are listed. */
export function EditionFeatureMappingDialog({ open, onClose, edition }: {
  open: boolean
  onClose: () => void
  edition: MasterBase
}) {
  const { data: features = [] } = useMasters('features')
  const { data: currentMappings = [] } = useEditionFeatures(edition.id)
  const setEditionFeatures = useSetEditionFeatures()

  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    const next: Record<string, Selection> = {}
    for (const m of currentMappings) next[m.featureId] = { selected: true, mandatory: m.mandatory }
    setSelections(next)
    setError(null)
    // Intentionally re-syncs only when the dialog opens, not on every
    // `currentMappings` change — this dialog owns the edit session, and a
    // background refetch mid-edit shouldn't clobber unsaved toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edition.id])

  function toggleSelected(featureId: string) {
    setSelections((prev) => ({
      ...prev,
      [featureId]: { selected: !prev[featureId]?.selected, mandatory: prev[featureId]?.mandatory ?? false },
    }))
  }
  function toggleMandatory(featureId: string) {
    setSelections((prev) => ({ ...prev, [featureId]: { selected: true, mandatory: !prev[featureId]?.mandatory } }))
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const mappings = features
        .filter((f) => selections[f.id]?.selected)
        .map((f) => ({ featureId: f.id, mandatory: selections[f.id]?.mandatory ?? false }))
      await setEditionFeatures.mutateAsync({ editionId: edition.id, mappings })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${edition.name} — Features`}
      description="Pick the features this edition includes, and mark each mandatory or optional."
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      {features.length === 0 ? (
        <p className="text-sm text-muted">No features exist yet — add some under the Features tab first.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {features.map((f) => {
            const sel = selections[f.id]
            return (
              <div key={f.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={Boolean(sel?.selected)} onChange={() => toggleSelected(f.id)} />
                  <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{f.code}</span>
                  {f.name}
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    disabled={!sel?.selected}
                    checked={Boolean(sel?.mandatory)}
                    onChange={() => toggleMandatory(f.id)}
                  />
                  Mandatory
                </label>
              </div>
            )
          })}
        </div>
      )}
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
    </Dialog>
  )
}
