import { useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { FUNCTIONAL_ROLES, ROLE_LABELS, type Role } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Dialog } from '@/components/ui/Dialog'
import { useAllowed } from '@/lib/permissions'
import { isForbidden, useAccessReadiness, useRoleOverrideMutations, useUnmatchedOverrides } from './api'
import { EffectivePermissionsPanel } from './EffectivePermissionsPanel'
import { errorMessage, formatWhen, roleLabel } from './format'
import { OverrideHistory } from './OverrideHistory'
import { PermissionMatrix } from './PermissionMatrix'
import { RemoveOverrideDialog, type RemoveTarget } from './RemoveOverrideDialog'
import { useSystemAdminStatus } from './useIsSystemAdmin'

const WARNING_LABEL = { 'no-email': 'No email', 'no-role': 'No role', 'duplicate-email': 'Duplicate email', 'ambiguous-team-member': 'Ambiguous team member' } as const
const roles = (list: Role[]) => (list.length ? list.map((r) => ROLE_LABELS[r]).join(', ') : '—')
const effectWord = (effect: 'grant' | 'revoke') => (effect === 'grant' ? 'Grant' : 'Revoke')

/** Who set an override and when, for a chip's tooltip. Tolerates an older server that does not send them yet. */
const overrideTitle = (o: { reason: string; createdBy?: string; createdAt?: string }) =>
  o.createdBy && o.createdAt ? `${o.reason}. Set by ${o.createdBy} on ${formatWhen(o.createdAt)}` : o.reason

type Tab = 'people' | 'matrix'
const TABS: { value: Tab; label: string }[] = [{ value: 'people', label: 'People & overrides' }, { value: 'matrix', label: 'Permission matrix' }]

/** Role & Access Management (RBAC spec §3.3): who holds which role, what still needs fixing before RBAC is enforced,
 *  the per-person overrides and their history, and what each role / person can do (matrix and effective permissions, both
 *  computed by the server). System Admin accounts come from the protected admin allow-list, so they are shown as protected
 *  rows. Only a System Admin can change overrides: the controls are hidden from everyone else as a convenience, but the
 *  server refuses the call whatever this screen shows. */
export function AccessManagement() {
  const inRouter = useInRouterContext()
  const readiness = useAccessReadiness()
  const unmatched = useUnmatchedOverrides()
  const { set, remove } = useRoleOverrideMutations()
  const rows = readiness.data ?? []
  // UX only: the server re-checks the System Admin allow-list on every write. The matrix check mirrors the registry gate.
  const adminStatus = useSystemAdminStatus(readiness.isSuccess)
  const canManage = useAllowed('admin.access', 'update') && adminStatus === 'yes'

  const [tab, setTab] = useState<Tab>('people')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('cxo')
  const [effect, setEffect] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RemoveTarget | null>(null)
  const [permissionsOf, setPermissionsOf] = useState<{ email: string; name: string } | null>(null)
  const [historyOf, setHistoryOf] = useState<{ email: string; name: string } | null>(null)

  const shown = attentionOnly ? rows.filter((r) => r.warnings.length > 0) : rows

  async function save() {
    setError(null)
    try {
      await set.mutateAsync({ email: email.trim(), role, effect, reason: reason.trim() })
      setEmail('')
      setReason('')
    } catch (e) {
      setError(errorMessage(e, 'Could not save the override.'))
    }
  }

  const header = (
    <header>
      <h1 className="text-lg font-semibold text-ink-900">Role &amp; Access Management</h1>
      <p className="text-sm text-muted">Roles come from the org chart and the Sales roster; overrides add or remove one for a person. Only System Admins change overrides, and System Admins themselves are managed outside this screen.</p>
      {inRouter && <Link to="/admin/access/matrix" className="mt-1 inline-block text-sm text-ink-800 underline">Open the Access Matrix (field-level Denied / Read / Edit by team and level)</Link>}
    </header>
  )

  if (readiness.isError && isForbidden(readiness.error)) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-auto p-4 sm:p-6">
        {header}
        <div className="rounded-xl border border-line p-6 text-center">
          <h2 className="text-base font-semibold text-ink-900">Only System Admins can manage access</h2>
          <p className="mt-1 text-sm text-muted">Your account can&apos;t open this screen. Ask a System Admin if a role or override needs to change.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 sm:p-6">
      {header}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'matrix' ? <PermissionMatrix /> : (
        <>
          {canManage && (
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
          )}
          {adminStatus === 'no' && (
            <p className="rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-muted">Only System Admins can change overrides. You can see them, who set them and when, but not edit them.</p>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
            Needs attention
          </label>

          {readiness.isError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">Could not load the people list. {errorMessage(readiness.error, '')}</p>}

          <div className="overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Derived</th>
                  <th className="px-3 py-2">Overrides</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {readiness.isLoading && <tr><td className="px-3 py-3 text-muted" colSpan={7}>Loading…</td></tr>}
                {!readiness.isLoading && !readiness.isError && shown.length === 0 && (
                  <tr><td className="px-3 py-3 text-muted" colSpan={7}>{attentionOnly ? 'No one needs attention right now.' : 'No people to show.'}</td></tr>
                )}
                {shown.map((r) => (
                  <tr key={r.key} className="border-t border-line/70 align-top">
                    <td className="px-3 py-2 font-medium text-ink-900">{r.name}</td>
                    <td className="px-3 py-2 text-muted"><span>{r.email || '—'}</span></td>
                    <td className="px-3 py-2">{roles(r.derivedRoles)}</td>
                    <td className="px-3 py-2">
                      {r.overrides.length === 0 ? '—' : r.overrides.map((o) => (
                        <span key={o.id} className="mr-1 inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[11px]" title={overrideTitle(o)}>
                          {o.effect === 'grant' ? '+' : '−'} {ROLE_LABELS[o.role]}
                          {canManage && !r.systemAdmin && (
                            <button type="button" aria-label={`Remove ${ROLE_LABELS[o.role]} override for ${r.name || r.email}`} className="text-muted hover:text-crimson"
                              onClick={() => setRemoving({ id: o.id, email: r.email, role: o.role, effect: o.effect })}>×</button>
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
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.email && (
                        <>
                          <Button variant="ghost" size="sm" aria-label={`Effective permissions for ${r.name}`} onClick={() => setPermissionsOf({ email: r.email, name: r.name })}>Effective permissions</Button>
                          <Button variant="ghost" size="sm" aria-label={`History for ${r.name}`} onClick={() => setHistoryOf({ email: r.email, name: r.name })}>History</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section aria-label="Overrides not matched to a person" className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Overrides not matched to a person</h2>
              <p className="text-[12px] text-muted">These overrides name an email that is not on the org chart, the Sales roster, a signed-in account or the System Admin list, so they do not appear in the table above.</p>
            </div>
            {unmatched.isLoading ? <p className="text-sm text-muted">Loading…</p>
              : unmatched.isError ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{errorMessage(unmatched.error, 'Could not load the unmatched overrides.')}</p>
              : (unmatched.data ?? []).length === 0 ? <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">Every override belongs to a person.</p>
              : (
                <div className="overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[760px] text-left text-[13px]">
                    <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Effect</th>
                        <th className="px-3 py-2">Reason</th><th className="px-3 py-2">Set by</th><th className="px-3 py-2">Set at</th><th className="px-3 py-2"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(unmatched.data ?? []).map((o) => (
                        <tr key={o.id} className="border-t border-line/70 align-top">
                          <td className="px-3 py-2 font-medium text-ink-900">{o.email}</td>
                          <td className="px-3 py-2">{roleLabel(o.role)}</td>
                          <td className="px-3 py-2">{effectWord(o.effect)}</td>
                          <td className="px-3 py-2 text-muted">{o.reason}</td>
                          <td className="px-3 py-2">{o.createdBy}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatWhen(o.createdAt)}</td>
                          <td className="px-3 py-2 text-right">
                            {canManage && (
                              <button type="button" aria-label={`Remove ${roleLabel(o.role)} override for ${o.email}`} className="text-muted hover:text-crimson"
                                onClick={() => setRemoving({ id: o.id, email: o.email, role: o.role, effect: o.effect })}>×</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          <section aria-label="Override history" className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Override history</h2>
              <p className="text-[12px] text-muted">Every override created, changed or removed, newest first. Removed overrides stay here.</p>
            </div>
            <OverrideHistory />
          </section>
        </>
      )}

      <RemoveOverrideDialog target={removing} onClose={() => setRemoving(null)} onConfirm={(id) => remove.mutateAsync(id)} />
      <EffectivePermissionsPanel email={permissionsOf?.email ?? null} name={permissionsOf?.name} onClose={() => setPermissionsOf(null)} />
      <Dialog open={!!historyOf} onClose={() => setHistoryOf(null)} title="Override history" size="xl" footer={<Button onClick={() => setHistoryOf(null)}>Close</Button>}>
        {historyOf && (
          <div className="flex flex-col gap-3">
            <p className="text-sm"><span className="font-medium text-ink-900">{historyOf.name}</span><span className="ml-2 text-muted">{historyOf.email}</span></p>
            <OverrideHistory email={historyOf.email} />
          </div>
        )}
      </Dialog>
    </div>
  )
}
