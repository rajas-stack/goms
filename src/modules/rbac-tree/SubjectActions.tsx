import { useMemo, useState } from 'react'
import { ROLE_LABELS, type RbacSubjectRef, type RbacSubjects } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { errorText, useRbacMutations } from './api'
import { NameDialog, RoleDialog } from './dialogs'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { useAmnexDepartments } from '@/features/departments/api'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'

export function subjectTitle(subject: RbacSubjectRef, subjects: RbacSubjects | undefined): string {
  if (subject.type === 'user') return subject.id
  if (subject.type === 'template') return subjects?.templates.find((t) => t.id === subject.id)?.name ?? 'Template'
  return (ROLE_LABELS as Record<string, string>)[subject.id] ?? subjects?.customRoles.find((r) => r.id === subject.id)?.label ?? subject.id
}

type Open = null | 'saveAs' | 'rename' | 'apply' | 'role' | 'delete'

/** The header actions for the selected subject: templates (save as / apply / rename / duplicate / delete), custom roles
 *  (edit / delete) and the linked-template chip. */
export function SubjectActions({ subject, subjects, canEdit, dirty, onSelect }: {
  subject: RbacSubjectRef; subjects: RbacSubjects | undefined; canEdit: boolean; dirty: boolean; onSelect: (s: RbacSubjectRef | null) => void
}) {
  const m = useRbacMutations()
  const toast = useToast()
  const [open, setOpen] = useState<Open>(null)
  const { employees } = useMasterEmployees()
  const masterDepartments = useAmnexDepartments().data
  const departments = useMemo(() => masterDepartments?.map((d) => d.name) ?? [], [masterDepartments])
  const close = () => setOpen(null)
  const template = subject.type === 'template' ? subjects?.templates.find((t) => t.id === subject.id) : undefined
  const customRole = subject.type === 'role' ? subjects?.customRoles.find((r) => r.id === subject.id) : undefined
  const linkedId = subject.type !== 'template' ? subjects?.links[`${subject.type}:${subject.id}`] : undefined
  const linked = linkedId ? subjects?.templates.find((t) => t.id === linkedId) : undefined
  const run = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    try { await work(); toast(done) } catch (e) { toast(errorText(e, fallback), undefined, 'error') }
  }
  const usedBy = template?.links.map((l) => subjectTitle(l, subjects)) ?? []

  return (
    <div className="flex flex-wrap items-center gap-2">
      {linked && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-goms-sky/20 py-1 pl-2.5 pr-1 text-[12px] text-goms-navy" title="Linked: edits to the template apply here; this subject's own settings stay on top.">
          <Icon name="Link2" size={13} /> Follows “{linked.name}”
          {canEdit && (
            <button type="button" aria-label={`Unlink ${linked.name}`} title="Stop following this template"
              onClick={() => void run(() => m.unlinkTemplate.mutateAsync({ type: subject.type === 'user' ? 'user' : 'role', id: subject.id }), 'Template unlinked.', 'Could not unlink the template.')}
              className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-goms-navy/10 focus-visible:focus-ring"><Icon name="X" size={12} /></button>
          )}
        </span>
      )}
      {template && usedBy.length > 0 && (
        <span className="text-[12px] text-muted" title={usedBy.join(', ')}>Used by {usedBy.slice(0, 3).join(', ')}{usedBy.length > 3 ? ` +${usedBy.length - 3}` : ''}</span>
      )}
      {canEdit && subject.type !== 'template' && (
        <Button size="sm" variant="secondary" disabled={dirty} title={dirty ? 'Save or discard your changes first' : 'Copy these settings into a new template'} onClick={() => setOpen('saveAs')}>
          <Icon name="Copy" size={14} /> Save as template
        </Button>
      )}
      {canEdit && customRole && <>
        <Button size="sm" variant="secondary" onClick={() => setOpen('role')}><Icon name="Pencil" size={14} /> Edit role</Button>
        <Button size="sm" variant="ghost" aria-label="Delete role" title="Delete role" onClick={() => setOpen('delete')}><Icon name="Trash2" size={14} /></Button>
      </>}
      {canEdit && template && <>
        <Button size="sm" variant="primary" disabled={dirty} title={dirty ? 'Save or discard your changes first' : undefined} onClick={() => setOpen('apply')}>
          <Icon name="Send" size={14} /> Apply to roles / users
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('rename')}><Icon name="Pencil" size={14} /> Rename</Button>
        <Button size="sm" variant="ghost" aria-label="Duplicate template" title="Duplicate"
          onClick={() => void run(async () => onSelect({ type: 'template', id: (await m.duplicateTemplate.mutateAsync(template.id)).id }), 'Template duplicated.', 'Could not duplicate.')}>
          <Icon name="Copy" size={14} />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Delete template" title="Delete template" onClick={() => setOpen('delete')}><Icon name="Trash2" size={14} /></Button>
      </>}

      <NameDialog open={open === 'saveAs'} title="Save as template" confirm="Create template" initialName={`${subjectTitle(subject, subjects)} template`} onClose={close}
        onSubmit={async (name, description) => onSelect({ type: 'template', id: (await m.createTemplate.mutateAsync({ name, description, from: subject })).id })} />
      {template && <>
        <NameDialog open={open === 'rename'} title="Rename template" confirm="Save" initialName={template.name} initialDescription={template.description} onClose={close}
          onSubmit={(name, description) => m.updateTemplate.mutateAsync({ id: template.id, name, description })} />
        <ApplyTemplateDialog open={open === 'apply'} templateName={template.name} departments={departments} employees={employees}
          linked={template.links} onClose={close}
          onApply={async (list, mode) => { await m.applyTemplate.mutateAsync({ templateId: template.id, subjects: list, mode }); toast(`Applied to ${list.length}.`) }} />
      </>}
      {customRole && <RoleDialog open={open === 'role'} role={customRole} onClose={close} onSubmit={(input) => m.updateRole.mutateAsync({ id: customRole.id, ...input })} />}
      <ConfirmDeleteDialog open={open === 'delete'} onClose={close} itemLabel={template?.name ?? customRole?.label ?? ''}
        onConfirm={async () => {
          if (template) await m.deleteTemplate.mutateAsync(template.id)
          else if (customRole) await m.deleteRole.mutateAsync(customRole.id)
          close(); onSelect(null)
        }} />
    </div>
  )
}
