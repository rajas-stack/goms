import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Combobox } from '@/components/ui/Combobox'
import { Icon } from '@/components/ui/Icon'
import { useStates } from '@/lib/api'
import { CENTRAL_STATE_CODE } from '@/data/gov-hierarchy'

type Stage = 'choice' | 'search'

/** First step of every state/org-scoped FAB flow: resolve which state's
 *  workspace a create should land in. Always presents an explicit
 *  Government of India vs. a-specific-state choice FIRST (never skipped,
 *  and never buried as just another alphabetical entry in the state list)
 *  — only after "Choose a State" does the searchable state list (`IndiaMap`'s
 *  own `useStates()` list, minus the virtual central entry) appear. Always
 *  shown, even when already browsing a specific state's workspace, so this
 *  stays an explicit choice every time, not an assumption. */
export function StatePicker({ open, title, defaultCode, onPick, onClose }: {
  open: boolean
  title: string
  /** Pre-fills the state search step with the state currently being browsed
   *  (if any) as a convenience once "Choose a State" is picked — never
   *  skips the Government of India / Choose a State step itself. */
  defaultCode?: number
  onPick: (stateCode: number) => void
  onClose: () => void
}) {
  const { data: states = [] } = useStates()
  const [stage, setStage] = useState<Stage>('choice')
  const [code, setCode] = useState('')
  // The virtual "Government of India (Central)" entry is its own first-class
  // choice above, not just another item in this searchable list.
  const options = states
    .filter((s) => s.code !== CENTRAL_STATE_CODE)
    .map((s) => ({ value: String(s.code), label: s.name }))

  useEffect(() => {
    if (!open) return
    setStage('choice')
    setCode(defaultCode != null && defaultCode !== CENTRAL_STATE_CODE ? String(defaultCode) : '')
  }, [open, defaultCode])

  function reset() {
    setStage('choice')
    setCode('')
  }

  function pickCentral() {
    onPick(CENTRAL_STATE_CODE)
    reset()
  }

  function submit() {
    if (!code) return
    onPick(Number(code))
    reset()
  }

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose() }}
      title={title}
      description={stage === 'choice' ? 'Government of India, or a specific state?' : 'Choose a state to work in'}
      footer={
        stage === 'choice' ? (
          <Button onClick={() => { reset(); onClose() }}>Cancel</Button>
        ) : (
          <>
            <Button onClick={() => setStage('choice')}>Back</Button>
            <Button variant="primary" onClick={submit} disabled={!code}>Continue</Button>
          </>
        )
      }
    >
      {stage === 'choice' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={pickCentral}
            className="flex w-full items-center gap-3 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:border-ink-600 hover:bg-panel"
          >
            <Icon name="Landmark" size={18} className="shrink-0 text-muted" />
            <span className="text-sm font-medium text-ink-900">Central Ministries (Govt. of India)</span>
          </button>
          <button
            type="button"
            onClick={() => setStage('search')}
            className="flex w-full items-center gap-3 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:border-ink-600 hover:bg-panel"
          >
            <Icon name="MapPin" size={18} className="shrink-0 text-muted" />
            <span className="text-sm font-medium text-ink-900">Choose a State</span>
          </button>
        </div>
      ) : (
        <Field label="State">
          <Combobox value={code} onChange={setCode} options={options} placeholder="Search a state…" aria-label="State" />
        </Field>
      )}
    </Dialog>
  )
}
