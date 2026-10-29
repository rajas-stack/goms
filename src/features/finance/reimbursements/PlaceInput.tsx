import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { Place } from './model'
import { mapsEnabled, suggestPlaces, type Suggestion } from './maps'
import { matchSaved, savedFor, useSavedPlaces } from './savedPlaces'

interface Option { key: string; main: string; secondary: string; starred: boolean; pick: () => Promise<Place> }

/** A place field: your starred places first (by short name), then Google Maps suggestions when Maps is set up.
 *  Picking a starred place fills its short name, so Particulars reads "Home to Delhi office". */
export function PlaceInput({ label, value, onChange, placeholder, onRemove }: {
  label: string
  value: Place
  onChange: (place: Place) => void
  placeholder: string
  onRemove?: () => void
}) {
  const { saved, star, unstar } = useSavedPlaces()
  const [google, setGoogle] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [naming, setNaming] = useState<string | null>(null)
  const listId = useId()
  const typed = useRef('')
  const pinned = value.lat != null
  const starredEntry = value.name.trim() ? savedFor(saved, value) : undefined

  useEffect(() => {
    if (!open || !mapsEnabled()) { setGoogle([]); return }
    const query = value.name
    const timer = window.setTimeout(() => {
      suggestPlaces(query).then((found) => { if (typed.current === query) { setGoogle(found); setActive(0) } })
        .catch((e) => setError(e instanceof Error ? e.message : 'Place search failed.'))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [value.name, open])

  const options: Option[] = [
    ...matchSaved(saved, value.name).map((s): Option => ({
      key: `saved:${s.short}`, main: s.short, secondary: s.place.address ?? s.place.name, starred: true,
      pick: async () => ({ ...s.place, name: s.short }),
    })),
    ...google.map((s): Option => ({ key: s.placeId, main: s.main, secondary: s.secondary, starred: false, pick: s.toPlace })),
  ]

  async function pick(o: Option) {
    setOpen(false); setGoogle([])
    try { onChange(await o.pick()) } catch { onChange({ name: o.main }) }
  }

  function saveStar() {
    const short = (naming ?? '').trim()
    if (!short) return
    star(short, value)
    onChange({ ...value, name: short })
    setNaming(null)
  }

  return (
    <div className="relative">
      <label><span className="mb-0.5 block text-[11px] font-medium text-muted">{label}</span>
        <div className="relative">
          <Icon name={pinned ? 'MapPin' : 'CircleDot'} size={14} className={cn('absolute left-3 top-1/2 -translate-y-1/2', pinned ? 'text-emerald-700' : 'text-muted')} />
          <Input value={value.name} placeholder={placeholder} className={cn('h-9 pl-8', onRemove ? 'pr-16' : 'pr-9')} autoComplete="off"
            role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
            onFocus={() => setOpen(true)}
            onChange={(e) => { typed.current = e.target.value; setError(''); setOpen(true); onChange({ name: e.target.value }) }}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !options.length) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length) }
              else if (e.key === 'Enter') { e.preventDefault(); void pick(options[Math.min(active, options.length - 1)]) }
              else if (e.key === 'Escape') setOpen(false)
            }} />
        </div>
      </label>
      {value.name.trim() && <button type="button" onClick={() => setNaming(starredEntry?.short ?? value.name.trim())}
        aria-label={starredEntry ? `Edit starred place ${starredEntry.short}` : `Star ${label} place`} title={starredEntry ? `Starred as “${starredEntry.short}”` : 'Star this place and give it a short name'}
        className={cn('absolute top-[22px] grid h-7 w-7 place-items-center rounded-md hover:bg-ink-900/[0.06]', onRemove ? 'right-8' : 'right-1', starredEntry ? 'text-amber-600' : 'text-muted hover:text-ink')}>
        <span aria-hidden className="text-[15px] leading-none">{starredEntry ? '★' : '☆'}</span>
      </button>}
      {onRemove && <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}
        className="absolute right-1 top-[22px] grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"><Icon name="X" size={14} /></button>}
      {pinned && value.address && <p className="mt-0.5 truncate text-[10px] leading-tight text-muted" title={value.address}>{value.address}</p>}
      {error && <p className="mt-0.5 text-[11px] text-crimson">{error}</p>}
      {naming !== null && <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
        <span aria-hidden className="text-amber-600">★</span>
        <Input value={naming} autoFocus maxLength={40} aria-label="Short name for this place" placeholder="Home, Delhi office…" className="h-8 max-w-[220px]"
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveStar() } else if (e.key === 'Escape') setNaming(null) }} />
        <Button size="sm" variant="primary" disabled={!naming.trim()} onClick={saveStar}>Save</Button>
        {starredEntry && <Button size="sm" variant="ghost" onClick={() => { unstar(starredEntry.short); setNaming(null) }}>Unstar</Button>}
        <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
      </div>}
      {open && options.length > 0 && <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-white py-1 shadow-panel">
        {options.map((o, i) => (
          <li key={o.key} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); void pick(o) }} onMouseEnter={() => setActive(i)}
            className={cn('flex cursor-pointer items-start gap-2 px-3 py-1.5', i === active && 'bg-panel')}>
            {o.starred ? <span aria-label="Starred" className="mt-0.5 text-[13px] leading-none text-amber-600">★</span> : <Icon name="MapPin" size={13} className="mt-0.5 shrink-0 text-muted" />}
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink-900">{o.main}</span>
              <span className="block truncate text-[11px] text-muted">{o.secondary}</span>
            </span>
          </li>
        ))}
      </ul>}
    </div>
  )
}
