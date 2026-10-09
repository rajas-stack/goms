import { useEffect, useRef, useState } from 'react'
import type { GoogleService } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { useGooglePages } from './registry'
import { googleSettings, updateGoogleSettings } from './settings'
import { useGoogleAccount } from './session'
import { productFor } from './catalog'

export function IntegrationPagesPicker({ service, disabled }: { service: GoogleService; disabled?: boolean }) {
  const account = useGoogleAccount()
  const pages = useGooglePages(service)
  const settings = googleSettings(account)
  const excluded = settings.disabledPages[service] ?? []
  const count = pages.filter(page => !excluded.includes(page.id)).length
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  async function change(ids: string[], enabled: boolean) {
    if (!account || busy || disabled) return
    setBusy(true); setError('')
    try { await updateGoogleSettings(account, current => ({ ...current, disabledPages: { ...current.disabledPages,
      [service]: enabled ? (current.disabledPages[service] ?? []).filter(id => !ids.includes(id)) : [...new Set([...(current.disabledPages[service] ?? []), ...ids])] } })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save page selection.') }
    finally { setBusy(false) }
  }
  return <div ref={ref} className="relative">
    <button type="button" aria-label={`Choose pages for ${productFor(service).name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs text-ink focus-visible:focus-ring">
      {busy ? 'Saving…' : `${count} page${count === 1 ? '' : 's'}`}<Icon name="ChevronDown" size={13} />
    </button>
    {open && <div className="absolute left-0 top-full z-20 mt-2 w-64 max-w-[85vw] rounded-xl border border-line bg-white p-2 shadow-pop">
      <p className="px-2 py-1 text-xs font-semibold text-muted">Active pages</p>
      {pages.length ? pages.map(page => <label key={page.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-ink hover:bg-panel"><input type="checkbox" checked={!excluded.includes(page.id)} disabled={!account || disabled || busy} onChange={event => void change([page.id], event.target.checked)} className="h-4 w-4 accent-ink-700" />{page.label}</label>) : <p className="px-2 py-3 text-xs text-muted">No features use this service yet.</p>}
      {!!pages.length && <div className="mt-1 flex justify-between border-t border-line px-2 pt-2"><button disabled={!account || disabled || busy} onClick={() => void change(pages.map(page => page.id), true)} className="text-xs text-ink disabled:opacity-40">Select all</button><button disabled={!account || disabled || busy} onClick={() => void change(pages.map(page => page.id), false)} className="text-xs text-muted disabled:opacity-40">Clear</button></div>}
      {error && <p role="alert" className="p-2 text-xs text-crimson">{error}</p>}
    </div>}
  </div>
}
