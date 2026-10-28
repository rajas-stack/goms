import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'

interface PinRecord { version: 1; salt: string; hash: string }
const keyFor = (name: string) => `goms:whatsapp:app-lock:${name}`
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

async function pinHash(pin: string, salt: string): Promise<string> {
  if (!crypto.subtle) throw new Error('App lock needs a secure browser connection (localhost or HTTPS).')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bytes = new Uint8Array(salt.match(/../g)!.map((pair) => parseInt(pair, 16)))
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytes, iterations: 120_000, hash: 'SHA-256' }, key, 256)))
}

function readPin(name: string): PinRecord | null {
  const raw = localStorage.getItem(keyFor(name))
  if (!raw) return null
  const value = JSON.parse(raw) as PinRecord
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error('The saved app lock is unreadable. Restore this browser’s app-lock settings before continuing.')
  return value
}

/** A local screen lock, independent of the linked phone. Unmount chats while locked, including their network subscriptions. */
export function WhatsAppAppLock({ name, children }: { name: string; children: (lock: () => void) => ReactNode }) {
  const [initial] = useState(() => { try { return { record: readPin(name), error: '' } } catch (error) { return { record: null, error: (error as Error).message } } })
  const [record, setRecord] = useState(initial.record)
  const [locked, setLocked] = useState(!!initial.record || !!initial.error)
  const [setup, setSetup] = useState(false)
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(initial.error)
  const [busy, setBusy] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [retryAt, setRetryAt] = useState(0)

  const lock = () => {
    setPin(''); setConfirm(''); setError('')
    if (record) setLocked(true)
    else setSetup(true)
  }
  const enable = async () => {
    if (!/^\d{6}$/.test(pin)) { setError('Choose a six-digit PIN.'); return }
    if (pin !== confirm) { setError('The PINs do not match.'); return }
    setBusy(true); setError('')
    try {
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
      const next: PinRecord = { version: 1, salt, hash: await pinHash(pin, salt) }
      localStorage.setItem(keyFor(name), JSON.stringify(next))
      setRecord(next); setLocked(true); setSetup(false); setPin(''); setConfirm('')
    } catch (failure) { setError(`Could not enable app lock: ${(failure as Error).message}`) }
    finally { setBusy(false) }
  }
  const unlock = async (remove = false) => {
    if (!record) return
    if (Date.now() < retryAt) { setError('Too many attempts. Wait a minute before trying again.'); return }
    setBusy(true); setError('')
    try {
      if (await pinHash(pin, record.salt) !== record.hash) {
        const nextAttempts = attempts + 1
        setAttempts(nextAttempts)
        if (nextAttempts % 5 === 0) { setRetryAt(Date.now() + 60_000); setError('Too many attempts. Wait a minute before trying again.') }
        else setError('Incorrect PIN. Try again.')
        return
      }
      if (remove) { localStorage.removeItem(keyFor(name)); setRecord(null) }
      setLocked(false); setPin(''); setAttempts(0); setRetryAt(0)
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  if (locked) return <section aria-label="WhatsApp locked" className="flex h-full items-center justify-center p-6">
    <form className="w-full max-w-sm space-y-4 text-center" onSubmit={(event) => { event.preventDefault(); void unlock() }}>
      <Icon name="Lock" size={36} className="mx-auto text-emerald-600" />
      <h1 className="text-xl font-semibold text-ink">WhatsApp is locked</h1>
      <p className="text-sm text-muted">Enter your PIN to show your chats. Your phone stays linked.</p>
      <label className="block space-y-1 text-left text-sm font-medium">App lock PIN<Input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || pin.length !== 6 || !record}>{busy ? 'Checking…' : 'Unlock WhatsApp'}</Button>
      <button type="button" className="text-xs text-muted underline underline-offset-4" disabled={busy || pin.length !== 6 || !record} onClick={() => void unlock(true)}>Unlock and turn off app lock</button>
    </form>
  </section>

  return <>
    {children(lock)}
    <Dialog open={setup} onClose={() => { if (!busy) { setSetup(false); setPin(''); setConfirm(''); setError('') } }} title="App lock"
      description="Hide WhatsApp in this browser with a six-digit PIN. This screen lock does not encrypt your messages or sign out your phone."
      footer={<><Button disabled={busy} onClick={() => { setSetup(false); setPin(''); setConfirm(''); setError('') }}>Cancel</Button><Button variant="primary" disabled={busy || pin.length !== 6 || confirm.length !== 6} onClick={() => void enable()}>{busy ? 'Saving…' : 'Save and lock'}</Button></>}>
      <div className="space-y-4">
        <label className="block space-y-1 text-sm font-medium">New PIN<Input autoFocus type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
        <label className="block space-y-1 text-sm font-medium">Confirm PIN<Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))} /></label>
        {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
      </div>
    </Dialog>
  </>
}
