import { useState } from 'react'
import type { TenderWebsite } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { unlockCredentials, type TenderCredentials } from './credentialLock'

/** The caller mounts a fresh viewer each time, so no unlocked state survives closing. */
export function TenderCredentialsDialog({ site, onClose }: { site: TenderWebsite; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [credentials, setCredentials] = useState<TenderCredentials | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const unlock = async () => {
    if (!site.credentials || working) return
    setWorking(true); setError('')
    try { setCredentials(await unlockCredentials(site.credentials, passphrase)); setPassphrase('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not unlock credentials.') }
    finally { setWorking(false) }
  }
  return <Dialog open onClose={onClose} title={`Credentials: ${site.name}`} description="The credential passphrase is required even when website editing is unlocked.">
    <div className="space-y-3">
      {credentials ? <>
        <label className="block text-[13px] font-medium">User ID<Input aria-label="User ID" value={credentials.userId} readOnly /></label>
        <label className="block text-[13px] font-medium">Password</label>
        <div className="flex gap-2">
          <Input aria-label="Password" value={credentials.password} type={showPassword ? 'text' : 'password'} readOnly />
          <Button size="icon" variant="secondary" aria-label={showPassword ? 'Hide Password' : 'Show Password'} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? 'EyeOff' : 'Eye'} size={14} /></Button>
        </div>
        <div className="flex justify-end"><LockSwitch unlocked onToggle={() => { setCredentials(null); setShowPassword(false) }} lockedLabel="Unlock credentials" unlockedLabel="Lock credentials" text="Lock credentials" className="lock-switch--wide" /></div>
      </> : <>
        <label className="block text-[13px] font-medium">Credential passphrase
          <Input autoFocus aria-label="Credential passphrase" type="password" autoComplete="current-password" value={passphrase} disabled={working}
            onChange={event => setPassphrase(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void unlock() } }} />
        </label>
        {error && <p role="alert" className="text-xs text-crimson">{error}</p>}
        <div className="flex justify-end"><LockSwitch unlocked={false} disabled={working || !passphrase} onToggle={() => void unlock()} lockedLabel="Unlock credentials"
          unlockedLabel="Lock credentials" text={working ? 'Unlocking...' : 'Unlock credentials'} className="lock-switch--wide" /></div>
      </>}
    </div>
  </Dialog>
}
