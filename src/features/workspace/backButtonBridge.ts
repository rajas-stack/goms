/**
 * `WorkspaceProvider` is mounted *inside* specific routes (`Directory`,
 * `StateWorkspace`), while the Android hardware back-button listener lives
 * in `AppLayout` — an *ancestor* of those routes in the router tree. React
 * context only flows downward, so `AppLayout` has no way to call
 * `useWorkspace()` to check whether a workspace dialog (create/edit/move/
 * delete node, add/edit employee) is currently open.
 *
 * This tiny module-level bridge lets whichever `WorkspaceProvider` is
 * currently mounted register its live dialog state, so the back-button
 * handler can query and close it without threading props back up through
 * the router. At most one `WorkspaceProvider` is ever mounted at a time
 * (only one route is active), so a single module-level slot is sufficient.
 */
interface WorkspaceDialogHandle {
  isOpen: () => boolean
  close: () => void
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
