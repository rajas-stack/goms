import { useId, useState, type FormEvent } from 'react'
import { assertUniqueTenderWebsiteName, normalizeTenderWebsiteInput, type TenderWebsite, type TenderWebsiteInput } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useTenderDscEmployees } from './api'
import { lockCredentials, unlockCredentials } from './credentialLock'

interface Props {
  existing: readonly TenderWebsite[]
  editing?: TenderWebsite
  busy: boolean
  submitLabel: string
  onSubmit: (input: TenderWebsiteInput) => Promise<unknown>
  onCancel?: () => void
}

export function TenderWebsiteForm({ existing, editing, busy, submitLabel, onSubmit, onCancel }: Props) {
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
  const [dialog, setDialog] = useState<'setup' | 'unlock' | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [working, setWorking] = useState(false)
  const [lockError, setLockError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disabled = busy || working

  const closeLock = () => { if (!working) { setDialog(null); setPassphrase(''); setConfirmation(''); setLockError(null) } }

  const save = async (unlockKey = key) => {
    if (disabled) return
    let clean: TenderWebsiteInput
    try {
      clean = normalizeTenderWebsiteInput({ name, url, dscEmployeeId: dscEmployeeId || null })
      assertUniqueTenderWebsiteName(existing, clean.name, editing?.id)
      if (dscEmployeeId && dscEmployeeId !== editing?.dscEmployeeId && !employees.some(person => person.id === dscEmployeeId)) {
        throw new Error('Select an active employee at L0, L1, or L2 for DSC.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the form.'); return }

    if (!locked && (userId || password) && !unlockKey) {
      setError(null); setLockError(null); setDialog('setup'); return
    }
    setWorking(true)
    setError(null)
    try {
      clean.credentials = locked ? editing?.credentials ?? null
        : userId || password ? await lockCredentials({ userId, password }, unlockKey) : null
      await onSubmit(clean)
      setKey(''); setUserId(''); setPassword(''); setShowPassword(false)
      setDialog(null); setPassphrase(''); setConfirmation('')
      if (!editing) { setName(''); setUrl(''); setDscEmployeeId(''); setLocked(false) }
      else setLocked(!!clean.credentials)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save the website.'
      if (dialog === 'setup') setLockError(message)
      else setError(message)
    } finally { setWorking(false) }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void save() }
  const confirmLock = async () => {
    setLockError(null)
    if (dialog === 'setup') {
      if (passphrase.length < 8) { setLockError('Use at least 8 characters for the credential passphrase.'); return }
      if (passphrase !== confirmation) { setLockError('The passphrases do not match.'); return }
      await save(passphrase)
      return
    }
    if (!editing?.credentials) return
    setWorking(true)
    try {
      const credentials = await unlockCredentials(editing.credentials, passphrase)
      setUserId(credentials.userId); setPassword(credentials.password); setKey(passphrase)
      setLocked(false); setDialog(null); setPassphrase('')
    } catch (cause) { setLockError(cause instanceof Error ? cause.message : 'Could not unlock credentials.') }
    finally { setWorking(false) }
  }

  const openUnlock = () => { setLockError(null); setDialog('unlock') }
  const relock = () => { setLocked(true); setUserId(''); setPassword(''); setKey(''); setShowPassword(false) }
  const unavailableDsc = !!dscEmployeeId && !employees.some(person => person.id === dscEmployeeId)

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label={editing ? `Edit ${editing.name}` : 'Add tender website'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${prefix}-name`} className="mb-1 block text-[13px] font-medium">Name</label>
            <Input id={`${prefix}-name`} aria-label="Website name" placeholder="Name, e.g. E-Proc" value={name} maxLength={100}
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
              {locked && <Button variant="secondary" size="icon" aria-label="Unlock User ID" disabled={disabled} onClick={openUnlock}><Icon name="Lock" size={14} /></Button>}
            </div>
          </div>
          <div>
            <label htmlFor={`${prefix}-password`} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium"><Icon name="Lock" size={12} /> Password</label>
            <div className="flex gap-1">
              <Input id={`${prefix}-password`} aria-label="Password" autoComplete="new-password" type={showPassword && !locked ? 'text' : 'password'}
                value={locked ? '••••••••' : password} maxLength={2000} readOnly={locked} disabled={disabled} placeholder="Portal password" onChange={event => setPassword(event.target.value)} />
              <Button variant="secondary" size="icon" disabled={disabled} aria-label={locked ? 'Unlock Password' : showPassword ? 'Hide Password' : 'Show Password'}
                onClick={locked ? openUnlock : () => setShowPassword(!showPassword)}><Icon name={locked ? 'Lock' : showPassword ? 'EyeOff' : 'Eye'} size={14} /></Button>
            </div>
          </div>
          <div>
            <label htmlFor={`${prefix}-dsc`} className="mb-1 block text-[13px] font-medium">DSC</label>
            <Select id={`${prefix}-dsc`} aria-label="DSC employee" value={dscEmployeeId} disabled={disabled || isLoading || isError} onChange={event => setDscEmployeeId(event.target.value)}>
              <option value="">{isLoading ? 'Loading employees...' : 'Select employee (L0 / L1 / L2)'}</option>
              {[0, 1, 2].map(level => <optgroup key={level} label={`L${level}`}>
                {employees.filter(person => person.level === level).map(person => <option key={person.id} value={person.id}>{person.name} (L{person.level})</option>)}
              </optgroup>)}
              {unavailableDsc && <option value={dscEmployeeId}>Previously assigned employee (unavailable)</option>}
            </Select>
            {isError && <p role="alert" className="mt-1 text-xs text-crimson">Could not load employees. <button type="button" className="underline" onClick={() => void refetch()}>Retry</button></p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{locked ? 'Credentials locked. Unlock to view or change.' : 'Credentials are encrypted and locked when saved.'}</p>
          <div className="flex items-center gap-2">
            {editing?.credentials && !locked && <Button size="sm" variant="ghost" disabled={disabled} onClick={relock}><Icon name="Lock" size={13} /> Lock credentials</Button>}
            <Button type="submit" size="sm" variant={editing ? 'primary' : 'secondary'} disabled={disabled}>
              <Icon name={editing ? 'Check' : 'Plus'} size={14} /> {working ? 'Saving...' : submitLabel}
            </Button>
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>Cancel</Button>}
          </div>
        </div>
        {error && <p id={errorId} role="alert" className="text-[12px] text-crimson">{error}</p>}
      </form>
      <Dialog open={dialog !== null} onClose={closeLock} title={dialog === 'setup' ? 'Set credential lock' : 'Unlock credentials'}
        description={dialog === 'setup' ? 'Choose a passphrase for this portal. Keep it safe: it is needed to unlock the saved User ID and Password.' : 'Enter this portal’s credential passphrase to view or edit its User ID and Password.'}>
        <div className="space-y-3">
          <label className="block text-[13px] font-medium">Credential passphrase
            <Input autoFocus aria-label="Credential passphrase" type="password" autoComplete={dialog === 'setup' ? 'new-password' : 'current-password'}
              value={passphrase} disabled={working} onChange={event => setPassphrase(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void confirmLock() } }} />
          </label>
          {dialog === 'setup' && <label className="block text-[13px] font-medium">Confirm passphrase
            <Input aria-label="Confirm passphrase" type="password" autoComplete="new-password" value={confirmation} disabled={working}
              onChange={event => setConfirmation(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void confirmLock() } }} />
          </label>}
          {lockError && <p role="alert" className="text-[12px] text-crimson">{lockError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeLock} disabled={working}>Cancel</Button>
            <Button onClick={() => void confirmLock()} disabled={working || !passphrase}>{working ? 'Please wait...' : dialog === 'setup' ? 'Lock and save' : 'Unlock'}</Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
