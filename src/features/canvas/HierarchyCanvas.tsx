import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasProvider, useCanvas, type Edge } from './canvasContext'
import { CanvasBranch, type CanvasItem } from './CanvasBranch'
import { DepartmentCombobox } from './DepartmentCombobox'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { rootReportsOf } from './reporting'
import {
  useBreadcrumb, useEmployee, useEmployeeMutations, useEmployeesByState, useEmployeesUnder, useNode, useOrgRoots,
  useStateNode,
} from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { cn, isTypingTarget } from '@/lib/utils'
import type { Domain } from '@/lib/types'

/** The canvas renders three logical views over the same generic engine: the
 *  org containment tree, the geo containment tree, and — reusing the same
 *  connected-card rendering — the people reporting hierarchy. */
export type CanvasView = Domain | 'people'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.8
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function elbowPath(e: Edge): string {
  const midY = (e.y1 + e.y2) / 2
  return `M ${e.x1} ${e.y1} V ${midY} H ${e.x2} V ${e.y2}`
}

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

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 40, y: 56, scale: 1 })
  const [edges, setEdges] = useState<Edge[]>([])
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const panRafRef = useRef<number | null>(null)
  const panPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // Two-finger pinch-to-zoom: Pointer Events already deliver a distinct
  // `pointerId` per touch point, so this just tracks every currently-down
  // pointer and, once 2 are active, treats their distance/midpoint as a
  // zoom gesture instead of a pan — mirroring `onWheel`'s ctrl-zoom centering
  // math (scale ratio applied around a fixed screen point) frame-to-frame
  // rather than against a single fixed start distance, so a pinch and a
  // two-finger drag can compose naturally.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number } | null>(null)
  const lastPeopleDeptRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const userInteractedRef = useRef(false)
  const activeKeyRef = useRef<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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

  const centerView = useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport || content.scrollWidth === 0) return false
    const vw = viewport.clientWidth
    const cw = content.scrollWidth
    setTransform({ x: (vw - cw) / 2, y: 56, scale: 1 })
    return true
  }, [])

  const fitToScreen = useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport || content.scrollWidth === 0 || content.scrollHeight === 0) return false
    userInteractedRef.current = true
    const pad = 48
    const vw = viewport.clientWidth - pad * 2
    const vh = viewport.clientHeight - pad * 2
    const cw = content.scrollWidth
    const ch = content.scrollHeight
    const scale = clamp(Math.min(vw / cw, vh / ch), MIN_ZOOM, MAX_ZOOM)
    setTransform({ x: (viewport.clientWidth - cw * scale) / 2, y: pad, scale })
    return true
  }, [])

  // Center + zoom the viewport on a single card (by canvas key). Used by the
  // Organization-view department search to bring the matched department into
  // view. `userInteractedRef` is flipped so the auto-center effect doesn't
  // immediately re-center on the whole tree.
  const centerOnCard = useCallback((key: string, scale = 1.1) => {
    const el = canvas.getCard(key)
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!el || !content || !viewport) return false
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
    setTransform({ scale, x: viewport.clientWidth / 2 - cx * scale, y: viewport.clientHeight / 2 - cy * scale })
    return true
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
    centerView()
  }, [version, domain, stateCode, selectedDeptId, expandedRootId, centerView])

  useLayoutEffect(() => {
    if (!contentRef.current) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [recompute])

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    userInteractedRef.current = true
    const rect = viewportRef.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setTransform((t) => {
        const next = clamp(t.scale * (1 - e.deltaY * 0.012), MIN_ZOOM, MAX_ZOOM)
        const ratio = next / t.scale
        return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
      })
    } else {
      setTransform((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }))
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-canvas-card], [data-canvas-ui]')) return
    userInteractedRef.current = true
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (pointersRef.current.size >= 2) {
      // A second finger just landed — hand off from single-finger pan (if
      // one was active) to pinch-zoom. `pinchRef` starts null so the next
      // move only baselines the start distance rather than jumping the zoom.
      dragRef.current = null
      setDragging(false)
      pinchRef.current = null
      return
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y }
    setDragging(true)
    // Prevents the details sidebar's text from being selected mid-drag, which
    // otherwise swaps in a text-selection cursor and can leave the pointer
    // looking "stuck" once the drag crosses back onto the canvas.
    document.body.classList.add('select-none')
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    if (pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (a.x + b.x) / 2 - rect.left
      const cy = (a.y + b.y) / 2 - rect.top
      if (!pinchRef.current) {
        // First move after the 2nd finger touches down — establish the
        // baseline distance only, same as a fresh `onPointerDown` origin.
        pinchRef.current = { dist }
        return
      }
      const factor = dist / pinchRef.current.dist
      pinchRef.current.dist = dist
      setTransform((t) => {
        const next = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM)
        const ratio = next / t.scale
        return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
      })
      return
    }
    if (!dragRef.current) return
    panPointRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (panRafRef.current != null) return
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null
      const point = panPointRef.current
      if (!point || !dragRef.current) return
      const dx = point.clientX - dragRef.current.startX
      const dy = point.clientY - dragRef.current.startY
      setTransform((t) => ({ ...t, x: dragRef.current!.originX + dx, y: dragRef.current!.originY + dy }))
    })
  }
  // Shared by pointerup, pointercancel AND lostpointercapture — capture can
  // be revoked by the browser mid-drag (e.g. a context menu, or crossing into
  // the details sidebar's own scrollable/focusable content), and without this
  // the drag state and cursor would be left stuck in "panning" indefinitely.
  // Deliberately NOT wired to pointerleave: capture is taken on pointerdown,
  // so pointerup still fires here even once the cursor has panned outside
  // the viewport's own bounds — ending on pointerleave would make panning
  // die the instant the cursor drifts past the edge, before the button is
  // released, and leave `select-none` stuck on <body> since it's the
  // pointerup/lostpointercapture path (not pointerleave) that was meant to
  // clear it.
  //
  // Also removes the ending pointer from the pinch-tracking map. Lifting one
  // finger out of a 2-finger pinch does NOT try to seamlessly resume a
  // single-finger pan — the remaining finger has to be released and pressed
  // again to start a fresh gesture. That's a deliberate simplification (see
  // the pinch-tracking comment above `pointersRef`): reconstructing a
  // no-jump single-finger pan origin from mid-gesture state is real added
  // complexity for a "mobile UX polish" task, and this still leaves pinch
  // and pan both fully working, just not chainable without a full release.
  function endPan(e?: React.PointerEvent) {
    if (e) pointersRef.current.delete(e.pointerId)
    else pointersRef.current.clear() // hard fallback (blur/visibilitychange): drop everything
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size > 0) return
    dragRef.current = null
    setDragging(false)
    document.body.classList.remove('select-none')
    if (panRafRef.current != null) {
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = null
    }
  }

  // Hard fallback for gestures the browser never delivers a pointerup for
  // (alt-tab away mid-drag) — without this, `dragging`/the grabbing cursor
  // and <body>'s select-none lock can stay stuck indefinitely.
  useEffect(() => {
    if (!dragging) return
    const stop = () => endPan()
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [dragging])

  function zoomBy(factor: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    userInteractedRef.current = true
    const cx = viewport.clientWidth / 2
    const cy = viewport.clientHeight / 2
    setTransform((t) => {
      const next = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = next / t.scale
      return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
    })
  }
  function resetView() {
    userInteractedRef.current = false
    centerView()
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
          e.preventDefault(); fitToScreen(); break
        case '+': case '=':
          e.preventDefault(); zoomBy(1 / 0.85); break
        case '-': case '_':
          e.preventDefault(); zoomBy(0.85); break
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
          if (ws.selection.kind === 'node' && selectedNode) ws.deleteNode(selectedNode)
          else if (ws.selection.kind === 'employee') removeEmployee.mutate(ws.selection.id)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.selection, selectedNode, removeEmployee, orgRoots, transform.scale])

  const rootItems: CanvasItem[] = domain === 'geo'
    ? (stateNode ? [{ kind: 'node', node: stateNode }] : [])
    : domain === 'org'
      ? orgRoots.map((n) => ({ kind: 'node', node: n }))
      : peopleRoots.map((e) => ({ kind: 'employee', employee: e }))

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
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
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

      <div data-canvas-ui className="pointer-events-none absolute bottom-5 right-5 flex flex-wrap items-center justify-end gap-1 rounded-xl border border-line bg-white/95 p-1 shadow-panel">
        <Tooltip label="Fit to screen (F)" className="pointer-events-auto">
          <button onClick={fitToScreen} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Fit to screen">
            <Icon name="Maximize" size={14} />
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Zoom out (−)" className="pointer-events-auto">
          <button onClick={() => zoomBy(0.85)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom out">
            <span className="text-base leading-none">−</span>
          </button>
        </Tooltip>
        <span className="pointer-events-auto w-11 text-center font-mono text-[11px] text-muted">{Math.round(transform.scale * 100)}%</span>
        <Tooltip label="Zoom in (+)" className="pointer-events-auto">
          <button onClick={() => zoomBy(1 / 0.85)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom in">
            <span className="text-base leading-none">+</span>
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Reset view (0)" className="pointer-events-auto">
          <button onClick={resetView} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Reset view">
            <Icon name="MoveRight" size={14} className="rotate-[225deg]" />
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Expand all (E)" className="pointer-events-auto">
          <button onClick={expandAll} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Expand all">
            <Icon name="ChevronsDown" size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Collapse all (C)" className="pointer-events-auto">
          <button onClick={collapseAll} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Collapse all">
            <Icon name="ChevronsUp" size={14} />
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label={canvas.showMetadata ? 'Hide metadata' : 'Show metadata'} className="pointer-events-auto">
          <button
            onClick={canvas.toggleShowMetadata}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg hover:bg-panel',
              canvas.showMetadata ? 'text-ink-900' : 'text-muted hover:text-ink-900',
            )}
            aria-label={canvas.showMetadata ? 'Hide metadata on cards' : 'Show metadata on cards'}
          >
            <Icon name={canvas.showMetadata ? 'Eye' : 'EyeOff'} size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Keyboard shortcuts (?)" className="pointer-events-auto">
          <button onClick={() => setShortcutsOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Keyboard shortcuts">
            <Icon name="Keyboard" size={14} />
          </button>
        </Tooltip>
      </div>

      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
