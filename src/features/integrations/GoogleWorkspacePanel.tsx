import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GoogleService } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { productFor } from './catalog'
import { googleServiceEnabled } from './settings'
import { useGoogleAccount } from './session'
import { WORKSPACE_ACTIONS, runWorkspaceAction, type WorkspaceAction, type WorkspaceResult } from './workspaceClient'

/** The same panel can be embedded in a feature page using its registered page ID. */
export function GoogleWorkspacePanel({ service, pageId = 'integrations', onClose }: { service: GoogleService; pageId?: string; onClose?: () => void }) {
  const account = useGoogleAccount()
  return <WorkspaceContent key={`${service}:${account?.uid}:${account?.googleId}`} service={service} pageId={pageId} onClose={onClose} />
}
function WorkspaceContent({ service, pageId, onClose }: { service: GoogleService; pageId: string; onClose?: () => void }) {
  const account = useGoogleAccount()
  const definitions = WORKSPACE_ACTIONS[service] ?? []
  const [action, setAction] = useState<WorkspaceAction>(definitions[0]?.id ?? 'load')
  const [fields, setFields] = useState<Record<string, string>>({ target: 'hi', range: 'A1:F20' })
  const [file, setFile] = useState<File>()
  const [result, setResult] = useState<WorkspaceResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mapKey, setMapKey] = useState('')
  const [mapUrl, setMapUrl] = useState('')
  const generation = useRef(0)
  const definition = definitions.find(item => item.id === action)
  const enabled = !!account && googleServiceEnabled(service, pageId)
  useEffect(() => { if (!enabled) { generation.current++; setResult(undefined); setMapUrl('') } }, [enabled])
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') { generation.current++; setResult(undefined); setFields({ target: 'hi', range: 'A1:F20' }); setFile(undefined); setMapUrl(''); setMapKey('') } }
    document.addEventListener('visibilitychange', hidden)
    return () => { generation.current++; document.removeEventListener('visibilitychange', hidden) }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!enabled || busy) return
    setError(''); setResult(undefined)
    if (service === 'maps') {
      if (!mapKey.trim() || !fields.address?.trim()) { setError('Enter a Maps Embed API key and address.'); return }
      const query = new URLSearchParams({ key: mapKey.trim(), q: fields.address.trim() })
      setMapUrl(`https://www.google.com/maps/embed/v1/place?${query}`)
      return
    }
    setBusy(true)
    const current = ++generation.current
    try { const value = await runWorkspaceAction(service, action, fields, file, pageId); if (current === generation.current) { setResult(value); if (value.resourceId && ['docs', 'sheets', 'notebooklm'].includes(service)) setFields(previous => ({ ...previous, resource: value.resourceId! })); if (action === 'create' && ['gmail', 'chat'].includes(service)) setFields(previous => ({ ...previous, text: '' })) } }
    catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Google request failed.') }
    finally { setBusy(false) }
  }
  return <section aria-label={`${productFor(service).name} workspace`} className="mt-4 space-y-4 rounded-xl border border-line bg-panel p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{productFor(service).name} workspace</h3>{onClose && <Button size="icon" variant="ghost" aria-label="Close workspace" onClick={onClose}><Icon name="X" size={14} /></Button>}</div>
    {!enabled && <p role="status" className="text-xs text-muted">{account ? 'Enable this page in the pages dropdown.' : 'Sign in to use this service.'}</p>}
    {service === 'sites' && <p className="text-xs text-muted">Browse your Google Sites from Drive. Editing modern Sites pages requires Google Sites.</p>}
    {service === 'keep' && <p className="text-xs text-muted">Requires an eligible Workspace account and administrator-approved Keep API access.</p>}
    {service === 'notebooklm' && <p className="text-xs text-muted">Requires NotebookLM Enterprise, a licensed account and project access.</p>}
    <form onSubmit={event => void submit(event)} className="space-y-3">
      {definitions.length > 1 && <label className="block text-xs">Action<Select aria-label={`${productFor(service).name} action`} value={action} disabled={busy} onChange={event => { setAction(event.target.value as WorkspaceAction); setResult(undefined); setError('') }}>{definitions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
      {service === 'maps' ? <>
        <label className="block text-xs">Maps Embed API key<Input value={mapKey} required autoComplete="off" onChange={event => setMapKey(event.target.value)} /></label>
        <label className="block text-xs">Address<Input value={fields.address ?? ''} required onChange={event => setFields(previous => ({ ...previous, address: event.target.value }))} /></label>
        <p className="text-xs text-muted">Use a key restricted to Maps Embed and this website. It stays in this panel.</p>
      </> : definition?.fields.map(field => <label key={field.key} className="block text-xs">{field.label}{field.type === 'textarea' ? <Textarea required={field.required} disabled={busy} value={fields[field.key] ?? ''} onChange={event => setFields(previous => ({ ...previous, [field.key]: event.target.value }))} /> : <Input type={field.type ?? 'text'} required={field.required} disabled={busy} value={fields[field.key] ?? ''} onChange={event => setFields(previous => ({ ...previous, [field.key]: event.target.value }))} />}</label>)}
      {action === 'upload' && <label className="block text-xs">File (up to 25 MB)<Input type="file" required disabled={busy} onChange={event => setFile(event.target.files?.[0])} /></label>}
      <Button type="submit" size="sm" disabled={!enabled || busy}>{busy ? 'Working…' : service === 'maps' ? 'Show map' : definition?.label}</Button>
    </form>
    {error && <p role="alert" className="break-words text-xs text-crimson">{error}</p>}
    {mapUrl && <iframe title="Google Maps address preview" className="h-72 w-full rounded-lg border border-line" src={mapUrl} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />}
    {result && <div aria-live="polite" className="space-y-2">
      {result.message && <p role="status" className="text-xs">{result.message}</p>}
      {result.resourceId && <p className="break-all text-xs text-muted">ID: {result.resourceId}</p>}
      {result.meetingUrl?.startsWith('https://meet.google.com/') && <a className="text-sm underline" href={result.meetingUrl} target="_blank" rel="noopener noreferrer">Join meeting</a>}
      {result.text !== undefined && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs">{result.text || 'No text found.'}</pre>}
      {result.rows && <div className="max-h-80 overflow-auto"><table className="w-full text-xs"><tbody>{result.rows.map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col} className="border border-line p-2">{cell}</td>)}</tr>)}</tbody></table>{!result.rows.length && <p className="text-xs text-muted">No cells found.</p>}</div>}
      {result.items && <div className="max-h-80 space-y-2 overflow-auto">{!result.items.length && <p className="text-xs text-muted">No items returned by Google.</p>}{result.items.map(item => <div key={item.id} className="rounded-lg border border-line bg-white p-3"><p className="whitespace-pre-wrap break-words text-xs font-medium">{item.title}</p>{item.detail && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">{item.detail}</p>}{action === 'load' && ['docs', 'sheets', 'chat', 'tasks', 'notebooklm'].includes(service) && <button type="button" disabled={busy} className="mt-2 text-xs underline" onClick={() => { setFields(previous => ({ ...previous, resource: item.id })); setAction(service === 'chat' ? 'messages' : 'read'); setResult(undefined) }}>Select</button>}</div>)}</div>}
    </div>}
  </section>
}
