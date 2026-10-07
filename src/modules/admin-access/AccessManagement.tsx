import { useState } from 'react'
import { FUNCTIONAL_ROLES, ROLE_LABELS, type Role } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Can } from '@/lib/permissions'
import { useAccessReadiness, useRoleOverrideMutations } from './api'

const WARNING_LABEL = { 'no-email': 'No email', 'no-role': 'No role', 'duplicate-email': 'Duplicate email', 'ambiguous-team-member': 'Ambiguous team member' } as const
const roles = (list: Role[]) => (list.length ? list.map((r) => ROLE_LABELS[r]).join(', ') : '—')

/** Role & Access Management (RBAC spec §3.3): who holds which role, what still needs fixing before RBAC is enforced,
 *  and the per-person overrides. System Admin accounts come from the protected admin allow-list, so they are shown as
 *  protected rows — they cannot be granted, changed or removed here. */
export function AccessManagement() {
  const { data: rows = [], isLoading } = useAccessReadiness()
  const { set, remove } = useRoleOverrideMutations()
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('cxo')
  const [effect, setEffect] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const shown = attentionOnly ? rows.filter((r) => r.warnings.length > 0) : rows

  async function save() {
    setError(null)
    try {
      await set.mutateAsync({ email: email.trim(), role, effect, reason: reason.trim() })
      setEmail('')
      setReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the override.')
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold text-ink-900">Role &amp; Access Management</h1>
        <p className="text-sm text-muted">Roles come from the org chart and the Sales roster; overrides add or remove one for a person. System Admins are managed outside this screen.</p>
      </header>

      <Can module="admin.access" action="create">
        <section aria-label="Add an override" className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-5">
          <label htmlFor="ov-email" className="flex flex-col gap-1 text-[12px] text-muted">Email
            <input id="ov-email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-sm text-ink-900" />
          </label>
          <label htmlFor="ov-role" className="flex flex-col gap-1 text-[12px] text-muted">Role
            <select id="ov-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 rounded-lg border border-line px-2 text-sm text-ink-900">
              {FUNCTIONAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
          <label htmlFor="ov-effect" className="flex flex-col gap-1 text-[12px] text-muted">Effect
            <select id="ov-effect" value={effect} onChange={(e) => setEffect(e.target.value as 'grant' | 'revoke')} className="h-9 rounded-lg border border-line px-2 text-sm text-ink-900">
              <option value="grant">Grant</option>
              <option value="revoke">Revoke</option>
            </select>
          </label>
          <label htmlFor="ov-reason" className="flex flex-col gap-1 text-[12px] text-muted">Reason
            <input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-sm text-ink-900" />
          </label>
          <div className="flex items-end">
            <Button variant="primary" disabled={!email.trim() || !reason.trim() || set.isPending} onClick={() => void save()}>Save override</Button>
          </div>
          {error && <p role="alert" className="text-[12px] text-rose-700 sm:col-span-5">{error}</p>}
        </section>
      </Can>

      <label className="flex items-center gap-2 text-sm text-ink-800">
        <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
        Needs attention
      </label>

      <div className="overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Derived</th>
              <th className="px-3 py-2">Overrides</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-3 py-3 text-muted" colSpan={6}>Loading…</td></tr>}
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-line/70 align-top">
                <td className="px-3 py-2 font-medium text-ink-900">{r.name}</td>
                <td className="px-3 py-2 text-muted"><span>{r.email || '—'}</span></td>
                <td className="px-3 py-2">{roles(r.derivedRoles)}</td>
                <td className="px-3 py-2">
                  {r.overrides.length === 0 ? '—' : r.overrides.map((o) => (
                    <span key={o.id} className="mr-1 inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[11px]" title={o.reason}>
                      {o.effect === 'grant' ? '+' : '−'} {ROLE_LABELS[o.role]}
                      {!r.systemAdmin && (
                        <Can module="admin.access" action="delete">
                          <button type="button" aria-label={`Remove ${ROLE_LABELS[o.role]} override`} className="text-muted hover:text-crimson" onClick={() => remove.mutate(o.id)}>×</button>
                        </Can>
                      )}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2">{roles(r.effectiveRoles)}</td>
                <td className="px-3 py-2">
                  {r.systemAdmin && <span className="mr-1 rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-medium text-white">System Admin (protected)</span>}
                  {r.warnings.map((w) => <span key={w} className="mr-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{WARNING_LABEL[w]}</span>)}
                  {r.lastSeenAt && <span className="text-[11px] text-muted">seen {new Date(r.lastSeenAt).toLocaleDateString()}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
