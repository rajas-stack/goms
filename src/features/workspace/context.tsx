import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Employee, HierNode } from '@/lib/types'
import { NodeFormDialog } from '@/features/nodes/NodeFormDialog'
import { MoveDialog } from '@/features/nodes/MoveDialog'
import { EmployeeFormDialog } from '@/features/employees/EmployeeFormDialog'
import { ConfirmDialog } from '@/features/nodes/ConfirmDialog'

export type Selection = { kind: 'node' | 'employee'; id: string } | null

type Dialog =
  | { type: 'none' }
  | { type: 'createChild'; parent: HierNode }
  | { type: 'createDepartment' }
  | { type: 'editNode'; node: HierNode }
  | { type: 'move'; node: HierNode }
  | { type: 'delete'; node: HierNode }
  | { type: 'addEmployee'; orgNode: HierNode; presetManagerId?: string }
  | { type: 'editEmployee'; employee: Employee }

interface WorkspaceApi {
  stateCode: number
  selection: Selection
  select: (kind: 'node' | 'employee', id: string) => void
  clearSelection: () => void
  createChild: (parent: HierNode) => void
  createDepartment: () => void
  editNode: (node: HierNode) => void
  moveNode: (node: HierNode) => void
  deleteNode: (node: HierNode) => void
  addEmployee: (orgNode: HierNode, presetManagerId?: string) => void
  editEmployee: (employee: Employee) => void
}

const Ctx = createContext<WorkspaceApi | null>(null)
export const useWorkspace = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace outside provider')
  return v
}

export function WorkspaceProvider({ stateCode, children }: { stateCode: number; children: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<Dialog>({ type: 'none' })
  const close = () => setDialog({ type: 'none' })

  const selection: Selection = useMemo(() => {
    const id = params.get('sel')
    const kind = params.get('kind')
    if (id && (kind === 'node' || kind === 'employee')) return { kind, id }
    return null
  }, [params])

  const api: WorkspaceApi = {
    stateCode,
    selection,
    select: (kind, id) => setParams((p) => { p.set('sel', id); p.set('kind', kind); return p }, { replace: true }),
    clearSelection: () => setParams((p) => { p.delete('sel'); p.delete('kind'); return p }, { replace: true }),
    createChild: (parent) => setDialog({ type: 'createChild', parent }),
    createDepartment: () => setDialog({ type: 'createDepartment' }),
    editNode: (node) => setDialog({ type: 'editNode', node }),
    moveNode: (node) => setDialog({ type: 'move', node }),
    deleteNode: (node) => setDialog({ type: 'delete', node }),
    addEmployee: (orgNode, presetManagerId) => setDialog({ type: 'addEmployee', orgNode, presetManagerId }),
    editEmployee: (employee) => setDialog({ type: 'editEmployee', employee }),
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <NodeFormDialog
        open={dialog.type === 'createChild' || dialog.type === 'createDepartment' || dialog.type === 'editNode'}
        mode={dialog.type === 'editNode' ? 'edit' : 'create'}
        stateCode={stateCode}
        parent={dialog.type === 'createChild' ? dialog.parent : null}
        node={dialog.type === 'editNode' ? dialog.node : null}
        createDepartment={dialog.type === 'createDepartment'}
        onClose={close}
        onSaved={(id) => api.select('node', id)}
      />
      <MoveDialog
        open={dialog.type === 'move'}
        node={dialog.type === 'move' ? dialog.node : null}
        stateCode={stateCode}
        onClose={close}
      />
      <ConfirmDialog
        open={dialog.type === 'delete'}
        node={dialog.type === 'delete' ? dialog.node : null}
        onClose={close}
        onDeleted={api.clearSelection}
      />
      <EmployeeFormDialog
        open={dialog.type === 'addEmployee' || dialog.type === 'editEmployee'}
        orgNode={dialog.type === 'addEmployee' ? dialog.orgNode : null}
        employee={dialog.type === 'editEmployee' ? dialog.employee : null}
        presetManagerId={dialog.type === 'addEmployee' ? dialog.presetManagerId : undefined}
        onClose={close}
        onSaved={(id) => api.select('employee', id)}
      />
    </Ctx.Provider>
  )
}
