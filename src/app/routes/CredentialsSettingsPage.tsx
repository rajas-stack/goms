import { useEffect, useState, type FormEvent } from 'react'
import { useGoogleAccount } from '@/features/integrations/session'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MAX_CREDENTIAL_PASSPHRASES, type CredentialPassphrase } from '@goms/domain'
import { repository } from '@/data/repository'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { SettingsIcon } from '@/components/theme/SettingsIcon'
import { useCredentialPassphrases, PASSPHRASES_KEY, createPassphraseProof, verifyPassphrase } from '@/features/tender-websites/passphrases'
import { lockCredentials, unlockCredentials } from '@/features/tender-websites/credentialLock'
import { TENDER_WEBSITES_KEY, useTenderWebsites } from '@/features/tender-websites/api'

export function CredentialsSettingsPage() {
  const account = useGoogleAccount()
  const { data: records = [], isLoading, isError, refetch } = useCredentialPassphrases()
  const tender = useTenderWebsites('tender')
  const verification = useTenderWebsites('verification')
  const sites = [...(tender.data ?? []), ...(verification.data ?? [])]
  const cache = useQueryClient()
  const [form, setForm] = useState<{ editing?: CredentialPassphrase } | null>(null)
  const [name, setName] = useState('')
  const [current, setCurrent] = useState('')
  const [phrase, setPhrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)
  const [siteId, setSiteId] = useState('')
  const [managedId, setManagedId] = useState('')
  const legacySites = sites.filter(site => site.credentials && !site.credentials.passphraseId)
  const reset = () => { setForm(null); setName(''); setCurrent(''); setPhrase(''); setConfirmation(''); setError('') }
  useEffect(() => { reset(); setLinking(false); setSiteId(''); setManagedId('') }, [account?.uid])
  const open = (editing?: CredentialPassphrase) => { reset(); setForm({ editing }); setName(editing?.name ?? '') }
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: PASSPHRASES_KEY }), cache.invalidateQueries({ queryKey: TENDER_WEBSITES_KEY })])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const editing = form?.editing
      if ((!editing || phrase) && (phrase.length < 12 || phrase !== confirmation)) throw new Error(phrase.length < 12 ? 'Use at least 12 characters.' : 'The passphrases do not match.')
      const proof = phrase ? await createPassphraseProof(phrase) : editing!.proof
      if (editing) {
        const replacements = []
        if (phrase) {
          await verifyPassphrase(editing, current)
          if (tender.isError || verification.isError || tender.isLoading || verification.isLoading) throw new Error('Wait for connected websites to load, then retry.')
          for (const site of sites.filter(item => item.credentials?.passphraseId === editing.id)) {
            const credentials = await lockCredentials(await unlockCredentials(site.credentials!, current), phrase)
            replacements.push({ id: site.id, previousCiphertext: site.credentials!.ciphertext,
              credentials: { ...credentials, passphraseId: editing.id, passphraseRevision: proof.ciphertext } })
          }
        }
        await repository.updateCredentialPassphrase({ id: editing.id, name, proof, expectedUpdatedAt: editing.updatedAt, replacements })
      } else await repository.createCredentialPassphrase({ name, proof })
      await refresh(); reset()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save passphrase.') }
    finally { setBusy(false) }
  }
  async function remove(record: CredentialPassphrase) {
    if (busy) return
    setBusy(true); setError('')
    try { await repository.deleteCredentialPassphrase(record.id); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove passphrase.') }
    finally { setBusy(false) }
  }
  async function linkLegacy(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const site = legacySites.find(item => item.id === siteId)
      const managed = records.find(item => item.id === managedId)
      if (!site?.credentials || !managed) throw new Error('Select a website and saved passphrase.')
      await verifyPassphrase(managed, phrase)
      const credentials = await lockCredentials(await unlockCredentials(site.credentials, current), phrase)
      await repository.updateTenderWebsite(site.id, { name: site.name, url: site.url,
        credentials: { ...credentials, passphraseId: managed.id, passphraseRevision: managed.proof.ciphertext } })
      await refresh(); reset(); setLinking(false); setSiteId(''); setManagedId('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link credentials.') }
    finally { setBusy(false) }
  }
  return <div className="h-full overflow-y-auto scrollbar-thin"><div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
    <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
    <div className="mb-6 flex items-center gap-3"><SettingsIcon kind="credentials" /><div className="flex-1"><h1 className="text-2xl font-semibold text-ink-900">Credentials</h1><p className="mt-1 text-[13px] text-muted">Shared passphrases · {records.length} / {MAX_CREDENTIAL_PASSPHRASES}</p></div>
      <Button size="sm" disabled={busy || isLoading || isError || records.length >= MAX_CREDENTIAL_PASSPHRASES} onClick={() => { setLinking(false); open() }}><Icon name="Plus" size={14} />Create new</Button></div>
    {isLoading && <p role="status">Loading passphrases…</p>}
    {isError && <p role="alert">Could not load passphrases. <button onClick={() => void refetch()} className="underline">Retry</button></p>}
    <div className="space-y-3">{records.map(record => { const count = sites.filter(site => site.credentials?.passphraseId === record.id).length
      return <div key={record.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-4"><Icon name="KeyRound" size={20} /><div className="flex-1"><strong>{record.name}</strong><p className="text-xs text-muted">{count} connected website{count === 1 ? '' : 's'}</p></div>
        <Button size="icon" variant="ghost" aria-label={`Edit ${record.name}`} disabled={busy} onClick={() => { setLinking(false); open(record) }}><Icon name="Pencil" size={15} /></Button>
        <Button size="icon" variant="ghost" aria-label={`Delete ${record.name}`} disabled={busy || count > 0 || tender.isLoading || verification.isLoading || tender.isError || verification.isError} onClick={() => void remove(record)}><Icon name="Trash2" size={15} /></Button></div>
    })}</div>
    {!!legacySites.length && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line p-4"><span className="text-sm">{legacySites.length} website{legacySites.length === 1 ? '' : 's'} with existing passphrases</span><Button size="sm" disabled={busy || !records.length} onClick={() => { reset(); setLinking(true) }}>Link credentials</Button></div>}
    {linking && <form aria-label="Link existing credentials" onSubmit={event => void linkLegacy(event)} className="mt-5 space-y-3 rounded-2xl border border-line bg-paper p-5">
      <label className="block text-sm">Website<Select aria-label="Existing credential website" value={siteId} disabled={busy} onChange={event => setSiteId(event.target.value)}><option value="">Select website</option>{legacySites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Select></label>
      <label className="block text-sm">Saved passphrase<Select aria-label="Managed passphrase" value={managedId} disabled={busy} onChange={event => setManagedId(event.target.value)}><option value="">Select passphrase</option>{records.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</Select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Existing website passphrase<Input aria-label="Existing website passphrase" type="password" autoComplete="current-password" value={current} disabled={busy} onChange={event => setCurrent(event.target.value)} /></label>
      <label className="block text-sm">Saved passphrase value<Input aria-label="Saved passphrase value" type="password" autoComplete="current-password" value={phrase} disabled={busy} onChange={event => setPhrase(event.target.value)} /></label></div>
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => { reset(); setLinking(false) }}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </form>}
    {!isLoading && !isError && !records.length && !form && <p className="rounded-xl border border-line p-5 text-sm text-muted">No saved passphrases.</p>}
    {form && <form aria-label={form.editing ? 'Edit passphrase' : 'Create passphrase'} onSubmit={event => void save(event)} className="mt-5 space-y-3 rounded-2xl border border-line bg-paper p-5">
      <label className="block text-sm">Name<Input aria-label="Passphrase name" value={name} maxLength={100} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {form.editing && <label className="block text-sm">Current passphrase<Input aria-label="Current passphrase" type="password" autoComplete="current-password" value={current} disabled={busy} onChange={event => setCurrent(event.target.value)} /></label>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">{form.editing ? 'New passphrase' : 'Passphrase'}<Input aria-label={form.editing ? 'New passphrase' : 'Passphrase'} type="password" autoComplete="new-password" value={phrase} required={!form.editing} disabled={busy} onChange={event => setPhrase(event.target.value)} /></label>
        <label className="block text-sm">Confirm passphrase<Input aria-label="Confirm passphrase" type="password" autoComplete="new-password" value={confirmation} required={!form.editing || !!phrase} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label></div>
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={reset}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-crimson">{error}</p>}
  </div></div>
}
