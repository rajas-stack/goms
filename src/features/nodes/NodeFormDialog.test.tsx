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
const createEmployeeMutateAsync = vi.fn()

function stubApiHooks() {
  vi.spyOn(api, 'useNodeMutations').mockReturnValue({
    create: { mutateAsync: createMutateAsync, isPending: false },
    update: { mutateAsync: updateMutateAsync, isPending: false },
    setStatus: {}, remove: {}, move: {},
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

beforeEach(() => {
  createMutateAsync.mockReset()
  updateMutateAsync.mockReset()
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
})
