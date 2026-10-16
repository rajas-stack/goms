import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { cn } from '@/lib/utils'
import { ORG_LEVELS, eligibleManagers, levelLabel, type OrgPerson } from '@/data/org-structure'
import { DepartmentMultiSelect } from '@/features/departments/DepartmentMultiSelect'
import { SourceBadges } from './SourceBadges'
import type { EmployeeSource } from './masterEmployees'

export const toManagerOption = (p: OrgPerson): ComboboxOption => ({
  value: p.id, label: `${p.name} · ${levelLabel(p.level)}`, searchText: `${p.designation} ${p.departments.join(' ')}`, person: p,
})

export interface OrgRowActions {
  changeEmail: (person: OrgPerson, raw: string) => void
  changeLevel: (person: OrgPerson, level: number) => void
  changeManager: (person: OrgPerson, managerId: string) => void
  changeDesignation: (person: OrgPerson, designation: string) => void
  changeDepartments: (person: OrgPerson, departments: string[]) => void
  createDepartment?: (name: string) => Promise<string>
  toggleStatus: (person: OrgPerson) => void
  remove: (person: OrgPerson) => void
  edit: (person: OrgPerson) => void
}

const CELL = 'border-b border-line/70 px-3 py-1.5'

/** One Teams > Employees row for a person in the company org (org_people). */
export function OrgEmployeeRow({ person: p, people, sources, departmentOptions, emailEditable, emailResetKey, canEdit, actions }: {
  person: OrgPerson
  people: readonly OrgPerson[]
  /** Other rosters this person also appears in (badges). */
  sources: readonly EmployeeSource[]
  departmentOptions: readonly string[]
  emailEditable: boolean
  emailResetKey: number
  canEdit: boolean
  actions: OrgRowActions
}) {
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur() }
  return (
    <tr className={cn('hover:bg-grid-hover', p.status === 'inactive' && 'opacity-60')}>
      <td className={CELL}>
        <div className="flex items-center gap-2">
          <PersonName person={p} size="sm" nameClassName="font-medium text-ink-900" />
          <SourceBadges sources={sources.filter((s) => s !== 'org')} />
        </div>
      </td>
      <td className={CELL}>
        {emailEditable ? (
          <Input
            key={`${p.id}:${p.email}:${emailResetKey}`} type="email"
            aria-label={`${p.name} email`} defaultValue={p.email} placeholder="—" className="h-8"
            onBlur={(e) => actions.changeEmail(p, e.target.value)} onKeyDown={blurOnEnter}
          />
        ) : <span className="text-muted">{p.email || '—'}</span>}
      </td>
      <td className={CELL}>
        <select
          aria-label={`${p.name} level`} value={String(p.level)} disabled={!canEdit}
          onChange={(e) => actions.changeLevel(p, Number(e.target.value))}
          className="h-7 w-[3.75rem] cursor-pointer rounded-md border border-line bg-white px-1.5 text-[12px] font-medium text-ink-800 focus-visible:focus-ring disabled:cursor-not-allowed"
        >
          {ORG_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
        </select>
      </td>
      <td className={CELL}>
        <Input
          key={`${p.id}:${p.designation}`} aria-label={`${p.name} designation`} defaultValue={p.designation} className="h-8"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== p.designation) actions.changeDesignation(p, v) }}
          onKeyDown={blurOnEnter}
        />
      </td>
      <td className={CELL}>
        <Combobox
          aria-label={`${p.name} reports to`} value={p.managerId ?? ''} onChange={(v) => actions.changeManager(p, v)}
          options={eligibleManagers(p, [...people]).map(toManagerOption)} placeholder={p.level === 0 ? 'Top of the company' : 'No manager'}
        />
      </td>
      <td className={CELL}>
        <DepartmentMultiSelect
          aria-label={`${p.name} departments`} value={p.departments} options={departmentOptions} disabled={!canEdit}
          onChange={(next) => actions.changeDepartments(p, next)} onCreate={actions.createDepartment}
        />
      </td>
      <td className={cn(CELL, 'text-right')}>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" disabled={!canEdit} aria-label={`Edit ${p.name}`} title="Edit all details" onClick={() => actions.edit(p)}>
            <Icon name="Pencil" size={14} />
          </Button>
          <Button variant="secondary" size="sm" disabled={!canEdit} onClick={() => actions.toggleStatus(p)}>
            {p.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="ghost" size="icon" disabled={!canEdit} aria-label={`Delete ${p.name}`} title="Delete (their reports move up to their manager)"
            onClick={() => actions.remove(p)}
          >
            <Icon name="Trash2" size={14} />
          </Button>
        </div>
      </td>
    </tr>
  )
}
