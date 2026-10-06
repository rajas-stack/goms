import { usePermissions } from '@/lib/permissions'
import { moduleForDomain } from '@/lib/routeModules'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CanvasProvider, useCanvas, elbowPath, type Edge } from './canvasContext'
import { useCanvasViewport } from './useCanvasViewport'
import { CanvasControls } from './CanvasControls'
import { CanvasBranch, type CanvasItem } from './CanvasBranch'
import { DepartmentCombobox } from './DepartmentCombobox'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { rootReportsOf } from './reporting'
import {
  useBreadcrumb, useEmployee, useEmployeeMutations, useEmployeesByState, useEmployeesUnder, useNode, useOrgRoots,
  useStateNode,
} from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { cn, isTypingTarget } from '@/lib/utils'
import type { Domain, Employee } from '@/lib/types'

/** The canvas renders three logical views over the same generic engine: the
 *  org containment tree, the geo containment tree, and — reusing the same
 *  connected-card rendering — the people reporting hierarchy. */
export type CanvasView = Domain | 'people'

export function HierarchyCanvas({ domain, stateCode }: { domain: CanvasView; stateCode: number }) {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return (
    <CanvasProvider onChange={bump}>
      <CanvasStage domain={domain} stateCode={stateCode} version={version} />
    </CanvasProvider>
  )
}

function CanvasStage({ domain, stateCode, version }: { domain: CanvasView; stateCode: number; version: number }) {
  const canvas = useCanvas()
  const ws = useWorkspace()
  const { data: stateNode } = useStateNode(stateCode)
  const { data: orgRoots = [] } = useOrgRoots(stateCode)
  const { data: stateEmployees = [] } = useEmployeesByState(stateCode)
  const { data: selectedNode } = useNode(ws.selection?.kind === 'node' ? ws.selection.id : null)
  const { remove: removeEmployee } = useEmployeeMutations()
  const perms = usePermissions()

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(viewportRef, contentRef)
  const { transform, dragging, userInteractedRef } = viewport
  const [edges, setEdges] = useState<Edge[]>([])
  const lastPeopleDeptRef = useRef<string | null>(null)
  const activeKeyRef = useRef<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null)
  const { data: employeeToDeleteRecord } = useEmployee(employeeToDelete)

  const hasRootAccordion = domain === 'org' || domain === 'people'
  const [expandedRootId, setExpandedRootId] = useState<string | 'all' | null>(null)
  const initializedRef = useRef(false)

  // People view: the reporting hierarchy is always scoped to one department,
  // kept in sync with the shared workspace selection — selecting a department
  // (or anything under one) in the Organization view, or an employee here,
  // both resolve to the same department id so the two tabs never disagree.
  // Falls back to the first department, and remembers the last one shown if
  // the selection is cleared, so an Escape doesn't yank the user elsewhere.
  const selectionNodeId = domain === 'people' && ws.selection?.kind === 'node' ? ws.selection.id : null
  const { data: selectionNodeTrail = [] } = useBreadcrumb(selectionNodeId)
  const selectionEmployee = domain === 'people' && ws.selection?.kind === 'employee'
    ? stateEmployees.find((e) => e.id === ws.selection!.id) ?? null
    : null
  const { data: selectionEmployeeTrail = [] } = useBreadcrumb(domain === 'people' ? selectionEmployee?.orgNodeId ?? null : null)
  const selectionTrail = selectionNodeId ? selectionNodeTrail : selectionEmployeeTrail
  const selectionDeptIdx = selectionTrail.findIndex((t) => t.typeKey === 'department')
  const impliedDeptId = selectionDeptIdx >= 0 ? selectionTrail[selectionDeptIdx].id : null
  const peopleBranch = selectionDeptIdx >= 0 ? selectionTrail[selectionDeptIdx + 1] : undefined

  useLayoutEffect(() => {
    if (impliedDeptId) lastPeopleDeptRef.current = impliedDeptId
  }, [impliedDeptId])

  const selectedDeptId = impliedDeptId ?? lastPeopleDeptRef.current ?? orgRoots[0]?.id ?? null
  const selectedDeptNode = orgRoots.find((d) => d.id === selectedDeptId) ?? null
  const deptHeadId = domain === 'people' ? selectedDeptNode?.metadata.deptHead ?? null : null
  const { data: deptEmployees = [] } = useEmployeesUnder(domain === 'people' ? selectedDeptId : null)
  // The assigned head isn't always posted inside their own department's
  // subtree (e.g. a head office role covering several branches) — fetch them
  // directly so their card still renders even when `deptEmployees` wouldn't
  // otherwise include them.
  const headInSubtree = !!deptHeadId && deptEmployees.some((e) => e.id === deptHeadId)
  const { data: outsideHeadEmployee } = useEmployee(deptHeadId && !headInSubtree ? deptHeadId : null)
  const peopleRootsBase = domain === 'people' ? rootReportsOf(deptEmployees) : []
  const peopleRoots = outsideHeadEmployee ? [outsideHeadEmployee, ...peopleRootsBase] : peopleRootsBase

  // People-canvas search (item 7): a separate free-text filter over the
  // employee cards already resolved above, scoped strictly to the People
  // domain so it can never affect the Organization/geo/sales branches. Same
  // predicate as the List view (`PeopleDirectory.tsx:126-127`) — lowercase/
  // trim query, substring match against name/designation/phone/email/manager
  // name — so the two views agree on what "matches" means.
  const [peopleQuery, setPeopleQuery] = useState('')
  // Resolved from the full state-scoped employee list (not just `deptEmployees`)
  // so a root card whose manager sits outside this department (e.g. a head
  // office role) still resolves a manager name to search against — mirroring
  // `PeopleDirectory`'s `nameById`, which is likewise built from its full
  // in-scope list rather than the currently-filtered one.
  const peopleNameById = useMemo(
    () => new Map(stateEmployees.map((e) => [e.id, e.name] as const)),
    [stateEmployees],
  )
  // Matches over the FULL department subtree (`deptEmployees`, plus the head
  // when they sit outside it), not just `peopleRoots` — a card only renders
  // as one of the top-level items being mapped over below, and children only
  // ever render once their parent branch is expanded, so filtering `roots`
  // alone would hide a matching subordinate entirely whenever their own
  // root manager's searchable fields happen not to match the query (the
  // original item 7 bug: an exact name match on a non-root person returned
  // nothing). While a query is active, matched people — root or not — are
  // shown flattened as top-level cards instead of nested under a (possibly
  // non-matching, now-hidden) manager; each card still resolves its own real
  // children live via `useDirectReports` if expanded, so this only changes
  // which cards start at depth 0 during a search, not the data itself.
  const searchableDeptEmployees = outsideHeadEmployee ? [outsideHeadEmployee, ...deptEmployees] : deptEmployees
  const matchesQuery = useCallback((e: Employee, q: string) => {
    const managerName = e.managerId ? peopleNameById.get(e.managerId) ?? '' : ''
    const haystack = [e.name, e.designation, e.phone, e.email, managerName].join(' ').toLowerCase()
    return haystack.includes(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleNameById])
  const filteredPeopleRoots = useMemo(() => {
    const q = peopleQuery.trim().toLowerCase()
    if (!q) return peopleRoots
    return searchableDeptEmployees.filter((e) => matchesQuery(e, q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleRoots, searchableDeptEmployees, peopleQuery, matchesQuery])

  // Flag the department head's card wherever it renders in the People view,
  // so hierarchy (who's the head vs. a peer root report) is unambiguous.
  useLayoutEffect(() => {
    canvas.setDeptHeadId(deptHeadId)
  }, [deptHeadId, canvas])

  function onSelectDepartment(id: string) {
    if (!id) return
    userInteractedRef.current = false
    ws.select('node', id)
  }

  // Each domain gets its own fresh "auto-open the first root" behavior —
  // switching tabs shouldn't carry over another domain's expanded root.
  useLayoutEffect(() => {
    initializedRef.current = false
    setExpandedRootId(null)
  }, [domain])

  useLayoutEffect(() => {
    const roots = domain === 'org' ? orgRoots : domain === 'people' ? peopleRoots : []
    if (hasRootAccordion && !initializedRef.current && expandedRootId === null && roots.length > 0) {
      initializedRef.current = true
      setExpandedRootId(roots[0].id)
    }
  })

  // Switching departments in the People view is a new tree, not a toggle —
  // reset the root accordion so the new department's top-of-chain opens.
  const prevPeopleDeptRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (domain !== 'people') return
    if (prevPeopleDeptRef.current === selectedDeptId) return
    prevPeopleDeptRef.current = selectedDeptId
    initializedRef.current = false
    setExpandedRootId(null)
  }, [domain, selectedDeptId])

  const recompute = useCallback(() => {
    setEdges(canvas.computeEdges(contentRef.current))
  }, [canvas])

  // Center + zoom the viewport on a single card (by canvas key). Used by the
  // Organization-view department search to bring the matched department into
  // view. `userInteractedRef` is flipped so the auto-center effect doesn't
  // immediately re-center on the whole tree. Domain-specific (only the
  // Organization search jumps to a card by key), so it stays here rather
  // than in the shared `useCanvasViewport` hook.
  const centerOnCard = useCallback((key: string, scale = 1.1) => {
    const el = canvas.getCard(key)
    const content = contentRef.current
    const vp = viewportRef.current
    if (!el || !content || !vp) return false
    let x = 0
    let y = 0
    let node: HTMLElement | null = el
    let guard = 0
    while (node && node !== content && guard < 200) {
      x += node.offsetLeft
      y += node.offsetTop
      node = node.offsetParent as HTMLElement | null
      guard += 1
    }
    userInteractedRef.current = true
    const cx = x + el.offsetWidth / 2
    const cy = y + el.offsetHeight / 2
    viewport.setTransform({ scale, x: vp.clientWidth / 2 - cx * scale, y: vp.clientHeight / 2 - cy * scale })
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas])

  // Organization view: jump to a department found via the search control —
  // expand it, select (highlight) it, then center the canvas on its card once
  // the layout has settled. Departments are org roots, so expanding the
  // matching root is what reveals its subtree.
  function onSearchOrgDepartment(id: string) {
    if (!id) return
    ws.select('node', id)
    setExpandedRootId(id)
    requestAnimationFrame(() => requestAnimationFrame(() => centerOnCard(`node:${id}`)))
  }

  useLayoutEffect(() => {
    recompute()
  }, [version, recompute])

  // Keep auto-centering as the tree grows (async data loading in) until the
  // user manually pans/zooms, or until the active department/domain changes.
  useLayoutEffect(() => {
    const key = `${domain}:${stateCode}:${domain === 'people' ? selectedDeptId ?? '' : ''}:${expandedRootId ?? ''}`
    if (activeKeyRef.current !== key) {
      activeKeyRef.current = key
      userInteractedRef.current = false
    }
    if (userInteractedRef.current) return
    viewport.centerView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, domain, stateCode, selectedDeptId, expandedRootId, viewport.centerView])

  useLayoutEffect(() => {
    if (!contentRef.current) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [recompute])

  function resetView() {
    viewport.resetView()
    recompute()
  }
  function expandAll() {
    userInteractedRef.current = true
    canvas.setAllExpanded(true)
    if (hasRootAccordion) setExpandedRootId('all')
  }
  function collapseAll() {
    userInteractedRef.current = true
    canvas.setAllExpanded(false)
    if (hasRootAccordion) setExpandedRootId(null)
  }

  // Select a card by its canvas key (`node:id` / `emp:id`) and bring it into
  // view — the shared primitive behind arrow-key navigation.
  function selectByKey(k: string) {
    const sep = k.indexOf(':')
    const prefix = k.slice(0, sep)
    const id = k.slice(sep + 1)
    ws.select(prefix === 'node' ? 'node' : 'employee', id)
    requestAnimationFrame(() => centerOnCard(k, transform.scale))
  }

  // Geometry-based arrow navigation over whatever cards are currently rendered:
  // pick the nearest card in the pressed direction, weighting cross-axis drift.
  function moveSelection(dir: 'up' | 'down' | 'left' | 'right') {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card-key]'))
    if (cards.length === 0) return
    const curKey = ws.selection
      ? `${ws.selection.kind === 'node' ? 'node' : 'emp'}:${ws.selection.id}`
      : null
    const cur = curKey ? cards.find((c) => c.dataset.cardKey === curKey) : null
    if (!cur) { selectByKey(cards[0].dataset.cardKey!); return }
    const cr = cur.getBoundingClientRect()
    const ccx = cr.left + cr.width / 2
    const ccy = cr.top + cr.height / 2
    let best: HTMLElement | null = null
    let bestScore = Infinity
    for (const c of cards) {
      if (c === cur) continue
      const r = c.getBoundingClientRect()
      const dx = r.left + r.width / 2 - ccx
      const dy = r.top + r.height / 2 - ccy
      const inDir = dir === 'up' ? dy < -1 : dir === 'down' ? dy > 1 : dir === 'left' ? dx < -1 : dx > 1
      if (!inDir) continue
      const vertical = dir === 'up' || dir === 'down'
      const score = (vertical ? Math.abs(dy) : Math.abs(dx)) + (vertical ? Math.abs(dx) : Math.abs(dy)) * 2
      if (score < bestScore) { bestScore = score; best = c }
    }
    if (best) selectByKey(best.dataset.cardKey!)
  }

  function openSelected() {
    if (!ws.selection) return
    if (ws.selection.kind === 'node') {
      if (hasRootAccordion && orgRoots.some((r) => r.id === ws.selection!.id)) setExpandedRootId(ws.selection.id)
      else canvas.setNodeExpanded(`node:${ws.selection.id}`, 1, true)
    } else {
      canvas.setNodeExpanded(`emp:${ws.selection.id}`, 1, true)
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+A expands all, Ctrl/Cmd+Shift+A collapses all.
      if ((e.metaKey || e.ctrlKey) && !isTypingTarget(e.target) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (e.shiftKey) collapseAll(); else expandAll()
        return
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case '?':
          e.preventDefault(); setShortcutsOpen(true); break
        case 'f': case 'F':
          e.preventDefault(); viewport.fitToScreen(); break
        case '+': case '=':
          e.preventDefault(); viewport.zoomBy(1 / 0.85); break
        case '-': case '_':
          e.preventDefault(); viewport.zoomBy(0.85); break
        case '0':
          e.preventDefault(); resetView(); break
        case 'e': case 'E':
          e.preventDefault(); expandAll(); break
        case 'c': case 'C':
          e.preventDefault(); collapseAll(); break
        case 'ArrowUp':
          e.preventDefault(); moveSelection('up'); break
        case 'ArrowDown':
          e.preventDefault(); moveSelection('down'); break
        case 'ArrowLeft':
          e.preventDefault(); moveSelection('left'); break
        case 'ArrowRight':
          e.preventDefault(); moveSelection('right'); break
        case 'Enter':
          e.preventDefault(); openSelected(); break
        case 'Escape':
          ws.clearSelection(); break
        case 'Delete': case 'Backspace':
          if (!ws.selection) return
          e.preventDefault()
          if (ws.selection.kind === 'node' && selectedNode) { if (perms.can(moduleForDomain(selectedNode.domain), 'delete')) ws.deleteNode(selectedNode) }
          else if (ws.selection.kind === 'employee') { if (perms.can('am.contacts', 'delete')) setEmployeeToDelete(ws.selection.id) }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.selection, selectedNode, removeEmployee, orgRoots, transform.scale, perms])

  const rootItems: CanvasItem[] = domain === 'geo'
    ? (stateNode ? [{ kind: 'node', node: stateNode }] : [])
    : domain === 'org'
      ? orgRoots.map((n) => ({ kind: 'node', node: n }))
      : filteredPeopleRoots.map((e) => ({ kind: 'employee', employee: e }))

  return (
    <div
      ref={viewportRef}
      className={cn(
        // `select-none` here (not just on <body> during a pan) is essential:
        // a press that begins on a card bails out of onPointerDown before the
        // pan guard runs, so without this a drag off a card onto the grid would
        // start a native text selection and swap the grab cursor for an I-beam.
        'survey-grid relative h-full w-full touch-none select-none overflow-hidden',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onWheel={viewport.onWheel}
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.endPan}
      onPointerCancel={viewport.endPan}
      onLostPointerCapture={viewport.endPan}
    >
      {domain === 'org' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white/90 px-4 py-2.5 text-[12px]">
          <Icon name="Landmark" size={13} className="text-muted" />
          <span className="font-medium text-ink-900">{stateNode?.name ?? 'State'}</span>
          <Icon name="ChevronRight" size={12} className="text-line" />
          <DepartmentCombobox
            departments={orgRoots}
            value={orgRoots.find((d) => d.id === (ws.selection?.kind === 'node' ? ws.selection.id : ''))?.id ?? null}
            onSelect={onSearchOrgDepartment}
            placeholder="Search departments…"
          />
          <span className="ml-auto flex items-center gap-1 font-medium text-muted">
            <Icon name="Landmark" size={12} />
            {orgRoots.length} {orgRoots.length === 1 ? 'department' : 'departments'}
          </span>
        </div>
      )}
      {domain === 'people' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white/90 px-4 py-2.5 text-[12px]">
          <Icon name="Landmark" size={13} className="text-muted" />
          <span className="font-medium text-ink-900">{stateNode?.name ?? 'State'}</span>
          <Icon name="ChevronRight" size={12} className="text-line" />
          <DepartmentCombobox
            departments={orgRoots}
            value={selectedDeptId}
            onSelect={onSelectDepartment}
            placeholder="Search departments…"
          />
          {peopleBranch && (
            <>
              <Icon name="ChevronRight" size={12} className="text-line" />
              <span className="text-muted">{peopleBranch.name}</span>
              <span className="eyebrow">{NODE_TYPE_MAP[peopleBranch.typeKey]?.label}</span>
            </>
          )}
          <div className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-2">
            <Icon name="Search" size={13} className="shrink-0 text-muted" />
            <input
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              className="h-full w-[10rem] bg-transparent text-[12px] font-semibold text-ink-900 outline-none placeholder:font-normal placeholder:text-muted/70"
            />
          </div>
          <span className="ml-auto flex items-center gap-1 font-medium text-muted">
            <Icon name="Users" size={12} />
            {deptEmployees.length} {deptEmployees.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}
      <div
        ref={contentRef}
        className="relative inline-flex items-start gap-10"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {edges.map((e) => (
            <path key={e.key} d={elbowPath(e)} fill="none" stroke="#B7C2D0" strokeWidth={1.5} />
          ))}
        </svg>
        {rootItems.map((item) => {
          const id = item.kind === 'node' ? item.node.id : item.employee.id
          const controlled = hasRootAccordion
            ? { expanded: expandedRootId === 'all' || expandedRootId === id, setExpanded: (v: boolean) => setExpandedRootId(v ? id : null) }
            : undefined
          return <CanvasBranch key={id} item={item} depth={0} parentKey={null} controlled={controlled} />
        })}
        {rootItems.length === 0 && (
          domain === 'people' ? (
            // `data-canvas-ui` keeps onPointerDown from treating a press here as
            // a pan — otherwise the pointer capture it takes would swallow the
            // "Add Root Person" click and the button would do nothing.
            <div data-canvas-ui className="flex w-[280px] flex-col items-center gap-3 rounded-card border border-dashed border-line bg-white/60 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
                <Icon name="Users" size={20} />
              </div>
              <p className="text-sm font-medium text-ink-900">No reporting hierarchy found.</p>
              <p className="text-xs text-muted">
                {selectedDeptNode ? `${selectedDeptNode.name} has no people yet.` : 'Add a department first.'}
              </p>
              {selectedDeptNode && (
                <Button size="sm" variant="primary" onClick={() => ws.addEmployee(selectedDeptNode)}>
                  <Icon name="UserPlus" size={14} /> Add Root Person
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing to show yet.</p>
          )
        )}
      </div>

      <CanvasControls
        scale={transform.scale}
        onFit={viewport.fitToScreen}
        onZoomOut={() => viewport.zoomBy(0.85)}
        onZoomIn={() => viewport.zoomBy(1 / 0.85)}
        onReset={resetView}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        middleToggle={{
          active: canvas.showMetadata,
          onToggle: canvas.toggleShowMetadata,
          activeIcon: 'Eye',
          inactiveIcon: 'EyeOff',
          activeLabel: 'Hide metadata on cards',
          inactiveLabel: 'Show metadata on cards',
        }}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ConfirmDeleteDialog
        open={!!employeeToDelete}
        onClose={() => setEmployeeToDelete(null)}
        itemLabel={employeeToDeleteRecord?.name || 'this employee'}
        onConfirm={async () => {
          if (!employeeToDelete) return
          await removeEmployee.mutateAsync(employeeToDelete)
          ws.clearSelection()
        }}
      />
    </div>
  )
}
