import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Employee, HierNode } from '@/lib/types'
import { NodeFormDialog } from '@/features/nodes/NodeFormDialog'
import { MoveDialog } from '@/features/nodes/MoveDialog'
import { EmployeeFormDialog } from '@/features/employees/EmployeeFormDialog'
import { SelectEmployeeDialog } from '@/features/employees/SelectEmployeeDialog'
import { ConfirmDialog } from '@/features/nodes/ConfirmDialog'
import { consumePendingWorkspaceAction, registerWorkspaceDialogHandle } from './backButtonBridge'

/** `'salesPerson'` is admitted here so the shared details panel, `?sel=`
 *  deep links, and the Android back-button chain all address AMNEX
 *  salespeople through the same mechanism as government records. The panel
 *  gains its rendering branch with the Roster phase. */
export type Selection = { kind: 'node' | 'employee' | 'salesPerson'; id: string } | null

export type SelectionKind = NonNullable<Selection>['kind']

type Dialog =
  | { type: 'none' }
  | { type: 'createChild'; parent: HierNode; initialTypeKey?: string }
  | { type: 'createDepartment' }
  | { type: 'editNode'; node: HierNode }
  | { type: 'move'; node: HierNode }
  | { type: 'delete'; node: HierNode }
  | { type: 'addEmployee'; orgNode: HierNode; presetManagerId?: string }
  | { type: 'selectEmployee'; orgNode: HierNode }
  | { type: 'editEmployee'; employee: Employee }

interface WorkspaceApi {
  stateCode: number
  selection: Selection
  select: (kind: SelectionKind, id: string) => void
  clearSelection: () => void
  createChild: (parent: HierNode, initialTypeKey?: string) => void
  createDepartment: () => void
  editNode: (node: HierNode) => void
  moveNode: (node: HierNode) => void
  deleteNode: (node: HierNode) => void
  addEmployee: (orgNode: HierNode, presetManagerId?: string) => void
  selectEmployee: (orgNode: HierNode) => void
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

  // Expose live dialog state (and the create actions below) to AppLayout-level
  // code — the Android back-button handler and the global "+" FAB — neither of
  // which can reach this context directly (see backButtonBridge.ts).
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog
  const stateCodeRef = useRef(stateCode)
  stateCodeRef.current = stateCode
  // `selection` (declared below) needs to be readable from the same
  // registered handle — kept as a ref, updated every render, so the back
  // button's `hasSelection()`/`clearSelection()` always see the live value
  // without re-registering the handle on every selection change.
  const selectionRef = useRef<Selection>(null)
  useEffect(() => {
    registerWorkspaceDialogHandle({
      isOpen: () => dialogRef.current.type !== 'none',
      close,
      stateCode: () => stateCodeRef.current,
      createChild: (parent, initialTypeKey) => setDialog({ type: 'createChild', parent, initialTypeKey }),
      createDepartment: () => setDialog({ type: 'createDepartment' }),
      addEmployee: (orgNode) => setDialog({ type: 'addEmployee', orgNode }),
      hasSelection: () => selectionRef.current != null,
      clearSelection: () => api.clearSelection(),
    })
    return () => registerWorkspaceDialogHandle(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Runs a FAB-enqueued action once this provider is mounted for the state it
  // targets — on initial mount, and again if this same instance's `stateCode`
  // ever changes (route param update without unmount). `consumePendingWorkspaceAction`
  // clears the queue slot as it returns, so this can never double-fire.
  useEffect(() => {
    const action = consumePendingWorkspaceAction(stateCode)
    if (!action) return
    if (action.action === 'createChild') setDialog({ type: 'createChild', parent: action.parent, initialTypeKey: action.initialTypeKey })
    else if (action.action === 'createDepartment') setDialog({ type: 'createDepartment' })
    else if (action.action === 'addEmployee') setDialog({ type: 'addEmployee', orgNode: action.orgNode })
  }, [stateCode])

  const selection: Selection = useMemo(() => {
    const id = params.get('sel')
    const kind = params.get('kind')
    // Whitelisted rather than cast: a hand-edited `?kind=` must not reach the
    // details panel as a kind it has no branch for. `salesPerson` joins the
    // list now that SalesPersonDetails renders it.
    if (id && (kind === 'node' || kind === 'employee' || kind === 'salesPerson')) return { kind, id }
    return null
  }, [params])
  selectionRef.current = selection

  const api: WorkspaceApi = {
    stateCode,
    selection,
    select: (kind, id) => setParams((p) => { p.set('sel', id); p.set('kind', kind); return p }, { replace: true }),
    clearSelection: () => setParams((p) => { p.delete('sel'); p.delete('kind'); return p }, { replace: true }),
    createChild: (parent, initialTypeKey) => setDialog({ type: 'createChild', parent, initialTypeKey }),
    createDepartment: () => setDialog({ type: 'createDepartment' }),
    editNode: (node) => setDialog({ type: 'editNode', node }),
    moveNode: (node) => setDialog({ type: 'move', node }),
    deleteNode: (node) => setDialog({ type: 'delete', node }),
    addEmployee: (orgNode, presetManagerId) => setDialog({ type: 'addEmployee', orgNode, presetManagerId }),
    selectEmployee: (orgNode) => setDialog({ type: 'selectEmployee', orgNode }),
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
        initialTypeKey={dialog.type === 'createChild' ? dialog.initialTypeKey : undefined}
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
      <SelectEmployeeDialog
        open={dialog.type === 'selectEmployee'}
        orgNode={dialog.type === 'selectEmployee' ? dialog.orgNode : null}
        onClose={close}
      />
    </Ctx.Provider>
  )
}
