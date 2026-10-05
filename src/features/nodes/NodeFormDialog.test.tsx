import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { NodeFormDialog } from './NodeFormDialog'
import { ToastProvider } from '@/components/ui/Toast'
import type { HierNode } from '@/lib/types'

const PARENT: HierNode = {
  id: 'parent-1', domain: 'org', typeKey: 'office', parentId: null, stateCode: 5,
  name: 'Test Office', code: null, sortOrder: 0, metadata: {}, status: 'active',
}

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const removeNodeMutateAsync = vi.fn()
const createEmployeeMutateAsync = vi.fn()

vi.mock('./DepartmentFields', () => ({
  DepartmentFields: ({ onCreateHead, setMeta }: {
    onCreateHead: (name: string, designation: string) => Promise<string>
    setMeta: (updater: (meta: Record<string, string>) => Record<string, string>) => void
  }) => (
    <button
      type="button"
      onClick={async () => {
        const id = await onCreateHead('New Department Head', 'Secretary')
        setMeta((meta) => ({ ...meta, deptHead: id }))
      }}
    >Create department head</button>
  ),
}))

function stubApiHooks() {
  vi.spyOn(api, 'useNodeMutations').mockReturnValue({
    create: { mutateAsync: createMutateAsync, isPending: false },
    update: { mutateAsync: updateMutateAsync, isPending: false },
    setStatus: {}, remove: { mutateAsync: removeNodeMutateAsync }, move: {},
  } as unknown as ReturnType<typeof api.useNodeMutations>)
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    create: { mutateAsync: createEmployeeMutateAsync, isPending: false },
    update: {}, addTimelineEvent: {}, remove: {},
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
}

function renderDialog() {
  const qc = new QueryClient()
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <NodeFormDialog
          open
          mode="create"
          stateCode={5}
          parent={PARENT}
          node={null}
          createDepartment={false}
          onClose={onClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onSaved, onClose }
}

function renderDepartmentDialog() {
  const qc = new QueryClient()
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <NodeFormDialog
          open
          mode="create"
          stateCode={0}
          parent={null}
          node={null}
          createDepartment
          onClose={onClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onSaved, onClose }
}

beforeEach(() => {
  createMutateAsync.mockReset()
  updateMutateAsync.mockReset()
  removeNodeMutateAsync.mockReset()
  createEmployeeMutateAsync.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NodeFormDialog — create-error surfacing', () => {
  it('shows a toast and leaves the dialog open when the create mutation rejects, instead of failing silently', async () => {
    stubApiHooks()
    createMutateAsync.mockRejectedValue(new Error('Could not create node.'))
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDialog()

    await user.type(screen.getByLabelText(/^name$/i), 'New Unit')
    await user.click(screen.getByRole('button', { name: /^create/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled())
    await screen.findByText(/Couldn't save/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves and closes normally when the create mutation succeeds', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'new-node-id' })
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDialog()

    await user.type(screen.getByLabelText(/^name$/i), 'New Unit')
    await user.click(screen.getByRole('button', { name: /^create/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-node-id'))
    expect(onClose).toHaveBeenCalled()
  })

  it('creates a department head only after the new department has an ID, then links it', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'new-department-id' })
    createEmployeeMutateAsync.mockResolvedValue({ id: 'new-head-id' })
    updateMutateAsync.mockResolvedValue({ id: 'new-department-id' })
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDepartmentDialog()

    await user.type(screen.getByLabelText('Full name'), 'New Department')
    await user.click(screen.getByRole('button', { name: 'Create department head' }))
    expect(createEmployeeMutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Create department' }))

    await waitFor(() => expect(createEmployeeMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Department Head', designation: 'Secretary', orgNodeId: 'new-department-id',
    })))
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.not.objectContaining({ deptHead: expect.any(String) }) }))
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'new-department-id',
      patch: { metadata: expect.objectContaining({ deptHead: 'new-head-id' }) },
    })
    expect(onSaved).toHaveBeenCalledWith('new-department-id')
    expect(onClose).toHaveBeenCalled()
  })

  it('rolls back the new department if creating its staged head fails', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'new-department-id' })
    createEmployeeMutateAsync.mockRejectedValue(new Error('Employee write failed'))
    removeNodeMutateAsync.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDepartmentDialog()

    await user.type(screen.getByLabelText('Full name'), 'New Department')
    await user.click(screen.getByRole('button', { name: 'Create department head' }))
    await user.click(screen.getByRole('button', { name: 'Create department' }))

    await waitFor(() => expect(removeNodeMutateAsync).toHaveBeenCalledWith('new-department-id'))
    await screen.findByText(/department was rolled back/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('rolls back the department and its employee if linking the head to metadata fails', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'new-department-id' })
    createEmployeeMutateAsync.mockResolvedValue({ id: 'new-head-id' })
    updateMutateAsync.mockRejectedValue(new Error('Metadata update failed'))
    removeNodeMutateAsync.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDepartmentDialog()

    await user.type(screen.getByLabelText('Full name'), 'New Department')
    await user.click(screen.getByRole('button', { name: 'Create department head' }))
    await user.click(screen.getByRole('button', { name: 'Create department' }))

    await waitFor(() => expect(removeNodeMutateAsync).toHaveBeenCalledWith('new-department-id'))
    expect(createEmployeeMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ orgNodeId: 'new-department-id' }))
    await screen.findByText(/department was rolled back/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores a staged head after reload and never persists its temporary picker ID', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'restored-department-id' })
    createEmployeeMutateAsync.mockResolvedValue({ id: 'restored-head-id' })
    updateMutateAsync.mockResolvedValue({ id: 'restored-department-id' })
    const pendingDepartmentHead = {
      id: 'pending-department-head:Restored Head',
      name: 'Restored Head',
      designation: 'Director',
    }
    sessionStorage.setItem('gorms:draft:node:new:dept:0', JSON.stringify({
      savedAt: Date.now(),
      form: {
        typeKey: '',
        name: 'Restored Department',
        meta: { shortName: 'RD', deptHead: pendingDepartmentHead.id },
        pendingDepartmentHead,
      },
    }))
    const user = userEvent.setup()
    renderDepartmentDialog()

    expect(await screen.findByText('Restored your unsaved changes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create department' }))

    await waitFor(() => expect(createEmployeeMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Restored Head', designation: 'Director', orgNodeId: 'restored-department-id',
    })))
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.not.objectContaining({ deptHead: pendingDepartmentHead.id }),
    }))
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'restored-department-id',
      patch: { metadata: expect.objectContaining({ deptHead: 'restored-head-id' }) },
    })
  })
})
