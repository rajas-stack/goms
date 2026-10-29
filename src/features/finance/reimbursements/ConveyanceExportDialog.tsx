import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import logo from '@/assets/amnex-wordmark.png'
import { claimFileName, type Claim } from './model'
import { buildConveyanceWorkbook, pngBase64, type ClaimantDetails } from './conveyanceForm'
import { downloadBytes } from './exportFiles'

// shortcut: claimant details live in this browser's localStorage per email; read them from the employee master once it holds them.
const keyFor = (email: string) => `goms.finance.claimant.v1:${email.toLowerCase()}`
const load = (email: string): Partial<ClaimantDetails> => { try { return JSON.parse(localStorage.getItem(keyFor(email)) ?? '{}') } catch { return {} } }

/** Asks for (and remembers) the form's header details, then downloads the month's Local Conveyance Form. */
export function ConveyanceExportDialog({ open, claim, onClose }: { open: boolean; claim: Claim; onClose: () => void }) {
  const { user } = useAuthUser()
  const email = user?.email ?? 'local'
  const [d, setD] = useState<ClaimantDetails>({ employeeCode: '', employeeName: '', baseLocation: '', businessUnit: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const saved = load(email)
    setD({ employeeCode: saved.employeeCode ?? '', employeeName: saved.employeeName || user?.displayName || '', baseLocation: saved.baseLocation ?? '', businessUnit: saved.businessUnit ?? '' })
    setError('')
  }, [open, email, user?.displayName])

  async function exportForm() {
    const clean = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim().slice(0, 120)])) as unknown as ClaimantDetails
    if (!clean.employeeName) { setError('Enter the employee name.'); return }
    setBusy(true); setError('')
    try {
      try { localStorage.setItem(keyFor(email), JSON.stringify(clean)) } catch { /* still export */ }
      const wb = await buildConveyanceWorkbook(claim, clean, await pngBase64(logo))
      const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
      downloadBytes(bytes, claimFileName(clean.employeeName, claim.month, 'Local Conveyance Form', 'xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not build the form.') } finally { setBusy(false) }
  }

  const field = (key: keyof ClaimantDetails, label: string, placeholder: string) => (
    <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-muted">{label}</span>
      <Input value={d[key]} placeholder={placeholder} className="h-9" onChange={(e) => setD((p) => ({ ...p, [key]: e.target.value }))} />
    </label>
  )
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Local Conveyance Form" description="Header details for the form. They are remembered for next month."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => void exportForm()} disabled={busy}>{busy ? 'Building…' : 'Download form'}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        {field('employeeCode', 'Employee code', '3096')}
        {field('employeeName', 'Employee name', 'Shubham Mehra')}
        {field('baseLocation', 'Base location', 'Mumbai')}
        {field('businessUnit', 'BU', 'Corporate')}
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-crimson">{error}</p>}
    </Dialog>
  )
}
