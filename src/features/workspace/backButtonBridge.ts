import type { HierNode } from '@/lib/types'

/**
 * `WorkspaceProvider` is mounted *inside* specific routes (`Directory`,
 * `StateWorkspace`), while some `AppLayout`-level code needs to reach
 * whichever one happens to be mounted — an *ancestor* of those routes in the
 * router tree. React context only flows downward, so `AppLayout` has no way
 * to call `useWorkspace()` directly.
 *
 * This tiny module-level bridge lets whichever `WorkspaceProvider` is
 * currently mounted register itself, so `AppLayout`-level code can query/act
 * on it without threading props back up through the router. At most one
 * `WorkspaceProvider` is ever mounted at a time (only one route is active),
 * so a single module-level slot is sufficient. Two independent consumers use
 * this slot today:
 *
 *  - The Android hardware back-button handler (original use) — checks/closes
 *    whatever workspace dialog is open, via `isWorkspaceDialogOpen`/
 *    `closeWorkspaceDialog`.
 *  - The global "+" FAB (`GlobalFab.tsx`) — triggers the exact same
 *    `createChild`/`createDepartment`/`addEmployee` a contextual "+" would,
 *    via `invokeWorkspace*` below, when a `WorkspaceProvider` for the target
 *    state already happens to be mounted. When it isn't (the FAB was used
 *    from a stateless screen, or a different state's workspace), the FAB
 *    instead enqueues a `PendingWorkspaceAction` and navigates to
 *    `/state/:code`; the freshly-mounted `WorkspaceProvider` for that state
 *    consumes (and clears) exactly one pending action meant for it.
 */
interface WorkspaceDialogHandle {
  isOpen: () => boolean
  close: () => void
  /** Always reads the *live* value — the same provider instance can persist
   *  across a stateCode change (e.g. route param update without unmount). */
  stateCode: () => number
  createChild: (parent: HierNode, initialTypeKey?: string) => void
  createDepartment: () => void
  addEmployee: (orgNode: HierNode) => void
}

let active: WorkspaceDialogHandle | null = null

export function registerWorkspaceDialogHandle(handle: WorkspaceDialogHandle | null) {
  active = handle
}

export function isWorkspaceDialogOpen(): boolean {
  return active?.isOpen() ?? false
}

export function closeWorkspaceDialog() {
  active?.close()
}

/** True + runs immediately when a `WorkspaceProvider` for exactly this state
 *  is currently mounted; false (does nothing) otherwise, so the caller can
 *  fall back to the navigate + enqueue path below. */
export function invokeWorkspaceCreateChild(stateCode: number, parent: HierNode, initialTypeKey?: string): boolean {
  if (!active || active.stateCode() !== stateCode) return false
  active.createChild(parent, initialTypeKey)
  return true
}

export function invokeWorkspaceCreateDepartment(stateCode: number): boolean {
  if (!active || active.stateCode() !== stateCode) return false
  active.createDepartment()
  return true
}

export function invokeWorkspaceAddEmployee(stateCode: number, orgNode: HierNode): boolean {
  if (!active || active.stateCode() !== stateCode) return false
  active.addEmployee(orgNode)
  return true
}

// --- Pending action queue -------------------------------------------------
// Supports exactly the 3 create actions the FAB needs to run once its target
// state's `WorkspaceProvider` mounts (editNode/moveNode/deleteNode are never
// FAB-triggered, so they have no place here).
export type WorkspaceCreateAction =
  | { action: 'createChild'; parent: HierNode; initialTypeKey?: string }
  | { action: 'createDepartment' }
  | { action: 'addEmployee'; orgNode: HierNode }

export type PendingWorkspaceAction = WorkspaceCreateAction & { stateCode: number }

let pending: PendingWorkspaceAction | null = null

export function enqueueWorkspaceAction(action: PendingWorkspaceAction) {
  pending = action
}

/** Called by a `WorkspaceProvider` whenever its own `stateCode` is set
 *  (mount, or a param change on a persisted instance) to consume-and-clear
 *  exactly one pending action meant for that state. Returns `null` (no-op)
 *  if nothing is queued or the queued action targets a different state, so
 *  it's safe to call unconditionally — no double-fire, since a consumed
 *  action is cleared immediately. */
export function consumePendingWorkspaceAction(stateCode: number): PendingWorkspaceAction | null {
  if (!pending || pending.stateCode !== stateCode) return null
  const p = pending
  pending = null
  return p
}
