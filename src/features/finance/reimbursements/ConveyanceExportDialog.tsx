import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { AddableSelect } from '@/components/ui/AddableSelect'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'
import logo from '@/assets/amnex-wordmark.png'
import { claimFileName, type Claim } from './model'
import { buildConveyanceWorkbook, claimProjects, pngBase64, type ClaimantDetails } from './conveyanceForm'
import { claimantFromProfile, isClaimantComplete } from './claimantProfile'
import { downloadBytes } from './exportFiles'

// shortcut: claimant details for people with no Directory profile live in this browser's localStorage per email.
const keyFor = (email: string) => `goms.finance.claimant.v1:${email.toLowerCase()}`
const load = (email: string): Partial<ClaimantDetails> => { try { return JSON.parse(localStorage.getItem(keyFor(email)) ?? '{}') } catch { return {} } }

/** The signed-in user's conveyance header from their Directory profile, or null when they have none. */
export function useProfileClaimant(): ClaimantDetails | null {
  const { user } = useAuthUser()
  const { data: people = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const email = user?.email?.toLowerCase()
  const person = email ? people.find((p) => p.officialEmail.toLowerCase() === email) : undefined
  return person ? claimantFromProfile(person, postings[person.id]?.office) : null
}

/** Builds and downloads the month's Local Conveyance Form. */
export async function downloadConveyance(claim: Claim, who: ClaimantDetails) {
  const wb = await buildConveyanceWorkbook(claim, who, await pngBase64(logo))
  downloadBytes(new Uint8Array(await wb.xlsx.writeBuffer()), claimFileName(who.employeeName, claim.month, 'Local Conveyance Form', 'xlsx'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

/** Asks for the header details the Directory profile is missing, then downloads the form. */
export function ConveyanceExportDialog({ open, claim, projects, onClose }: { open: boolean; claim: Claim; projects: string[]; onClose: () => void }) {
  const { user } = useAuthUser()
  const profile = useProfileClaimant()
  const email = user?.email ?? 'local'
  const [d, setD] = useState<Required<ClaimantDetails>>({ employeeCode: '', employeeName: '', baseLocation: '', businessUnit: '', project: '' })
  const monthProjects = claimProjects(claim)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const saved = load(email), p = profile
    setD({
      employeeCode: p?.employeeCode || saved.employeeCode || '', employeeName: p?.employeeName || saved.employeeName || user?.displayName || '',
      baseLocation: p?.baseLocation || saved.baseLocation || '', businessUnit: p?.businessUnit || saved.businessUnit || '',
      project: monthProjects || p?.project || saved.project || '',
    })
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill once per opening
  }, [open, email, monthProjects])

  async function exportForm() {
    const clean = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim().slice(0, k === 'project' ? 300 : 120)])) as unknown as ClaimantDetails
    if (!clean.employeeName) { setError('Enter the employee name.'); return }
    setBusy(true); setError('')
    try {
      try { localStorage.setItem(keyFor(email), JSON.stringify(clean)) } catch { /* still export */ }
      await downloadConveyance(claim, clean)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not build the form.') } finally { setBusy(false) }
  }

  const field = (key: Exclude<keyof ClaimantDetails, 'project'>, label: string, placeholder: string) => (
    <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-muted">{label}</span>
      <Input value={d[key]} placeholder={placeholder} className="h-9" onChange={(e) => setD((p) => ({ ...p, [key]: e.target.value }))} />
    </label>
  )
  const hint = profile && !isClaimantComplete(profile)
    ? 'Your Directory profile is missing some of these. Fill them there to skip this step next time.'
    : 'Add these to your Directory profile to skip this step next time.'
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Local Conveyance Form" description={hint}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => void exportForm()} disabled={busy}>{busy ? 'Building…' : 'Download form'}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        {field('employeeCode', 'Employee code', '3096')}
        {field('employeeName', 'Employee name', 'Shubham Mehra')}
        {field('baseLocation', 'Base location', 'Mumbai')}
        {field('businessUnit', 'BU', 'Corporate')}
        <label className="col-span-2 block"><span className="mb-0.5 block text-[11px] font-medium text-muted">Network / WBS / Project</span>
          <AddableSelect value={d.project} onChange={(project) => setD((p) => ({ ...p, project }))} options={projects} storageKey="finance.reimbursement.projects" placeholder="Select project" className="[&_select]:h-9" />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-crimson">{error}</p>}
    </Dialog>
  )
}
