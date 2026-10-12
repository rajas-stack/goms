import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import type { EffectivePermissions } from '@/data/accessTypes'
import { cn } from '@/lib/utils'
import { useEffectivePermissions } from './api'
import { errorMessage, roleLabel } from './format'
import { grantChips, levelText } from './grantText'

type ModulePermissions = EffectivePermissions['modules'][number]

const LEVEL_TONE = { N: 'text-muted', R: 'text-ink-700', P: 'text-amber-800', W: 'font-medium text-emerald-800' } as const

function ModuleRow({ m }: { m: ModulePermissions }) {
  // `level`, `create` and `delete` are the server's evaluator answer without a row; grants limited to own / assigned rows are
  // listed in `scoped` because they need a row to apply. Nothing is worked out here.
  const chips = grantChips(m)
  return (
    <tr className="border-t border-line/70 align-top">
      <th scope="row" className="px-3 py-1.5 text-left font-medium text-ink-900">{m.label}</th>
      <td className="px-3 py-1.5">
        <span className={cn(LEVEL_TONE[m.level])}>{levelText(m.level, 'all', m.sets)}</span>
        {chips.map((chip) => <span key={chip} className="ml-1 rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-ink-700">{chip}</span>)}
        {m.restrictedTo && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{`${m.restrictedTo} only`}</span>}
        {m.scoped.map((s) => (
          <p key={`${s.role}:${s.scope}`} className="mt-0.5 text-[11px] text-ink-700">
            {`As ${roleLabel(s.role)}: ${[levelText(s.level, s.scope, s.sets), ...grantChips(s)].join(' · ')}`}
          </p>
        ))}
        {m.restrictions.map((r) => <p key={r.id} className="mt-0.5 text-[11px] text-muted">{r.reason}</p>)}
      </td>
    </tr>
  )
}

function Body({ data }: { data: EffectivePermissions }) {
  const groups = [...new Set(data.modules.map((m) => m.group))]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div aria-label="Roles" className="flex flex-wrap gap-1">
          {data.roles.length === 0
            ? <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">No role</span>
            : data.roles.map((r) => <span key={r} className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-800">{roleLabel(r)}</span>)}
        </div>
        {data.systemAdmin && <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-medium text-white">System Admin (unrestricted)</span>}
      </div>
      {data.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted">
          {data.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-line">
        <table aria-label="Permissions by module" className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted">
            <tr><th scope="col" className="px-3 py-2">Module</th><th scope="col" className="px-3 py-2">What they can do</th></tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group}>
              <tr><td colSpan={2} className="bg-panel/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">{group}</td></tr>
              {data.modules.filter((m) => m.group === group).map((m) => <ModuleRow key={m.module} m={m} />)}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

/** What one person can do in each module, exactly as the server computes it (`access.effectivePermissions`: their roles from
 *  the org chart, roster and overrides, run through the same evaluator that gates every call). Read-only. Open while `email` is set. */
export function EffectivePermissionsPanel({ email, name, onClose }: { email: string | null; name?: string; onClose: () => void }) {
  const { data, isLoading, error } = useEffectivePermissions(email)
  return (
    <Dialog open={!!email} onClose={onClose} title="Effective permissions" size="xl" footer={<Button onClick={onClose}>Close</Button>}>
      {email && (
        <div className="flex flex-col gap-3">
          <p className="text-sm"><span className="font-medium text-ink-900">{name ?? email}</span>{name && <span className="ml-2 text-muted">{email}</span>}</p>
          {isLoading && <p className="text-sm text-muted">Loading permissions…</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{errorMessage(error, 'Could not load this person\'s permissions.')}</p>}
          {data && <Body data={data} />}
        </div>
      )}
    </Dialog>
  )
}
