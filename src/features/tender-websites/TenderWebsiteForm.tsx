import { useId, useState, type FormEvent } from 'react'
import { assertUniqueTenderWebsiteName, normalizeTenderWebsiteInput, type TenderWebsite, type TenderWebsiteInput } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { useTenderDscEmployees } from './api'
import { lockCredentials, unlockCredentials } from './credentialLock'
import { useCredentialPassphrases, verifyPassphrase } from './passphrases'

interface Props {
  existing: readonly TenderWebsite[]
  editing?: TenderWebsite
  busy: boolean
  submitLabel: string
  onSubmit: (input: TenderWebsiteInput) => Promise<unknown>
  onCancel?: () => void
  /** Accessible name of the create form, e.g. "Add tender website". */
  formLabel?: string
  namePlaceholder?: string
}

export function TenderWebsiteForm({ existing, editing, busy, submitLabel, onSubmit, onCancel, formLabel = 'Add tender website', namePlaceholder = 'Name, e.g. E-Proc' }: Props) {
  const errorId = useId()
  const prefix = useId()
  const { data: employees = [], isLoading, isError, refetch } = useTenderDscEmployees()
  const [name, setName] = useState(editing?.name ?? '')
  const [url, setUrl] = useState(editing?.url ?? '')
  const [dscEmployeeId, setDscEmployeeId] = useState(editing?.dscEmployeeId ?? '')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [locked, setLocked] = useState(!!editing?.credentials)
  const [key, setKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockPassphrase, setUnlockPassphrase] = useState('')
  const { data: passphrases = [], isLoading: phrasesLoading, isError: phrasesError } = useCredentialPassphrases()
  const [passphraseId, setPassphraseId] = useState(editing?.credentials?.passphraseId ?? '')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [working, setWorking] = useState(false)
  const [lockError, setLockError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disabled = busy || working || !!editing?.editingLocked
  const passphraseFields = !locked && !editing?.credentials

  const closeUnlock = () => { if (!working) { setUnlocking(false); setUnlockPassphrase(''); setLockError(null) } }
  const openUnlock = () => { setLockError(null); setUnlocking(true) }
  const relock = () => {
    setLocked(true); setUserId(''); setPassword(''); setKey(''); setShowPassword(false)
    setNewPassphrase('')
  }

  const save = async () => {
    if (disabled) return
    setError(null)
    setWorking(true)
    try {
      const clean = normalizeTenderWebsiteInput({ name, url, dscEmployeeId: dscEmployeeId || null })
      assertUniqueTenderWebsiteName(existing, clean.name, editing?.id)
      if (dscEmployeeId && dscEmployeeId !== editing?.dscEmployeeId && !employees.some(person => person.id === dscEmployeeId)) {
        throw new Error('Select an active employee at L0, L1, or L2 for DSC.')
      }
      const needsLock = !!(userId || password || editing?.credentials)
      let encryptionKey = key
      const managed = passphrases.find(item => item.id === passphraseId)
      if (!locked && editing?.credentials?.passphraseId && (!managed || managed.proof.ciphertext !== editing.credentials.passphraseRevision)) {
        throw new Error('The passphrase changed or is unavailable. Reload before editing credentials.')
      }
      if (passphraseFields && needsLock) {
        if (!managed) throw new Error('Select a saved passphrase from Settings > Credentials.')
        await verifyPassphrase(managed, newPassphrase)
        encryptionKey = newPassphrase
      }
      clean.credentials = locked ? editing?.credentials ?? null
        : needsLock ? await lockCredentials({ userId, password }, encryptionKey) : null
      if (!locked && clean.credentials && managed) clean.credentials = { ...clean.credentials, passphraseId: managed.id, passphraseRevision: managed.proof.ciphertext }
      await onSubmit(clean)
      setKey(''); setUserId(''); setPassword(''); setShowPassword(false)
      setNewPassphrase('')
      if (!editing) { setName(''); setUrl(''); setDscEmployeeId(''); setLocked(false) }
      else setLocked(!!clean.credentials)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the website.') }
    finally { setWorking(false) }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void save() }
  const confirmUnlock = async () => {
    if (!editing?.credentials || working) return
    setWorking(true); setLockError(null)
    try {
      const credentials = await unlockCredentials(editing.credentials, unlockPassphrase)
      setUserId(credentials.userId); setPassword(credentials.password); setKey(unlockPassphrase)
      setLocked(false); setUnlocking(false); setUnlockPassphrase('')
    } catch (cause) { setLockError(cause instanceof Error ? cause.message : 'Could not unlock credentials.') }
    finally { setWorking(false) }
  }
  const unavailableDsc = !!dscEmployeeId && !employees.some(person => person.id === dscEmployeeId)

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label={editing ? `Edit ${editing.name}` : formLabel}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${prefix}-name`} className="mb-1 block text-[13px] font-medium">Name</label>
            <Input id={`${prefix}-name`} aria-label="Website name" placeholder={namePlaceholder} value={name} maxLength={100}
              aria-describedby={error ? errorId : undefined} disabled={disabled} onChange={event => setName(event.target.value)} />
          </div>
          <div>
            <label htmlFor={`${prefix}-url`} className="mb-1 block text-[13px] font-medium">Link</label>
            <Input id={`${prefix}-url`} aria-label="Website link" placeholder="https://" type="url" inputMode="url" value={url} maxLength={2000}
              aria-describedby={error ? errorId : undefined} disabled={disabled} onChange={event => setUrl(event.target.value)} />
          </div>
        </div>
        <div className="grid items-start gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${prefix}-user`} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium"><Icon name="Lock" size={12} /> User ID</label>
            <div className="flex gap-1">
              <Input id={`${prefix}-user`} aria-label="User ID" autoComplete="off" value={locked ? '••••••••' : userId}
                maxLength={200} readOnly={locked} disabled={disabled} placeholder="Portal user ID" onChange={event => setUserId(event.target.value)} />
              {editing?.credentials && <LockSwitch size="sm" className="self-center" unlocked={!locked} onToggle={locked ? openUnlock : relock}
                lockedLabel="Unlock User ID" unlockedLabel="Lock User ID" disabled={disabled} />}
            </div>
          </div>
          <div>
            <label htmlFor={`${prefix}-password`} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium"><Icon name="Lock" size={12} /> Password</label>
            <div className="flex gap-1">
              <Input id={`${prefix}-password`} aria-label="Password" autoComplete="new-password" type={showPassword && !locked ? 'text' : 'password'}
                value={locked ? '••••••••' : password} maxLength={2000} readOnly={locked} disabled={disabled} placeholder="Portal password" onChange={event => setPassword(event.target.value)} />
              {editing?.credentials && <LockSwitch size="sm" className="self-center" unlocked={!locked} onToggle={locked ? openUnlock : relock}
                lockedLabel="Unlock Password" unlockedLabel="Lock Password" disabled={disabled} />}
              {!locked && <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0" disabled={disabled}
                aria-label={showPassword ? 'Hide Password' : 'Show Password'} onClick={() => setShowPassword(!showPassword)}>
                <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={14} />
              </Button>}
            </div>
          </div>
          <div>
            <label htmlFor={`${prefix}-dsc`} className="mb-1 block text-[13px] font-medium">DSC</label>
            <div className="relative">
              <Select id={`${prefix}-dsc`} aria-label="DSC employee" value={dscEmployeeId} disabled={disabled || isLoading || isError} onChange={event => setDscEmployeeId(event.target.value)}>
                <option value="">{isLoading ? 'Loading employees...' : 'Select employee (L0 / L1 / L2)'}</option>
                {[0, 1, 2].map(level => <optgroup key={level} label={`L${level}`}>
                  {employees.filter(person => person.level === level).map(person => <option key={person.id} value={person.id}>{person.name} (L{person.level})</option>)}
                </optgroup>)}
                {unavailableDsc && <option value={dscEmployeeId}>Previously assigned employee (unavailable)</option>}
              </Select>
              <Icon name="ChevronDown" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
            {isError && <p role="alert" className="mt-1 text-xs text-crimson">Could not load employees. <button type="button" className="underline" onClick={() => void refetch()}>Retry</button></p>}
          </div>
        </div>
        {passphraseFields && <div className="grid gap-3 rounded-xl border border-line bg-panel/40 p-3 sm:grid-cols-2">
          <label className="block text-[13px] font-medium">Saved passphrase
            <Select aria-label="Saved passphrase" value={passphraseId} disabled={disabled || phrasesLoading || phrasesError} onChange={event => setPassphraseId(event.target.value)}>
              <option value="">Select passphrase</option>{passphrases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label className="block text-[13px] font-medium">Credential passphrase
            <Input aria-label="Credential passphrase" type="password" autoComplete="current-password" value={newPassphrase} disabled={disabled} onChange={event => setNewPassphrase(event.target.value)} />
          </label>
          {!passphrases.length && <p className="text-xs text-muted">Manage passphrases in Settings &gt; Credentials.</p>}
          {phrasesError && <p role="alert" className="text-xs text-crimson">Could not load saved passphrases.</p>}
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{locked ? 'Credentials locked. Unlock to view or change.' : 'Credentials are encrypted and locked when saved.'}</p>
          <div className="flex items-center gap-2">
            {editing?.credentials && !locked && <LockSwitch unlocked onToggle={relock} lockedLabel="Unlock credentials" unlockedLabel="Lock credentials"
              disabled={disabled} text="Lock credentials" className="lock-switch--wide" />}
            <Button type="submit" size="sm" variant="primary" disabled={disabled}>
              <Icon name={editing ? 'Check' : 'Plus'} size={14} /> {working ? 'Saving...' : submitLabel}
            </Button>
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy || working}>Cancel</Button>}
          </div>
        </div>
        {error && <p id={errorId} role="alert" className="text-[12px] text-crimson">{error}</p>}
      </form>
      <Dialog open={unlocking} onClose={closeUnlock} title="Unlock credentials" description="Enter the current credential passphrase.">
        <div className="space-y-3">
          <label className="block text-[13px] font-medium">Credential passphrase
            <Input autoFocus aria-label="Credential passphrase" type="password" autoComplete="current-password" value={unlockPassphrase}
              disabled={working} onChange={event => setUnlockPassphrase(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void confirmUnlock() } }} />
          </label>
          {lockError && <p role="alert" className="text-[12px] text-crimson">{lockError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeUnlock} disabled={working}>Cancel</Button>
            <LockSwitch unlocked={false} onToggle={() => void confirmUnlock()} disabled={working || !unlockPassphrase}
              lockedLabel="Unlock" unlockedLabel="Lock" text={working ? 'Please wait...' : 'Unlock'} />
          </div>
        </div>
      </Dialog>
    </>
  )
}
