import { useCallback, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCanvas, type DragPayload } from './canvasContext'
import { NodeCard } from './NodeCard'
import { EmployeeCard } from './EmployeeCard'
import { rootReportsOf } from './reporting'
import {
  useChildren, useDirectReports, useEmployee, useEmployeeMutations, useEmployeesDirect,
  useNode, useNodeMutations,
} from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { useToast } from '@/components/ui/Toast'
import { NODE_TYPE_MAP, isValidChildType } from '@/lib/node-types'
import type { Employee, HierNode } from '@/lib/types'

export type CanvasItem =
  | { kind: 'node'; node: HierNode }
  | { kind: 'employee'; employee: Employee }

function itemKey(item: CanvasItem): string {
  return item.kind === 'node' ? `node:${item.node.id}` : `emp:${item.employee.id}`
}

const EMPLOYEE_ADDERS = new Set(['department', 'branch', 'division', 'office', 'unit'])

export interface Controlled {
  expanded: boolean
  setExpanded: (v: boolean) => void
}

export function CanvasBranch({ item, depth, parentKey, controlled }: {
  item: CanvasItem
  depth: number
  parentKey: string | null
  /** When set, this branch's expand/collapse is driven externally (used for
   *  single-department-open-at-a-time accordion behavior at the root level). */
  controlled?: Controlled
}) {
  const canvas = useCanvas()
  const ws = useWorkspace()
  const toast = useToast()
  const { move, reorder } = useNodeMutations()
  const { update: updateEmployee, setManager } = useEmployeeMutations()
  const key = itemKey(item)
  const expanded = controlled ? controlled.expanded : canvas.isExpanded(key, depth)

  useEffect(() => {
    if (parentKey) canvas.setParent(key, parentKey)
    return () => canvas.clearParent(key)
  }, [key, parentKey, canvas])

  const isNode = item.kind === 'node'
  const node = item.kind === 'node' ? item.node : null
  const employee = item.kind === 'employee' ? item.employee : null
  const type = node ? NODE_TYPE_MAP[node.typeKey] : null
  const addsEmployee = !!node && node.domain === 'org' && EMPLOYEE_ADDERS.has(node.typeKey)
  const canExpandNode = isNode && ((type?.childKeys.length ?? 0) > 0 || addsEmployee)
  const canExpand = isNode ? canExpandNode : true

  const { data: childNodes = [] } = useChildren(isNode && expanded && canExpandNode ? node!.id : null)
  const { data: directEmployees = [] } = useEmployeesDirect(isNode && expanded && addsEmployee ? node!.id : null)
  const { data: reports = [] } = useDirectReports(!isNode && expanded ? employee!.id : null)
  const { data: employeeOrgNode } = useNode(!isNode ? employee!.orgNodeId : null)

  const isDepartment = isNode && node!.typeKey === 'department'
  const { data: deptHeadEmployee } = useEmployee(isDepartment ? node!.metadata.deptHead || null : null)
  const deptHeads = deptHeadEmployee
    ? [{ name: deptHeadEmployee.name, photoUrl: deptHeadEmployee.photoUrl, vacant: deptHeadEmployee.vacant }]
    : []

  const childItems: CanvasItem[] = useMemo(() => {
    if (isNode) {
      // Only the top of each local reporting chain renders here — an employee
      // whose manager is also posted at this node nests under that manager's
      // card instead (via directReports below), so no one renders twice.
      return [
        ...childNodes.map((n): CanvasItem => ({ kind: 'node', node: n })),
        ...rootReportsOf(directEmployees).map((e): CanvasItem => ({ kind: 'employee', employee: e })),
      ]
    }
    return reports.map((e): CanvasItem => ({ kind: 'employee', employee: e }))
  }, [isNode, childNodes, directEmployees, reports])

  const selected = isNode
    ? ws.selection?.kind === 'node' && ws.selection.id === node!.id
    : ws.selection?.kind === 'employee' && ws.selection.id === employee!.id

  function onSelect() {
    ws.select(isNode ? 'node' : 'employee', isNode ? node!.id : employee!.id)
    if (controlled && !controlled.expanded) controlled.setExpanded(true)
  }
  function setExpanded(v: boolean) {
    if (controlled) controlled.setExpanded(v)
    else canvas.setNodeExpanded(key, depth, v)
  }
  function onToggle() {
    setExpanded(!expanded)
  }
  function onAdd() {
    if (isNode) {
      if (addsEmployee) ws.addEmployee(node!)
      else ws.createChild(node!)
    } else if (employeeOrgNode) {
      ws.addEmployee(employeeOrgNode, employee!.id)
    }
    setExpanded(true)
  }
  function onSelectEmployee() {
    if (isNode && addsEmployee) ws.selectEmployee(node!)
    setExpanded(true)
  }
  function onAddChild() {
    if (isNode) ws.createChild(node!)
    setExpanded(true)
  }

  // --- drag & drop reorganization ------------------------------------------
  const dragPayload = canvas.dragPayload
  function canBeParent(target: HierNode, dragged: HierNode) {
    if (target.domain !== dragged.domain || target.stateCode !== dragged.stateCode) return false
    return isValidChildType(target.typeKey, dragged.typeKey)
  }
  function dropValid(p: DragPayload | null): boolean {
    if (!p || p.key === key) return false
    if (p.kind === 'node') {
      if (!isNode || !node) return false
      if (p.node.id === node.id) return false
      if (p.node.parentId === node.parentId) return true // reorder among siblings
      return canBeParent(node, p.node)
    }
    if (isNode && node) return node.domain === 'org' && EMPLOYEE_ADDERS.has(node.typeKey) // repost
    if (employee) return p.employee.id !== employee.id // change manager
    return false
  }
  const canDrop = dropValid(dragPayload)
  const dropActive = canDrop && canvas.overKey === key
  const dragging = dragPayload?.key === key

  function onDragStart(e: React.DragEvent) {
    e.stopPropagation()
    const payload: DragPayload = isNode
      ? { key, kind: 'node', node: node! }
      : { key, kind: 'employee', employee: employee! }
    canvas.setDragPayload(payload)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
  function onDragOver(e: React.DragEvent) {
    if (!canDrop) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (canvas.overKey !== key) canvas.setOverKey(key)
  }
  function onDragLeave() {
    if (canvas.overKey === key) canvas.setOverKey(null)
  }
  function onDragEnd() {
    canvas.setDragPayload(null)
    canvas.setOverKey(null)
    // Chrome on Windows hides the OS cursor for the duration of a native
    // HTML5 drag and sometimes fails to restore it afterward — it then stays
    // invisible until the pointer leaves and re-enters the window. Forcing an
    // explicit cursor value and releasing it one frame later makes Chrome
    // recompute the cursor immediately instead of waiting for that.
    const root = document.documentElement
    root.style.cursor = 'default'
    requestAnimationFrame(() => { root.style.cursor = '' })
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const p = dragPayload
    canvas.setOverKey(null)
    canvas.setDragPayload(null)
    if (!dropValid(p)) return
    try {
      if (p!.kind === 'node' && isNode && node) {
        if (p!.node.parentId === node.parentId) {
          await reorder.mutateAsync({ id: p!.node.id, beforeId: node.id })
          toast('Reordered')
        } else {
          await move.mutateAsync({ id: p!.node.id, newParentId: node.id })
          toast(`Moved ${p!.node.name} under ${node.name}`)
        }
      } else if (p!.kind === 'employee') {
        if (isNode && node) {
          await updateEmployee.mutateAsync({ id: p!.employee.id, patch: { orgNodeId: node.id } })
          toast(`Reposted ${p!.employee.name || 'position'}`)
        } else if (employee) {
          await setManager.mutateAsync({ employeeId: p!.employee.id, managerId: employee.id })
          toast(`${p!.employee.name} now reports to ${employee.name}`)
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Move not allowed')
    }
  }

  const showEmpty = expanded && canExpand && childItems.length === 0
  const setRef = useCallback((el: HTMLElement | null) => canvas.setCardRef(key, el), [canvas, key])

  return (
    <div className="flex flex-col items-center">
      <div
        ref={setRef}
        data-card-key={key}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        {isNode ? (
          <NodeCard
            node={node!}
            selected={!!selected}
            expanded={expanded}
            canExpand={canExpand}
            showMetadata={canvas.showMetadata}
            heads={deptHeads}
            dropActive={dropActive}
            dragging={dragging}
            onSelect={onSelect}
            onToggle={onToggle}
            onAdd={onAdd}
            onSelectEmployee={addsEmployee ? onSelectEmployee : undefined}
            onAddChild={addsEmployee ? onAddChild : undefined}
          />
        ) : (
          <EmployeeCard
            employee={employee!}
            selected={!!selected}
            expanded={expanded}
            canExpand={canExpand}
            showMetadata={canvas.showMetadata}
            isDeptHead={!!employee && canvas.deptHeadId === employee.id}
            dropActive={dropActive}
            dragging={dragging}
            onSelect={onSelect}
            onToggle={onToggle}
            onAdd={onAdd}
          />
        )}
      </div>

      <AnimatePresence>
        {expanded && childItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-10 pt-12"
          >
            {childItems.map((ci) => (
              <CanvasBranch key={itemKey(ci)} item={ci} depth={depth + 1} parentKey={key} />
            ))}
          </motion.div>
        )}
        {showEmpty && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pt-8 text-[12px] italic text-muted"
          >
            Nothing here yet
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
