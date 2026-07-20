import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useNodeMutations } from '@/lib/api'
import { childTypesOf, NODE_TYPE_MAP } from '@/lib/node-types'
import { fieldsForType } from './metadata-fields'
import { DepartmentFields } from './DepartmentFields'
import type { Domain, HierNode } from '@/lib/types'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  stateCode: number
  parent: HierNode | null
  node: HierNode | null
  createDepartment: boolean
  onClose: () => void
  onSaved: (id: string) => void
}

export function NodeFormDialog({ open, mode, stateCode, parent, node, createDepartment, onClose, onSaved }: Props) {
  const toast = useToast()
  const { create, update } = useNodeMutations()

  const childOptions = useMemo(() => (parent ? childTypesOf(parent.typeKey) : []), [parent])
  const [typeKey, setTypeKey] = useState<string>('')
  const [name, setName] = useState('')
  const [meta, setMeta] = useState<Record<string, string>>({})

  const effectiveTypeKey = createDepartment
    ? 'department'
    : mode === 'edit'
      ? node?.typeKey ?? ''
      : typeKey || childOptions[0]?.key || ''
  const domain: Domain = createDepartment ? 'org' : mode === 'edit' ? node?.domain ?? 'org' : parent?.domain ?? 'org'
  const fields = effectiveTypeKey ? fieldsForType(effectiveTypeKey, domain) : []
  const typeLabel = NODE_TYPE_MAP[effectiveTypeKey]?.label ?? 'Node'
  const isDepartment = effectiveTypeKey === 'department'
  const { data: employees = [] } = useAllEmployees()

  useEffect(() => {
    if (!open) return
    setTypeKey(childOptions[0]?.key ?? '')
    setName(mode === 'edit' ? node?.name ?? '' : '')
    setMeta(mode === 'edit' ? { ...node?.metadata } : {})
  }, [open, mode, node, childOptions])

  async function submit() {
    if (!name.trim()) return
    if (mode === 'edit' && node) {
      await update.mutateAsync({ id: node.id, patch: { name: name.trim(), metadata: meta } })
      toast(`Updated ${name.trim()}`)
      onSaved(node.id)
    } else {
      const created = await create.mutateAsync({
        domain,
        typeKey: effectiveTypeKey,
        parentId: createDepartment ? null : parent!.id,
        stateCode,
        name: name.trim(),
        metadata: meta,
      })
      toast(`Added ${typeLabel.toLowerCase()} “${name.trim()}”`)
      onSaved(created.id)
    }
    onClose()
  }

  const title = mode === 'edit'
    ? `Edit ${typeLabel.toLowerCase()}`
    : createDepartment
      ? 'New department'
      : `Add ${typeLabel.toLowerCase()}`
  const description = mode === 'create' && parent ? `Under ${parent.name}` : createDepartment ? `Jurisdiction: state ${stateCode}` : undefined

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={isDepartment ? 'lg' : 'md'}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {mode === 'edit' ? 'Save changes' : `Create ${typeLabel.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === 'create' && !createDepartment && childOptions.length > 1 && (
          <Field label="Type">
            <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
              {childOptions.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={isDepartment ? 'Full name' : 'Name'}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isDepartment ? 'e.g. Road Development Department' : `e.g. ${typeLabel} name`}
            autoFocus
          />
        </Field>
        {isDepartment && <DepartmentFields meta={meta} setMeta={setMeta} employees={employees} />}
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === 'text' ? (
              <Textarea value={meta[f.key] ?? ''} onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))} />
            ) : (
              <Input
                type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
                value={meta[f.key] ?? ''}
                onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </div>
    </Dialog>
  )
}
