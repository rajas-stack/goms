import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Textarea } from '@/components/ui/Field'
import { dayKey } from './model'
import type { NewEvent } from './googleCalendar'

interface Draft { title: string; date: string; start: string; end: string; allDay: boolean; location: string; description: string; meet: boolean }
const blank = (day: Date): Draft => ({ title: '', date: dayKey(day), start: '10:00', end: '11:00', allDay: false, location: '', description: '', meet: true })

/** Checks the draft at the form boundary; returns the event or the first problem. */
export function parseNewEvent(d: Draft): NewEvent | string {
  if (!d.title.trim()) return 'Give the event a title.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Pick a date.'
  const [y, m, day] = d.date.split('-').map(Number)
  if (d.allDay) return { title: d.title.trim().slice(0, 200), start: new Date(y, m - 1, day), end: new Date(y, m - 1, day + 1), allDay: true, location: d.location.trim(), description: d.description.trim(), meet: false }
  const at = (t: string) => { const [h, min] = t.split(':').map(Number); return new Date(y, m - 1, day, h, min) }
  const start = at(d.start), end = at(d.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Pick a start and end time.'
  if (end <= start) return 'The event must end after it starts.'
  return { title: d.title.trim().slice(0, 200), start, end, allDay: false, location: d.location.trim().slice(0, 300), description: d.description.trim().slice(0, 4000), meet: d.meet }
}

export function NewEventDialog({ open, day, onClose, onCreate }: { open: boolean; day: Date; onClose: () => void; onCreate: (e: NewEvent) => Promise<void> }) {
  const [d, setD] = useState<Draft>(() => blank(day))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setD(blank(day)); setError('') } }, [open, day])
  const set = (patch: Partial<Draft>) => { setD((p) => ({ ...p, ...patch })); setError('') }

  async function save() {
    const parsed = parseNewEvent(d)
    if (typeof parsed === 'string') { setError(parsed); return }
    setBusy(true)
    try { await onCreate(parsed); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the event.') } finally { setBusy(false) }
  }
  const label = 'mb-0.5 block text-[11px] font-medium text-muted'
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="New event" description="Adds it to your Google Calendar."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Adding…' : 'Add to calendar'}</Button></>}>
      <div className="grid grid-cols-6 gap-2.5">
        <label className="col-span-6"><span className={label}>Title</span><Input autoFocus value={d.title} placeholder="Client review with DOIT" className="h-9" onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="col-span-6 sm:col-span-2"><span className={label}>Date</span><Input type="date" value={d.date} className="h-9" onChange={(e) => set({ date: e.target.value })} /></label>
        {!d.allDay && <>
          <label className="col-span-3 sm:col-span-2"><span className={label}>Starts</span><Input type="time" value={d.start} className="h-9" onChange={(e) => set({ start: e.target.value })} /></label>
          <label className="col-span-3 sm:col-span-2"><span className={label}>Ends</span><Input type="time" value={d.end} className="h-9" onChange={(e) => set({ end: e.target.value })} /></label>
        </>}
        <label className="col-span-6"><span className={label}>Location</span><Input value={d.location} placeholder="Office, client site, or leave blank" className="h-9" onChange={(e) => set({ location: e.target.value })} /></label>
        <label className="col-span-6"><span className={label}>Notes</span><Textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
        <div className="col-span-6 flex flex-wrap gap-4 text-[13px] text-ink-900">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.allDay} onChange={(e) => set({ allDay: e.target.checked })} />All day</label>
          {!d.allDay && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.meet} onChange={(e) => set({ meet: e.target.checked })} />Add Google Meet link</label>}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-crimson">{error}</p>}
    </Dialog>
  )
}
