import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { GoogleService } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { SettingsIcon } from '@/components/theme/SettingsIcon'
import { notifyAuthRequired } from '@/lib/authPrompt'
import { loadGoogleIdentity } from '@/features/dms/googleDrive'
import { GOOGLE_PRODUCTS, googleProductUrl } from '@/features/integrations/catalog'
import { authorizeGoogle, testGoogleConnection, type ConnectionTest } from '@/features/integrations/googleClient'
import { googleSettings, googleSettingsStatus, loadGoogleSettings, updateGoogleSettings } from '@/features/integrations/settings'
import { useGoogleAccount, disconnectGoogleIntegrations, type GoogleAccount } from '@/features/integrations/session'
import { IntegrationPagesPicker } from '@/features/integrations/IntegrationPagesPicker'

export function IntegrationsSettingsPage() {
  const account = useGoogleAccount()
  return <IntegrationsContent key={account?.uid ?? 'guest'} account={account} />
}
function IntegrationsContent({ account }: { account: GoogleAccount | null }) {
  const settings = googleSettings(account)
  const status = account ? googleSettingsStatus(account.uid) : null
  const [busy, setBusy] = useState<GoogleService | 'connect' | 'save' | null>(null)
  const [checks, setChecks] = useState<Partial<Record<GoogleService, ConnectionTest>>>({})
  const [errors, setErrors] = useState<Partial<Record<GoogleService, string>>>({})
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [clientId, setClientId] = useState(settings.clientId)
  const [docsId, setDocsId] = useState(settings.docsId)
  const [sheetsId, setSheetsId] = useState(settings.sheetsId)
  const [project, setProject] = useState(settings.cloudProject)
  const [location, setLocation] = useState(settings.notebookLocation)
  const writable = !!account && status?.state === 'ready'
  useEffect(() => {
    setClientId(settings.clientId); setDocsId(settings.docsId); setSheetsId(settings.sheetsId); setProject(settings.cloudProject); setLocation(settings.notebookLocation)
  }, [settings.clientId, settings.docsId, settings.sheetsId, settings.cloudProject, settings.notebookLocation])
  useEffect(() => {
    let active = true; setReady(false)
    if (account && settings.clientId) void loadGoogleIdentity().then(() => { if (active) setReady(true) }).catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [account?.uid, settings.clientId])
  async function save(event: FormEvent) {
    event.preventDefault(); if (!account || !writable || busy) return
    setBusy('save'); setError('')
    try { await updateGoogleSettings(account, current => ({ ...current, clientId: clientId.trim(), docsId: docsId.trim(), sheetsId: sheetsId.trim(), cloudProject: project.trim(), notebookLocation: location })); disconnectGoogleIntegrations(); setChecks({}); setErrors({}) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save settings.') }
    finally { setBusy(null) }
  }
  async function test(service: GoogleService) {
    if (!account || busy) return
    setBusy(service); setErrors(current => ({ ...current, [service]: '' }))
    try { const result = await testGoogleConnection(service, account, settings); setChecks(current => ({ ...current, [service]: result })) }
    catch (cause) { setChecks(current => ({ ...current, [service]: undefined })); setErrors(current => ({ ...current, [service]: cause instanceof Error ? cause.message : 'Connection failed.' })) }
    finally { setBusy(null) }
  }
  return <div className="h-full overflow-y-auto scrollbar-thin"><div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
    <div className="mb-6 flex items-center gap-3"><SettingsIcon kind="integrations" /><div><h1 className="text-2xl font-semibold text-ink-900">Integrations</h1><p className="mt-1 text-[13px] text-muted">Google services · Connected to your workspace identity</p></div></div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
      <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold"><Icon name="ShieldCheck" size={17} />{account?.email ?? 'Amnex account required'}</p><p className="mt-1 text-xs text-muted">{account ? 'One account across Google services.' : 'Sign in with your verified @amnex.com Google account.'}</p></div>
      {account ? <div className="flex gap-2"><Button size="sm" disabled={!!busy || !ready} onClick={() => {
        setBusy('connect'); setError(''); void authorizeGoogle(account, [], settings.clientId).then(() => setError('')).catch(cause => setError(cause.message)).finally(() => setBusy(null))
      }}><Icon name="Link2" size={14} />{busy === 'connect' ? 'Connecting…' : 'Connect Google'}</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { disconnectGoogleIntegrations(); setChecks({}); setErrors({}) }}>Disconnect APIs</Button></div> : <Button size="sm" onClick={() => notifyAuthRequired('unauthorized')}>Sign in</Button>}
    </div>
    {status?.state === 'loading' && <p role="status" className="mb-3 text-sm text-muted">Loading your settings…</p>}
    {status?.state === 'error' && <p role="alert" className="mb-3 text-sm text-crimson">{status.error} <button className="underline" onClick={() => account && void loadGoogleSettings(account).catch(() => undefined)}>Retry</button></p>}
    <details className="mb-5 rounded-xl border border-line bg-paper p-4"><summary className="cursor-pointer text-sm font-semibold text-ink">Connection setup</summary>
      <form onSubmit={event => void save(event)} className="mt-4 space-y-3">
        <label className="block text-sm">Google OAuth client ID<Input aria-label="Google OAuth client ID" value={clientId} disabled={!writable || !!busy} onChange={event => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Test document ID (optional)<Input aria-label="Test document ID" value={docsId} disabled={!writable || !!busy} onChange={event => setDocsId(event.target.value)} /></label><label className="block text-sm">Test spreadsheet ID (optional)<Input aria-label="Test spreadsheet ID" value={sheetsId} disabled={!writable || !!busy} onChange={event => setSheetsId(event.target.value)} /></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Google Cloud project<Input aria-label="Google Cloud project" value={project} disabled={!writable || !!busy} onChange={event => setProject(event.target.value)} /></label><label className="block text-sm">NotebookLM location<Select aria-label="NotebookLM location" value={location} disabled={!writable || !!busy} onChange={event => setLocation(event.target.value as typeof location)}><option value="global">Global</option><option value="us">US</option><option value="eu">EU</option></Select></label></div>
        <p className="text-xs text-muted">Google may request consent. Cloud services require enabled APIs and project access.</p><div className="flex justify-end"><Button type="submit" size="sm" disabled={!writable || !!busy}>{busy === 'save' ? 'Saving…' : 'Save setup'}</Button></div>
      </form>
    </details>
    {error && <p role="alert" className="mb-4 text-sm text-crimson">{error}</p>}
    <div className="grid items-start gap-3 md:grid-cols-2">{GOOGLE_PRODUCTS.map(product => <section key={product.id} aria-label={`${product.name} integration`} className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel text-ink-700"><Icon name={product.icon} size={21} /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-ink-900">{product.name}</h2><p className="mt-0.5 text-xs text-muted">{checks[product.id]?.status === 'verified' ? 'API verified' : checks[product.id]?.status === 'authorized' ? 'Authorized · test resource needed' : account ? product.mode === 'web' ? 'Account linked · web access' : 'Account linked · API consent required' : 'Sign in required'}</p></div></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><IntegrationPagesPicker service={product.id} disabled={!writable || !!busy} /><div className="flex items-center gap-2"><Button size="sm" disabled={!account || !!busy || (product.mode !== 'web' && !ready)} aria-label={`Test ${product.name} connection`} onClick={() => void test(product.id)}><Icon name={busy === product.id ? 'Loader' : 'CircleCheck'} size={14} className={busy === product.id ? 'animate-spin' : undefined} />{busy === product.id ? 'Testing…' : 'Test'}</Button>
        <a href={googleProductUrl(product.id, account?.email)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${product.name}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted hover:text-ink focus-visible:focus-ring"><Icon name="ExternalLink" size={14} /></a></div></div>
      {checks[product.id] && <p role="status" className="mt-3 text-xs text-muted">{checks[product.id]?.message}</p>}{errors[product.id] && <p role="alert" className="mt-3 text-xs text-crimson">{errors[product.id]}</p>}
    </section>)}</div>
  </div></div>
}
