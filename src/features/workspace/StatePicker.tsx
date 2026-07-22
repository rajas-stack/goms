import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Combobox } from '@/components/ui/Combobox'
import { useStates } from '@/lib/api'

/** First step of most FAB flows: resolve which state's workspace a create
 *  should land in, using the exact same state list `IndiaMap`'s picker reads
 *  (`useStates()`) — just as a compact searchable dropdown instead of a map,
 *  since this only needs to gather one value, not browse. */
export function StatePicker({ open, title, onPick, onClose }: {
  open: boolean
  title: string
  onPick: (stateCode: number) => void
  onClose: () => void
}) {
  const { data: states = [] } = useStates()
  const [code, setCode] = useState('')
  const options = states.map((s) => ({ value: String(s.code), label: s.name }))

  function submit() {
    if (!code) return
    onPick(Number(code))
    setCode('')
  }

  return (
    <Dialog
      open={open}
      onClose={() => { setCode(''); onClose() }}
      title={title}
      description="Choose a state to work in"
      footer={
        <>
          <Button onClick={() => { setCode(''); onClose() }}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!code}>Continue</Button>
        </>
      }
    >
      <Field label="State">
        <Combobox value={code} onChange={setCode} options={options} placeholder="Search a state…" aria-label="State" />
      </Field>
    </Dialog>
  )
}
