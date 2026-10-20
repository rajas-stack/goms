import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EmailEntityRef, EmailMailbox } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { emailApi, emailQueryDefaults } from './api'

export function EmailAccessDialog({ email, administrator, mailboxes, entity, onClose }: { email: string; administrator: boolean; mailboxes: EmailMailbox[]; entity?: EmailEntityRef; onClose: () => void }) {
  const query = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'grants'], queryFn: () => emailApi(email).grants.query() })
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? ''); const [grantee, setGrantee] = useState(''); const [kind, setKind] = useState<'hod' | 'superadmin'>('hod')
  const [expires, setExpires] = useState(''); const [scoped, setScoped] = useState(!!entity); const [unlinked, setUnlinked] = useState(false); const [download, setDownload] = useState(false); const [consent, setConsent] = useState(false)
  const [approving, setApproving] = useState<string | null>(null); const [reference, setReference] = useState(''); const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await query.refetch() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change mailbox access.') } finally { setBusy(false) } }
  return <Dialog open onClose={() => { if (!busy) onClose() }} title="Mailbox oversight access" description="Normal correspondence visibility follows actual email delivery. Supervisory access additionally requires mailbox-owner consent and explicit organizational approval." size="xl">
    <div className="space-y-5">
      <form className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void run(async () => { await emailApi(email).requestGrant.mutate({ mailboxId, grantee, kind, entity: scoped && entity ? entity : null, includeUnlinked: unlinked, allowDownload: download, expiresAt: new Date(expires).toISOString(), ownerConsent: true }); setConsent(false); setGrantee('') }) }}>
        <Field label="My mailbox"><Select required value={mailboxId} onChange={event => setMailboxId(event.target.value)}>{mailboxes.map(mailbox => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}</Select></Field>
        <Field label="Supervisor’s company email" required><Input type="email" required value={grantee} onChange={event => setGrantee(event.target.value)} /></Field>
        <Field label="Scope type"><Select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="hod">HOD in my current reporting line</option><option value="superadmin">Explicitly authorized Superadmin</option></Select></Field>
        <Field label="Expires" required><Input type="datetime-local" required value={expires} onChange={event => setExpires(event.target.value)} /></Field>
        {entity && <label className="flex gap-2 text-sm"><input type="checkbox" checked={scoped} onChange={event => setScoped(event.target.checked)} />Limit to this {entity.type}</label>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={unlinked} onChange={event => setUnlinked(event.target.checked)} />Include unlinked mailbox correspondence</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={download} onChange={event => setDownload(event.target.checked)} />Permit attachment download</label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1" />I own this mailbox and explicitly consent to this scope being submitted for organizational approval.</label>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy || !consent || !mailboxId}>Submit access request</Button></div>
      </form>
      {(error || query.error) && <p role="alert" className="text-sm text-crimson">{error || query.error?.message}</p>}
      <div className="space-y-3">{query.data?.map(grant => <div key={grant.id} className="rounded-lg border border-line p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{grant.mailboxEmail} → {grant.grantee}</p><p className="text-xs text-muted">{grant.kind.toUpperCase()} · {grant.status} · {grant.scopeUnavailable ? 'Restricted business record' : grant.entity ? `${grant.entity.type}: ${grant.entity.id}` : 'Explicit mailbox scope'} · {grant.includeUnlinked ? 'Linked and unlinked' : 'Linked only'} ? {grant.allowDownload ? 'Downloads allowed' : 'No downloads'} · Expires {new Date(grant.expiresAt).toLocaleString()}</p>{grant.approvedBy && <p className="mt-1 text-xs text-muted">Approved by {grant.approvedBy} · {grant.approvalReference}</p>}</div><div className="flex gap-2">{administrator && grant.status === 'pending' && <Button size="sm" disabled={busy} onClick={() => { setApproving(grant.id); setReference(''); setAuthorized(false) }}>Review approval</Button>}{grant.status !== 'revoked' && (administrator || grant.ownerEmail === email) && <Button size="sm" disabled={busy} onClick={() => void run(() => emailApi(email).revokeGrant.mutate({ id: grant.id, confirmed: true }))}>Revoke</Button>}</div></div>
        {approving === grant.id && <form className="mt-3 space-y-3 border-t border-line pt-3" onSubmit={event => { event.preventDefault(); void run(async () => { await emailApi(email).approveGrant.mutate({ id: grant.id, approvalReference: reference, organizationAuthorized: true }); setApproving(null) }) }}><Field label="Organizational authorization reference" required><Input required minLength={8} maxLength={500} value={reference} onChange={event => setReference(event.target.value)} placeholder="Approval ticket / written authorization reference" /></Field><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />The organization explicitly authorized this recipient, mailbox, scope and expiry. Portal administration alone does not authorize Gmail access.</label><Button type="submit" disabled={busy || !authorized}>Approve exact scope</Button></form>}
      </div>)}</div>
      {query.data?.length === 0 && <p className="text-sm text-muted">No supervisory grants. Superadmin and HOD roles do not expose employee inboxes automatically.</p>}
    </div>
  </Dialog>
}
