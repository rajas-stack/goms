import { cn } from '@/lib/utils'
import { usePermissionMatrix } from './api'
import { errorMessage } from './format'
import { grantChips, levelText } from './grantText'

const LEVEL_TONE = { N: 'text-muted', R: 'text-ink-700', P: 'text-amber-800', W: 'font-medium text-emerald-800' } as const

/** The role x module permission matrix, read-only. Everything shown is what the server sent (`access.permissionMatrix`, derived
 *  from the policy it enforces plus its System Admin only rule list): this screen never works a permission out itself. */
export function PermissionMatrix() {
  const { data, isLoading, error } = usePermissionMatrix()

  if (isLoading) return <p className="text-sm text-muted">Loading permission matrix…</p>
  if (error) return <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{errorMessage(error, 'Could not load the permission matrix.')}</p>
  if (!data || data.modules.length === 0) return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No permission data to show.</p>

  const roles = data.roles.filter((r) => !r.unrestricted) // System Admin is unrestricted: it has no cells to show, only the note below
  const groups = [...new Set(data.modules.map((m) => m.group))]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        What each role may do in each module, as the server enforces it. Edit levels may be limited to a role&apos;s own or assigned rows, or to named field sets (listed below).
        System Admin is unrestricted: it can read, edit, create and delete everything, and it comes only from the protected admin allow-list, never from a role or an override.
      </p>

      <div className="overflow-auto rounded-xl border border-line">
        <table aria-label="Permission matrix" className="w-full min-w-[980px] text-left text-[12px]">
          <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Module</th>
              {roles.map((r) => <th key={r.key} scope="col" className="px-2 py-2">{r.label}</th>)}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group}>
              <tr><td colSpan={roles.length + 1} className="bg-panel/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">{group}</td></tr>
              {data.modules.filter((m) => m.group === group).map((m) => {
                const restricted = data.restrictions.some((x) => x.module === m.key)
                return (
                  <tr key={m.key} className="border-t border-line/70 align-top">
                    <th scope="row" className="px-3 py-1.5 text-left font-medium text-ink-900">
                      <span>{m.label}</span>
                      {restricted && <span className="block text-[10px] font-normal text-amber-800">Some actions System Admin only</span>}
                    </th>
                    {roles.map((r) => {
                      const g = data.grants[m.key][r.key]
                      return (
                        <td key={r.key} className="px-2 py-1.5">
                          <span className={cn(LEVEL_TONE[g.level])}>{levelText(g.level, g.scope, g.sets)}</span>
                          {grantChips(g).length > 0 && (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {grantChips(g).map((chip) => <span key={chip} className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-ink-700">{chip}</span>)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      </div>

      <section aria-label="System Admin only" className="rounded-xl border border-line p-3">
        <h2 className="text-sm font-semibold text-ink-900">System Admin only</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          These actions stay with System Admins even where a role holds the module permission above. The server enforces them in every RBAC mode.
        </p>
        {data.restrictions.length === 0 ? <p className="mt-2 text-[12px] text-muted">No restrictions are listed.</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {data.restrictions.map((r) => (
              <li key={r.id} className="text-[12px]">
                <code className="rounded bg-panel px-1 py-0.5 text-[11px] text-ink-900">{r.target}</code>
                <span className="ml-2 text-muted">{r.actions.join(' / ')}</span>
                <p className="mt-0.5 text-ink-700">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {Object.keys(data.fieldSets).length > 0 && (
        <section aria-label="Field sets" className="rounded-xl border border-line p-3">
          <h2 className="text-sm font-semibold text-ink-900">Field sets</h2>
          <p className="mt-0.5 text-[12px] text-muted">The fields behind the set names in &ldquo;Read + edit some fields&rdquo;.</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[4rem_1fr]">
            {Object.entries(data.fieldSets).map(([name, atoms]) => (
              <div key={name} className="contents">
                <dt className="font-medium text-ink-900">{name}</dt>
                <dd className="text-ink-700">{atoms.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
