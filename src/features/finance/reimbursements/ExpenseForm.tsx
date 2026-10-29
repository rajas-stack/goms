import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { AddableSelect } from '@/components/ui/AddableSelect'
import { Icon } from '@/components/ui/Icon'
import { Bike, BusFront, Car, CarTaxiFront, CircleOff, Plane, TrainFront, TramFront, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatINR, MODES, OWN_VEHICLE_RATE, ownVehicleAmount, returnTrip, routeText, type Expense, type Place } from './model'
import { mapsEnabled, routeKm } from './maps'
import { PlaceInput } from './PlaceInput'

export type ExpenseValues = Pick<Expense, 'trip' | 'date' | 'project' | 'particulars' | 'route' | 'mode' | 'kms' | 'amount' | 'remarks'>

interface Draft { trip: string; date: string; project: string; particulars: string; route: Place[]; mode: string; kms: string; amount: string; remarks: string }

const OWN = 'Own vehicle'
const blankRoute = (): Place[] => [{ name: '' }, { name: '' }]
const draftOf = (v: Partial<ExpenseValues>): Draft => ({
  trip: String(v.trip ?? 1), date: v.date ?? '', project: v.project ?? '', particulars: v.particulars ?? '', route: v.route?.length ? v.route : blankRoute(),
  mode: v.mode ?? 'Cab', kms: v.kms == null ? '' : String(v.kms), amount: v.amount == null ? '' : String(v.amount), remarks: v.remarks ?? '',
})

/** Checks a draft at the form boundary; returns the values or the first problem. */
export function parseDraft(d: Draft, month: string): ExpenseValues | string {
  const trip = Number(d.trip), kms = d.kms.trim() === '' ? null : Number(d.kms)
  const travel = d.mode !== 'NA', usesRoute = travel && d.route.some((p) => p.name.trim())
  const amount = d.mode === OWN && kms ? ownVehicleAmount(kms) : Number(d.amount)
  if (!Number.isInteger(trip) || trip < 0 || trip > 99) return 'Trip number must be a whole number from 0 to 99.'
  if (!d.date.startsWith(month)) return 'Pick a date in this month.'
  if (!d.project.trim()) return 'Select the Network / WBS / Project, or add it with +.'
  if (usesRoute && d.route.some((p) => !p.name.trim())) return 'Fill From, To and every stop — or remove the empty stop.'
  const particulars = d.particulars.trim() || (usesRoute ? routeText(d.route) : '')
  if (!particulars) return 'Say what the expense was (Particulars), or fill From and To.'
  if (kms !== null && (!Number.isFinite(kms) || kms < 0 || kms > 100_000)) return 'Kms must be a positive number.'
  if (d.mode === OWN && !kms) return `Enter the kms — own vehicle is paid at ${formatINR(OWN_VEHICLE_RATE)} per km.`
  if (!Number.isFinite(amount) || (d.mode !== OWN && d.amount.trim() === '') || amount < 0 || amount > 10_000_000) return 'Enter the amount in rupees.'
  return {
    trip, date: d.date, project: d.project.trim().slice(0, 200), particulars: particulars.slice(0, 200), mode: d.mode,
    route: usesRoute ? d.route.map((p) => ({ ...p, name: p.name.trim().slice(0, 200) })) : undefined,
    kms: travel ? kms : null, amount: Math.round(amount * 100) / 100, remarks: d.remarks.trim().slice(0, 300),
  }
}

/** Lucide has no auto-rickshaw, so this one is drawn in its style. */
function AutoRickshaw(props: LucideProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill={props.fill ?? 'none'} stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden>
      <path d="M4 15V9a5 5 0 0 1 5-5h5l4 7h1.5a1.5 1.5 0 0 1 1.5 1.5V15" /><path d="M9 4v7h9" />
      <path d="M2 17h3M9 17h6M19 17h3" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />
    </svg>
  )
}

const MODE_ICON: Record<(typeof MODES)[number], ComponentType<LucideProps>> = {
  Cab: CarTaxiFront, Auto: AutoRickshaw, Rickshaw: Bike, Bus: BusFront, Train: TrainFront, Metro: TramFront, Flight: Plane, 'Own vehicle': Car, NA: CircleOff,
}

/** Add or edit one expense row. In add mode the next row keeps trip, date, project and mode, and starts where this one ended. */
export function ExpenseForm({ month, initial, projects, last, nextTrip, disabled, submitLabel, onSubmit, onCancel }: {
  month: string
  /** Projects already used in any claim, offered in the dropdown. */
  projects: string[]
  initial: Partial<ExpenseValues>
  /** The previous row, for Return trip / Repeat last (add mode only). */
  last?: Expense
  nextTrip?: number
  disabled?: boolean
  submitLabel: string
  onSubmit: (values: ExpenseValues) => void
  onCancel?: () => void
}) {
  const [d, setD] = useState(() => draftOf(initial))
  const [error, setError] = useState('')
  const [distance, setDistance] = useState('')
  const particularsRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const amountId = useId()
  const set = (patch: Partial<Draft>) => { setD((prev) => ({ ...prev, ...patch })); setError('') }
  const [y, m] = month.split('-').map(Number)
  const lastDay = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const travel = d.mode !== 'NA', own = d.mode === OWN
  const amountShown = own ? (Number(d.kms) > 0 ? String(ownVehicleAmount(Number(d.kms))) : '') : d.amount
  const rate = Number(d.kms) > 0 && Number(amountShown) > 0 ? Number(amountShown) / Number(d.kms) : null

  /** Changing the route keeps Particulars in step unless the user wrote their own. */
  function setRoute(route: Place[]) {
    setD((prev) => ({ ...prev, route, particulars: !prev.particulars || prev.particulars === routeText(prev.route) ? routeText(route) : prev.particulars }))
    setError('')
  }

  const pinKey = d.route.map((p) => (p.lat != null ? `${p.lat},${p.lng}` : '')).join('|')
  useEffect(() => {
    if (!travel || !d.route.every((p) => p.lat != null)) { setDistance(''); return }
    let alive = true
    setDistance('Working out the road distance…')
    routeKm(d.route).then((km) => {
      if (!alive) return
      if (km != null) { set({ kms: String(km) }); setDistance(`${km} km by road · Google Maps`) } else setDistance('')
    }).catch((e) => alive && setDistance(e instanceof Error ? e.message : 'Distance unavailable.'))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when a pinned location changes
  }, [pinKey, travel])

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseDraft(d, month)
    if (typeof parsed === 'string') { setError(parsed); return }
    onSubmit(parsed)
    if (!onCancel) {
      const end = parsed.route?.[parsed.route.length - 1]
      setD((prev) => ({ ...prev, particulars: '', route: end ? [end, { name: '' }] : blankRoute(), kms: '', amount: '', remarks: '' }))
      particularsRef.current?.focus()
    }
  }
  const fromLast = (swap: boolean) => last && set({
    ...draftOf(last), date: d.date || last.date,
    route: last.route?.length ? (swap ? [...last.route].reverse() : last.route) : blankRoute(),
    particulars: swap ? returnTrip(last.particulars) : last.particulars,
  })
  const clear = () => { setD(draftOf({ trip: Number(d.trip) || 1, date: initial.date })); setError(''); setDistance('') }

  const wide = !onCancel
  /** Column spans: one dense row per group when adding; stacked in the narrow row pane when editing. */
  const span = (add: string, edit: string) => (wide ? add : edit)
  const label = 'mb-0.5 block text-[11px] font-medium text-muted'
  const quick = 'h-7 px-2 text-[12px]'

  return (
    <form onSubmit={submit} className="space-y-2" aria-label={submitLabel}>
      {!disabled && wide && <div className="flex flex-wrap items-center gap-1">
        <h2 className="mr-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink-900"><Icon name="Plus" size={15} />Add expense</h2>
        {last && <Button size="sm" variant="ghost" className={quick} onClick={() => fromLast(true)}><Icon name="ArrowLeftRight" size={13} />Return trip</Button>}
        {last && <Button size="sm" variant="ghost" className={quick} onClick={() => fromLast(false)}><Icon name="Copy" size={13} />Repeat last</Button>}
        {last && nextTrip != null && <Button size="sm" variant="ghost" className={quick} onClick={() => set({ trip: String(nextTrip) })}><Icon name="Plus" size={13} />New trip ({nextTrip})</Button>}
        <Button size="sm" variant="ghost" className={cn(quick, 'ml-auto')} onClick={clear}><Icon name="RotateCcw" size={13} />Clear</Button>
      </div>}
      <fieldset disabled={disabled} className="grid grid-cols-12 items-end gap-2">
        <label className={span('col-span-3 md:col-span-1', 'col-span-3')}><span className={label}>Trip</span>
          <Input type="number" min={0} max={99} value={d.trip} onChange={(e) => set({ trip: e.target.value })} className="h-9" />
        </label>
        <label className={span('col-span-9 md:col-span-2', 'col-span-9')}><span className={label}>Date</span>
          <Input type="date" min={`${month}-01`} max={lastDay} value={d.date} onChange={(e) => set({ date: e.target.value })} required className="h-9" />
        </label>
        <label className={span('col-span-12 md:col-span-4', 'col-span-12')}><span className={label}>Network / WBS / Project</span>
          <AddableSelect value={d.project} onChange={(project) => set({ project })} options={projects} storageKey="finance.reimbursement.projects" placeholder="Select project" className="[&_select]:h-9" />
        </label>
        <div className={span('col-span-12 md:col-span-5', 'col-span-12')} role="radiogroup" aria-label="Mode">
          <span className={label}>Mode</span>
          <div className="flex min-h-9 flex-wrap items-center gap-1">
            {MODES.map((mode) => {
              const on = d.mode === mode, ModeIcon = MODE_ICON[mode]
              return (
                <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => set({ mode, ...(mode === 'NA' ? { kms: '' } : {}) })}
                  className={cn('group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-lg px-2.5 text-[13px] font-medium transition-all duration-300 ease-out active:scale-95',
                    on ? 'bg-gradient-to-b from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-2px_0_rgb(0_0_0/0.25),0_3px_8px_rgb(11_43_73/0.35)] dark:text-black'
                      : 'text-goms-navy hover:-translate-y-px')}>
                  {/* hover shine: a light sweep that grows in from nothing */}
                  <span aria-hidden className={cn('pointer-events-none absolute inset-0 scale-0 opacity-0 transition-all duration-500 ease-out group-hover:scale-100 group-hover:opacity-100',
                    on ? 'bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.35),transparent_65%)]' : 'bg-[radial-gradient(circle_at_20%_50%,rgb(var(--c-goms-navy)/0.12),transparent_70%)]')} />
                  <ModeIcon size={18} strokeWidth={1.75}
                    className={cn('relative shrink-0 transition-all duration-300 group-hover:scale-110',
                      on ? 'fill-white/15 drop-shadow-[0_0_4px_rgb(255_255_255/0.55)] group-hover:drop-shadow-[0_0_7px_rgb(255_255_255/0.9)] dark:fill-black/10'
                        : 'fill-goms-navy/10 drop-shadow-[0_1px_1px_rgb(11_43_73/0.25)] group-hover:drop-shadow-[0_0_6px_rgb(var(--c-goms-navy)/0.5)]')} />
                  <span className="relative">{mode}</span>
                </button>
              )
            })}
          </div>
        </div>
        {travel && <div className="col-span-12 rounded-lg bg-panel/60 px-2 pb-1.5 pt-1" aria-label="Route" role="group">
          <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
            {d.route.map((place, i) => {
              const isFrom = i === 0, isTo = i === d.route.length - 1
              return <div key={i} className="flex min-w-[220px] flex-1 items-start gap-1.5">
                {i > 0 && <Icon name="ArrowRight" size={14} className="mt-[26px] shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <PlaceInput label={isFrom ? 'From' : isTo ? 'To' : `Stop ${i}`} value={place} placeholder={isFrom ? 'Where you started' : isTo ? 'Where you ended' : 'Stop on the way'}
                    onChange={(p) => setRoute(d.route.map((q, j) => (j === i ? p : q)))}
                    onRemove={!isFrom && !isTo ? () => setRoute(d.route.filter((_, j) => j !== i)) : undefined} />
                </div>
              </div>
            })}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px]" onClick={() => setRoute([...d.route.slice(0, -1), { name: '' }, d.route[d.route.length - 1]])}><Icon name="Plus" size={12} />Add stop</Button>
            <span className="text-[11px] text-muted">{distance || (mapsEnabled() ? 'Pick places from the list to pin them and fill the kms' : 'Map search is off (no Maps key) — type the places')}</span>
          </div>
        </div>}
        <label className={span('col-span-12 md:col-span-4', 'col-span-12')}><span className={label}>Particulars</span>
          <Input ref={particularsRef} value={d.particulars} onChange={(e) => set({ particulars: e.target.value })} className="h-9"
            placeholder={travel ? 'Filled from the route — or write your own' : 'Hotel stay, printouts…'} autoFocus={wide && !travel} />
        </label>
        <label className={span('col-span-4 md:col-span-1', 'col-span-4')}><span className={label}>Kms</span>
          <Input type="number" step="0.01" min={0} value={d.kms} disabled={!travel} onChange={(e) => set({ kms: e.target.value })} placeholder="NA" className="h-9" />
        </label>
        <div className={span('col-span-8 md:col-span-2', 'col-span-8')}>
          <div className="mb-0.5 flex items-baseline justify-between gap-1">
            <label htmlFor={amountId} className="text-[11px] font-medium text-muted">Amount (₹)</label>
            <span id={hintId} className="truncate text-[10px] text-muted">
              {own ? `${formatINR(OWN_VEHICLE_RATE)} × km` : rate ? `${formatINR(Math.round(rate * 100) / 100)}/km` : ''}
            </span>
          </div>
          <Input id={amountId} type="number" step="0.01" min={0} value={amountShown} readOnly={own} required={!own} onChange={(e) => set({ amount: e.target.value })}
            className={cn('h-9 font-semibold', own && 'bg-panel')} aria-describedby={hintId} />
        </div>
        <label className={span('col-span-12 md:col-span-3', 'col-span-12')}><span className={label}>Remarks</span>
          <Input value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="uber, no bill, Gpay…" className="h-9" />
        </label>
        {!disabled && <div className={span('col-span-12 md:col-span-2', 'col-span-12 flex gap-2')}>
          <Button type="submit" variant="primary" className="h-9 w-full" title={wide ? 'Enter adds the row · the next row keeps trip, date and project, and starts where this one ended' : undefined}>
            <Icon name={wide ? 'Plus' : 'Check'} size={15} />{submitLabel}
          </Button>
          {!wide && <Button variant="ghost" className="h-9" onClick={onCancel}>Cancel</Button>}
        </div>}
      </fieldset>
      {error && <p role="alert" className="text-[12px] text-crimson">{error}</p>}
    </form>
  )
}
