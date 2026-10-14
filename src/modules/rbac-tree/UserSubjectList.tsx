import { useMemo } from 'react'
import type { RbacSubjectRef, RbacSubjects } from '@goms/domain'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { matchesEmployee, normalizeEmailKey, type MasterEmployee } from '@/features/org/masterEmployees'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const NEEDS_EMAIL_HINT = 'Add an email in Teams → Employees to configure access'

export interface UserRow {
  /** Lower-cased email: the user subject id. Empty when the person has no email (shown disabled). */
  id: string
  name: string
  email: string
  detail: string
  departments: string[]
}

/** Every employee from the master list, plus anyone already configured (or typed) who is not an employee. */
export function buildUserRows(employees: readonly MasterEmployee[], configured: readonly string[]): UserRow[] {
  const fromEmployees: UserRow[] = employees.map((e) => ({
    id: normalizeEmailKey(e.email), name: e.name, email: e.email, departments: e.departments,
    detail: [e.designation, e.departments.join(', ')].filter(Boolean).join(' · '),
  }))
  const known = new Set(fromEmployees.map((r) => r.id).filter(Boolean))
  const others = [...new Set(configured.map(normalizeEmailKey))].filter((id) => id && !known.has(id)).sort()
    .map((id): UserRow => ({ id, name: id, email: id, detail: 'Not in the employee list', departments: [] }))
  return [...fromEmployees, ...others]
}

const rowMatches = (r: UserRow, q: string) =>
  matchesEmployee({ name: r.name, email: r.email, designation: r.detail, departments: r.departments } as MasterEmployee, q)

/** Users tab of Roles & Access: everyone, searchable by name / email / department; click to configure. */
export function UserSubjectList({ employees, subjects, extraUsers, query, selected, linkedName, onSelect, onConfigureTyped }: {
  employees: readonly MasterEmployee[]
  subjects: RbacSubjects | undefined
  extraUsers: readonly string[]
  query: string
  selected: RbacSubjectRef | null
  linkedName: (s: RbacSubjectRef) => string | undefined
  onSelect: (s: RbacSubjectRef) => void
  onConfigureTyped: (email: string) => void
}) {
  const rows = useMemo(() => buildUserRows(employees, [...(subjects?.users ?? []), ...extraUsers]), [employees, subjects?.users, extraUsers])
  const q = query.trim().toLowerCase()
  const shown = rows.filter((r) => rowMatches(r, q))
  const typed = EMAIL.test(q) && !rows.some((r) => r.id === q) ? q : null

  return (
    <ul aria-label="Users" className="max-h-60 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 scrollbar-thin lg:max-h-none">
      {typed && (
        <li>
          <button type="button" onClick={() => onConfigureTyped(typed)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-left text-[13px] text-goms-navy hover:bg-white focus-visible:focus-ring">
            <Icon name="UserPlus" size={15} /> Configure {typed}
          </button>
        </li>
      )}
      {shown.map((r) => {
        const subject: RbacSubjectRef = { type: 'user', id: r.id }
        const active = !!r.id && selected?.type === 'user' && selected.id === r.id
        const follows = r.id ? linkedName(subject) : undefined
        return (
          <li key={r.id || `noemail:${r.name}`}>
            <button
              type="button" disabled={!r.id} aria-current={active ? 'true' : undefined} onClick={() => onSelect(subject)}
              title={r.id ? r.email : NEEDS_EMAIL_HINT}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:focus-ring',
                active ? 'bg-goms-navy text-paper shadow-sm' : 'hover:bg-white', !r.id && 'cursor-not-allowed opacity-55 hover:bg-transparent')}
            >
              <Avatar person={{ name: r.name }} size="sm" className="shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{r.name}</span>
                <span className={cn('block truncate text-[11.5px]', active ? 'text-paper/70' : 'text-muted')}>
                  {r.id ? [r.email !== r.name ? r.email : '', r.detail, follows ? `follows ${follows}` : ''].filter(Boolean).join(' · ') : NEEDS_EMAIL_HINT}
                </span>
              </span>
            </button>
          </li>
        )
      })}
      {shown.length === 0 && !typed && (
        <li className="px-2 py-6 text-center text-[12.5px] text-muted">
          {rows.length ? 'Nobody matches. Type a full email to configure someone else.' : 'Type a full email to configure someone.'}
        </li>
      )}
    </ul>
  )
}
