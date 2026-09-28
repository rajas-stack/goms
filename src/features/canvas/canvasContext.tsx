import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Employee, HierNode } from '@/lib/types'

export interface Edge {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export function elbowPath(e: Edge): string {
  const midY = (e.y1 + e.y2) / 2
  return `M ${e.x1} ${e.y1} V ${midY} H ${e.x2} V ${e.y2}`
}

/** The item currently being dragged on the canvas (drag-and-drop reorg). */
export type DragPayload =
  | { key: string; kind: 'node'; node: HierNode }
  | { key: string; kind: 'employee'; employee: Employee }

interface CanvasCtx {
  setCardRef: (key: string, el: HTMLElement | null) => void
  getCard: (key: string) => HTMLElement | undefined
  setParent: (key: string, parentKey: string) => void
  clearParent: (key: string) => void
  computeEdges: (root: HTMLElement | null) => Edge[]
  /** Root cards (depth 0) default open; everything deeper defaults closed —
   *  unless a bulk Expand All / Collapse All is active or the user toggled
   *  this specific card, either of which wins over the depth default. */
  isExpanded: (key: string, depth: number) => boolean
  setNodeExpanded: (key: string, depth: number, value: boolean) => void
  setAllExpanded: (value: boolean) => void
  showMetadata: boolean
  toggleShowMetadata: () => void
  /** Drag-and-drop reorganization state. */
  dragPayload: DragPayload | null
  setDragPayload: (p: DragPayload | null) => void
  overKey: string | null
  setOverKey: (k: string | null) => void
  /** Employee id of the current department's head (People view), so their
   *  card can be flagged unambiguously wherever it renders in the tree. */
  deptHeadId: string | null
  setDeptHeadId: (id: string | null) => void
}

const Ctx = createContext<CanvasCtx | null>(null)
export const useCanvas = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCanvas outside CanvasProvider')
  return v
}

function localRect(el: HTMLElement, root: HTMLElement) {
  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  let guard = 0
  while (node && node !== root && guard < 200) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
    guard += 1
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight }
}

/** Tracks card DOM refs + parent/child key pairs so the top-level canvas can
 *  draw connector lines without every branch needing the global layout. */
export function CanvasProvider({ children, onChange }: { children: ReactNode; onChange: () => void }) {
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const parentRefs = useRef(new Map<string, string>())
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [allExpanded, setAllExpandedState] = useState<boolean | null>(null)
  const [showMetadata, setShowMetadata] = useState(false)
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [deptHeadId, setDeptHeadId] = useState<string | null>(null)

  const setCardRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(key, el)
    else cardRefs.current.delete(key)
    onChange()
  }, [onChange])

  const getCard = useCallback((key: string) => cardRefs.current.get(key), [])

  const isExpanded = useCallback((key: string, depth: number) => {
    if (key in overrides) return overrides[key]
    if (allExpanded !== null) return allExpanded
    return depth === 0
  }, [overrides, allExpanded])

  const setNodeExpanded = useCallback((key: string, _depth: number, value: boolean) => {
    setOverrides((o) => ({ ...o, [key]: value }))
  }, [])

  const setAllExpanded = useCallback((value: boolean) => {
    setAllExpandedState(value)
    setOverrides({})
  }, [])

  const toggleShowMetadata = useCallback(() => setShowMetadata((v) => !v), [])

  const setParent = useCallback((key: string, parentKey: string) => {
    parentRefs.current.set(key, parentKey)
    onChange()
  }, [onChange])

  const clearParent = useCallback((key: string) => {
    parentRefs.current.delete(key)
    onChange()
  }, [onChange])

  const computeEdges = useCallback((root: HTMLElement | null): Edge[] => {
    if (!root) return []
    const edges: Edge[] = []
    parentRefs.current.forEach((parentKey, childKey) => {
      const parentEl = cardRefs.current.get(parentKey)
      const childEl = cardRefs.current.get(childKey)
      if (!parentEl || !childEl) return
      const p = localRect(parentEl, root)
      const c = localRect(childEl, root)
      edges.push({
        key: `${parentKey}->${childKey}`,
        x1: p.x + p.width / 2,
        y1: p.y + p.height,
        x2: c.x + c.width / 2,
        y2: c.y,
      })
    })
    return edges
  }, [])

  const value = useMemo(
    () => ({
      setCardRef, getCard, setParent, clearParent, computeEdges,
      isExpanded, setNodeExpanded, setAllExpanded, showMetadata, toggleShowMetadata,
      dragPayload, setDragPayload, overKey, setOverKey, deptHeadId, setDeptHeadId,
    }),
    [setCardRef, getCard, setParent, clearParent, computeEdges, isExpanded, setNodeExpanded, setAllExpanded, showMetadata, toggleShowMetadata, dragPayload, overKey, deptHeadId],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
