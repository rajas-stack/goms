import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DMS_MODULES, type DmsModule } from './connections'

export function ModulePicker({ value, onChange, disabled = false }: { value: DmsModule[]; onChange: (modules: DmsModule[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} aria-expanded={open} aria-label="Choose where this DMS works" onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink hover:bg-panel focus-visible:focus-ring disabled:opacity-40">
        {value.length ? `${value.length} place${value.length === 1 ? '' : 's'} selected` : 'Choose places'}<ChevronDown size={14} />
      </button>
      {open && <div className="absolute right-0 top-full z-20 mt-2 w-64 max-w-[85vw] rounded-xl border border-line bg-white p-2 shadow-pop">
        <p className="px-2 pb-2 pt-1 text-xs font-semibold text-muted">Works in</p>
        {DMS_MODULES.map((module) => <label key={module.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-ink hover:bg-panel"><input type="checkbox" checked={value.includes(module.id)} onChange={(event) => onChange(event.target.checked ? [...value, module.id] : value.filter((id) => id !== module.id))} className="h-4 w-4 accent-indigo" />{module.label}</label>)}
        <div className="mt-1 flex justify-between border-t border-line px-2 pt-2"><button type="button" className="text-xs text-indigo" onClick={() => onChange(DMS_MODULES.map((module) => module.id))}>Select all</button><button type="button" className="text-xs text-muted" onClick={() => onChange([])}>Clear</button></div>
      </div>}
    </div>
  )
}
