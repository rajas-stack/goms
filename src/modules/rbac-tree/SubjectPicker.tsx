import { useState } from 'react'
import { FUNCTIONAL_ROLES, ROLE_LABELS, type RbacSubjectRef, type RbacSubjects } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'
import { cn } from '@/lib/utils'
import type { MasterEmployee } from '@/features/org/masterEmployees'
import { UserSubjectList } from './UserSubjectList'

export type PickerTab = 'role' | 'user' | 'template'
const TAB_LABEL: Record<PickerTab, string> = { role: 'Roles', user: 'Users', template: 'Templates' }

interface Item { subject: RbacSubjectRef; title: string; hint: string; icon: string }

const linkedNameIn = (subjects: RbacSubjects | undefined) => (s: RbacSubjectRef) => {
  const id = subjects?.links[`${s.type}:${s.id}`]
  return id ? subjects?.templates.find((t) => t.id === id)?.name : undefined
}

function itemsFor(tab: Exclude<PickerTab, 'user'>, subjects: RbacSubjects | undefined): Item[] {
  const linkedName = linkedNameIn(subjects)
  if (tab === 'role') {
    const hint = (base: string, s: RbacSubjectRef) => [base, linkedName(s) && `follows ${linkedName(s)}`].filter(Boolean).join(' · ')
    const functional: Item[] = FUNCTIONAL_ROLES.map((id) => {
      const subject: RbacSubjectRef = { type: 'role', id }
      return { subject, title: ROLE_LABELS[id], icon: 'Briefcase', hint: hint('Functional role', subject) }
    })
    const custom: Item[] = (subjects?.customRoles ?? []).map((r) => {
      const subject: RbacSubjectRef = { type: 'role', id: r.id }
      return { subject, title: r.label, icon: 'UserPlus', hint: hint(`Custom · ${r.members.length} member${r.members.length === 1 ? '' : 's'}`, subject) }
    })
    return [...functional, ...custom]
  }
  return (subjects?.templates ?? []).map((t) => ({
    subject: { type: 'template', id: t.id }, title: t.name, icon: 'Copy',
    hint: `${t.grantCount} setting${t.grantCount === 1 ? '' : 's'} · used by ${t.links.length}`,
  }))
}

/** Left column: who is being configured. */
export function SubjectPicker({ subjects, employees = [], selected, canEdit, onSelect, onNewRole, onNewTemplate }: {
  subjects: RbacSubjects | undefined
  /** The master employee list (Teams > Employees) shown on the Users tab. */
  employees?: readonly MasterEmployee[]
  selected: RbacSubjectRef | null
  canEdit: boolean
  onSelect: (s: RbacSubjectRef) => void
  onNewRole: () => void
  onNewTemplate: () => void
}) {
  const [tab, setTab] = useState<PickerTab>(selected?.type ?? 'role')
  const [query, setQuery] = useState('')
  const [extraUsers, setExtraUsers] = useState<string[]>([])
  const q = query.trim().toLowerCase()
  const items = tab === 'user' ? [] : itemsFor(tab, subjects).filter((i) => !q || i.title.toLowerCase().includes(q) || i.subject.id.toLowerCase().includes(q))
  const configureTyped = (email: string) => { setExtraUsers((u) => [...u, email]); onSelect({ type: 'user', id: email }); setQuery('') }

  return (
    <aside aria-label="Who to configure" className="flex min-h-0 flex-col border-b border-line bg-panel/50 lg:w-[280px] lg:shrink-0 lg:border-b-0 lg:border-r">
      <div role="tablist" aria-label="Subject type" className="flex gap-1 p-2">
        {(Object.keys(TAB_LABEL) as PickerTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors focus-visible:focus-ring',
              tab === t ? 'bg-white text-ink-900 shadow-sm' : 'text-muted hover:text-ink')}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="px-2 pb-2">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label={`Search ${TAB_LABEL[tab].toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'user' ? 'Search name, email, department or type an email…' : `Search ${TAB_LABEL[tab].toLowerCase()}…`} className="h-9 pl-8" />
        </div>
      </div>
      {tab === 'user' ? (
        <UserSubjectList employees={employees} subjects={subjects} extraUsers={extraUsers} query={query} selected={selected}
          linkedName={linkedNameIn(subjects)} onSelect={onSelect} onConfigureTyped={configureTyped} />
      ) : (
      <ul className="max-h-60 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 scrollbar-thin lg:max-h-none">
        {items.map((item) => {
          const active = selected?.type === item.subject.type && selected.id === item.subject.id
          return (
            <li key={`${item.subject.type}:${item.subject.id}`}>
              <button type="button" aria-current={active ? 'true' : undefined} onClick={() => onSelect(item.subject)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:focus-ring',
                  active ? 'bg-goms-navy text-paper shadow-sm' : 'hover:bg-white')}>
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-white/15' : 'bg-ink-900/[0.05] text-ink-700')}>
                  <Icon name={item.icon} size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{item.title}</span>
                  <span className={cn('block truncate text-[11.5px]', active ? 'text-paper/70' : 'text-muted')}>{item.hint}</span>
                </span>
              </button>
            </li>
          )
        })}
        {items.length === 0 && (
          <li className="px-2 py-6 text-center text-[12.5px] text-muted">{tab === 'template' ? 'No templates yet.' : 'No roles match.'}</li>
        )}
      </ul>
      )}
      {canEdit && tab !== 'user' && (
        <div className="border-t border-line p-2">
          <Button variant="secondary" size="sm" className="w-full" onClick={tab === 'role' ? onNewRole : onNewTemplate}>
            <Icon name="Plus" size={14} /> {tab === 'role' ? 'New role' : 'New template'}
          </Button>
        </div>
      )}
    </aside>
  )
}
