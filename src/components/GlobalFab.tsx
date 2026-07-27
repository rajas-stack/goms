import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { useShell } from '@/app/AppLayout'
import {
  enqueueWorkspaceAction, invokeWorkspaceAddEmployee, invokeWorkspaceCreateChild, invokeWorkspaceCreateDepartment,
  registerFabOverlayHandle, type WorkspaceCreateAction,
} from '@/features/workspace/backButtonBridge'
import { StatePicker } from '@/features/workspace/StatePicker'
import { OrgTargetPicker } from '@/features/organization/OrgTargetPicker'
import { TimelineEventDialog } from '@/features/employees/TimelineEventDialog'
import { MANUAL_EVENT_TYPES } from '@/lib/timeline-meta'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

// Every variant has its own single-literal `kind` (rather than sharing one
// `kind` field typed as a union of several literals) specifically so
// `Extract<FabItem, { kind: ... }>` below narrows correctly — a discriminant
// field typed as a multi-literal union isn't assignable into a narrower
// `{ kind: 'x' | 'y' }` shape, so `Extract` would silently drop it otherwise.
type FabItem =
  | { id: string; label: string; icon: string; kind: 'import' }
  | { id: string; label: string; icon: string; kind: 'meeting' }
  | { id: string; label: string; icon: string; kind: 'event' }
  | { id: string; label: string; icon: string; kind: 'department' }
  | { id: string; label: string; icon: string; kind: 'person' }
  | { id: string; label: string; icon: string; kind: 'orgChild'; childKey: string }

// 9 items, flat and unordered (no context-aware reordering; that's
// explicitly out of scope here). "Create Location" (geo domain) was removed
// per explicit request — no `GeoTargetPicker`/`pick-geo` flow step remains.
const MENU: FabItem[] = [
  { id: 'import', label: 'Import Records', icon: 'Upload', kind: 'import' },
  { id: 'meeting', label: 'Create Meeting', icon: 'Users', kind: 'meeting' },
  { id: 'event', label: 'Log Interaction', icon: 'CalendarClock', kind: 'event' },
  { id: 'unit', label: 'Create Unit', icon: 'Boxes', kind: 'orgChild', childKey: 'unit' },
  { id: 'office', label: 'Create Office', icon: 'DoorOpen', kind: 'orgChild', childKey: 'office' },
  { id: 'division', label: 'Create Division', icon: 'Layers', kind: 'orgChild', childKey: 'division' },
  { id: 'branch', label: 'Create Branch', icon: 'GitBranch', kind: 'orgChild', childKey: 'branch' },
  { id: 'person', label: 'Create Person', icon: 'UserPlus', kind: 'person' },
  { id: 'department', label: 'Create Department', icon: 'Building2', kind: 'department' },
]

const NON_MEETING_TYPES = MANUAL_EVENT_TYPES.filter((t) => t !== 'meeting')

type Flow =
  | { step: 'closed' }
  | { step: 'pick-state'; item: FabItem }
  | { step: 'pick-org'; stateCode: number; item: Extract<FabItem, { kind: 'orgChild' | 'person' }> }

/** Resolves the state a `/state/:code` (or `/state/:code/...`) URL is
 *  currently on, used only to pre-fill the state-picker's default selection
 *  as a convenience — the picker itself is always shown (see `onItemClick`),
 *  never skipped, so State vs. Central Ministries stays an explicit choice
 *  every time. `/directory`'s sentinel workspace isn't a real state, so it
 *  deliberately does NOT match here — the picker opens with nothing
 *  pre-filled in that case. */
function stateCodeFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/state\/(-?\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Global "+" entry point, present on every screen (mounted once in
 *  `AppLayout`). Every create it offers ends up calling the exact same
 *  dialog/mutation an existing contextual trigger already uses — see
 *  `backButtonBridge.ts` for how `createChild`/`createDepartment`/
 *  `addEmployee` get invoked on whichever `WorkspaceProvider` is mounted (or
 *  queued for the one about to mount after a navigate). */
export function GlobalFab() {
  const location = useLocation()
  const navigate = useNavigate()
  const { openImport } = useShell()
  const [menuOpen, setMenuOpen] = useState(false)
  const [flow, setFlow] = useState<Flow>({ step: 'closed' })
  const [timelineKind, setTimelineKind] = useState<'meeting' | 'event' | null>(null)

  function runAction(stateCode: number, action: WorkspaceCreateAction) {
    let ok = false
    if (action.action === 'createChild') ok = invokeWorkspaceCreateChild(stateCode, action.parent, action.initialTypeKey)
    else if (action.action === 'createDepartment') ok = invokeWorkspaceCreateDepartment(stateCode)
    else if (action.action === 'addEmployee') ok = invokeWorkspaceAddEmployee(stateCode, action.orgNode)
    if (!ok) {
      enqueueWorkspaceAction({ stateCode, ...action })
      navigate(`/state/${stateCode}`)
    }
    setFlow({ step: 'closed' })
  }

  function proceedWithState(item: FabItem, stateCode: number) {
    if (item.kind === 'department') { runAction(stateCode, { action: 'createDepartment' }); return }
    if (item.kind === 'orgChild' || item.kind === 'person') { setFlow({ step: 'pick-org', stateCode, item }); return }
  }

  function onItemClick(item: FabItem) {
    setMenuOpen(false)
    if (item.kind === 'import') { openImport(); return }
    if (item.kind === 'meeting' || item.kind === 'event') { setTimelineKind(item.kind); return }
    setFlow({ step: 'pick-state', item })
  }

  function onOrgPick(node: HierNode) {
    if (flow.step !== 'pick-org') return
    if (flow.item.kind === 'person') runAction(flow.stateCode, { action: 'addEmployee', orgNode: node })
    else runAction(flow.stateCode, { action: 'createChild', parent: node, initialTypeKey: flow.item.childKey })
  }

  const orgPickerTitle = flow.step === 'pick-org'
    ? (flow.item.kind === 'person' ? 'Post the new person under…' : `Pick a parent for the new ${flow.item.childKey}`)
    : ''
  const orgPickLabel = (node: HierNode) => flow.step === 'pick-org'
    ? (flow.item.kind === 'person' ? `Post here (${node.name})` : `Add ${flow.item.childKey} here`)
    : ''

  // Live-state refs for the back-button bridge below — read at call time
  // (whenever the hardware back button fires), never captured stale, since
  // the registration effect itself only runs once (mirrors the identical
  // pattern `AppLayout.tsx` uses for its own search/import/drawer refs).
  const menuOpenRef = useRef(menuOpen)
  menuOpenRef.current = menuOpen
  const flowRef = useRef(flow)
  flowRef.current = flow
  const timelineKindRef = useRef(timelineKind)
  timelineKindRef.current = timelineKind

  useEffect(() => {
    registerFabOverlayHandle({
      isOpen: () => menuOpenRef.current || flowRef.current.step !== 'closed' || timelineKindRef.current !== null,
      // Closes exactly one layer per call, topmost/most-recently-opened
      // first — mirrors Escape's dialog-first semantics elsewhere in the
      // app. A picker step and the menu itself are never open at the same
      // time in practice (opening a picker always closes the menu first),
      // but the ordering below is still correct if that ever changes.
      close: () => {
        if (timelineKindRef.current !== null) { setTimelineKind(null); return }
        if (flowRef.current.step !== 'closed') { setFlow({ step: 'closed' }); return }
        if (menuOpenRef.current) setMenuOpen(false)
      },
    })
    return () => registerFabOverlayHandle(null)
  }, [])

  return (
    <>
      <div className="fixed bottom-20 right-4 z-[42] flex flex-col items-end gap-2 lg:bottom-8 lg:right-8">
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              className="flex max-h-[70vh] w-60 flex-col gap-1 overflow-y-auto scrollbar-thin rounded-2xl border border-line bg-paper p-1.5 shadow-pop"
              role="menu"
              aria-label="Create"
            >
              {MENU.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => onItemClick(item)}
                  className="flex h-11 items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium text-ink hover:bg-ink-900/[0.05]"
                >
                  <Icon name={item.icon} size={16} className="shrink-0 text-muted" />
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close create menu' : 'Create new'}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-paper shadow-pop transition-colors hover:bg-ink-800 active:scale-[0.97]',
          )}
        >
          <motion.span animate={{ rotate: menuOpen ? 135 : 0 }} transition={{ duration: 0.18 }}>
            <Icon name="Plus" size={24} />
          </motion.span>
        </button>
      </div>

      <StatePicker
        open={flow.step === 'pick-state'}
        title={flow.step === 'pick-state' ? flow.item.label : ''}
        defaultCode={stateCodeFromPath(location.pathname) ?? undefined}
        onPick={(stateCode) => { if (flow.step === 'pick-state') proceedWithState(flow.item, stateCode) }}
        onClose={() => setFlow({ step: 'closed' })}
      />

      <OrgTargetPicker
        open={flow.step === 'pick-org'}
        stateCode={flow.step === 'pick-org' ? flow.stateCode : -1}
        title={orgPickerTitle}
        requireChildType={flow.step === 'pick-org' && flow.item.kind === 'orgChild' ? flow.item.childKey : undefined}
        pickLabel={orgPickLabel}
        onPick={onOrgPick}
        onClose={() => setFlow({ step: 'closed' })}
      />

      <TimelineEventDialog
        open={timelineKind !== null}
        employeeId={null}
        initialType={timelineKind === 'meeting' ? 'meeting' : 'call'}
        typeFilter={timelineKind === 'meeting' ? ['meeting'] : NON_MEETING_TYPES}
        onClose={() => setTimelineKind(null)}
      />
    </>
  )
}
