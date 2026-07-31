import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PhoneInput, isValidPhone } from '@/components/ui/PhoneInput'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations, useNodeMutations } from '@/lib/api'
import { useFormDraft } from '@/lib/useFormDraft'
import { childTypesOf, NODE_TYPE_MAP } from '@/lib/node-types'
import { fieldsForType } from './metadata-fields'
import { DepartmentFields } from './DepartmentFields'
import { abbreviateDepartmentName } from './department-meta'
import type { Domain, HierNode } from '@/lib/types'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  stateCode: number
  parent: HierNode | null
  node: HierNode | null
  createDepartment: boolean
  /** Preselects the child-type dropdown below (e.g. the global FAB's "Create
   *  Office" needs 'office' preset even when the picked parent's other valid
   *  child types would otherwise default to the first one alphabetically/by
   *  registry order). Ignored if it isn't one of the parent's actual child
   *  options; the dropdown remains fully editable either way. */
  initialTypeKey?: string
  onClose: () => void
  onSaved: (id: string) => void
}

export function NodeFormDialog({ open, mode, stateCode, parent, node, createDepartment, initialTypeKey, onClose, onSaved }: Props) {
  const toast = useToast()
  const { create, update } = useNodeMutations()
  const { create: createEmployee } = useEmployeeMutations()

  const childOptions = useMemo(() => (parent ? childTypesOf(parent.typeKey) : []), [parent])
  const [typeKey, setTypeKey] = useState<string>('')
  const [name, setName] = useState('')
  const [meta, setMeta] = useState<Record<string, string>>({})
  // Tracks whether Short name already holds a real value (hand-typed or
  // loaded from an existing department) — while it doesn't, the effect below
  // keeps it in sync with the full name as it's typed.
  const shortNameTouched = useRef(false)

  // The three pieces of state above, bundled into one value so `useFormDraft`
  // can save/restore them together — a name typed with a metadata field
  // half-filled is one in-progress edit, not two independent ones.
  const draftForm = { typeKey, name, meta }
  const draftKey = mode === 'edit'
    ? (node ? `node:${node.id}` : null)
    : createDepartment
      ? `node:new:dept:${stateCode}`
      : (parent ? `node:new:${parent.id}` : null)

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

  // Live-fills Short name from the full name as it's typed, e.g. "Road
  // Development Department" -> "RDD" — stops the moment the user edits Short
  // name directly (see shortNameTouched above and handleShortNameChange below).
  useEffect(() => {
    if (!isDepartment || shortNameTouched.current) return
    setMeta((m) => ({ ...m, shortName: name.trim() ? abbreviateDepartmentName(name) : '' }))
  }, [name, isDepartment])

  function handleShortNameChange(value: string) {
    shortNameTouched.current = true
    setMeta((m) => ({ ...m, shortName: value }))
  }

  const draft = useFormDraft(draftKey, draftForm, open, () => {
    const preset = initialTypeKey && childOptions.some((t) => t.key === initialTypeKey) ? initialTypeKey : childOptions[0]?.key ?? ''
    const resetMeta = mode === 'edit' ? { ...node?.metadata } : {}
    setTypeKey(preset)
    setName(mode === 'edit' ? node?.name ?? '' : '')
    setMeta(resetMeta)
    shortNameTouched.current = !!resetMeta.shortName
  })

  useEffect(() => {
    if (!open) return
    const preset = initialTypeKey && childOptions.some((t) => t.key === initialTypeKey) ? initialTypeKey : childOptions[0]?.key ?? ''
    const base = { typeKey: preset, name: mode === 'edit' ? node?.name ?? '' : '', meta: mode === 'edit' ? { ...node?.metadata } : {} }
    const restored = draft.take(base)
    const effectiveMeta = restored?.meta ?? base.meta
    setTypeKey(restored?.typeKey ?? base.typeKey)
    setName(restored?.name ?? base.name)
    setMeta(effectiveMeta)
    shortNameTouched.current = !!effectiveMeta.shortName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, node, childOptions, initialTypeKey])

  async function handleCreateHead(headName: string, designation: string) {
    const targetNodeId = node?.id ?? parent?.id
    if (!targetNodeId) throw new Error('No org node to attach to')
    const created = await createEmployee.mutateAsync({
      name: headName, designation, email: '', phone: '', orgNodeId: targetNodeId, managerId: null,
    })
    return created.id
  }

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
    draft.clear()
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
      size={isDepartment ? 'xl' : 'md'}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending || update.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || create.isPending || update.isPending}>
            {mode === 'edit'
              ? (update.isPending ? 'Saving…' : 'Save changes')
              : (create.isPending ? 'Creating…' : `Create ${typeLabel.toLowerCase()}`)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
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
        {isDepartment && (
          <DepartmentFields
            meta={meta}
            setMeta={setMeta}
            onShortNameChange={handleShortNameChange}
            employees={employees}
            onCreateHead={handleCreateHead}
          />
        )}
        {fields.map((f) => {
          const value = meta[f.key] ?? ''
          const phoneInvalid = f.type === 'phone' && !isValidPhone(value)
          return (
            <Field
              key={f.key}
              label={f.label}
              hint={f.type === 'phone' ? '+91 · 10-digit number' : undefined}
            >
              {f.type === 'text' ? (
                <Textarea value={value} onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))} />
              ) : f.type === 'phone' ? (
                <>
                  <PhoneInput value={value} onChange={(v) => setMeta((m) => ({ ...m, [f.key]: v }))} invalid={phoneInvalid} />
                  {phoneInvalid && <span className="mt-1 block text-xs text-crimson">Enter a valid 10-digit number.</span>}
                </>
              ) : (
                <Input
                  type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
                  value={value}
                  onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          )
        })}
      </div>
    </Dialog>
  )
}
