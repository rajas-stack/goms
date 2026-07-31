import { AnimatePresence } from 'framer-motion'
import { useWorkspace } from '@/features/workspace/context'
import { NodeDetails } from './NodeDetails'
import { EmployeeDetails } from './EmployeeDetails'
import { SalesPersonDetails } from './SalesPersonDetails'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'

/** `floatingClose`: shows a "Close details" ✕ pinned to the top-right corner,
 *  clearing the workspace selection on click — for the always-visible desktop
 *  `<aside>` (StateWorkspace/Directory), which otherwise has no way to
 *  deselect and go back to the empty state. Left off for `MobileDetailsSheet`,
 *  which already renders its own close button outside this panel. */
export function DetailsPanel({ floatingClose = false }: { floatingClose?: boolean } = {}) {
  const { selection, clearSelection } = useWorkspace()

  if (!selection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
          <Icon name="MoveRight" size={20} />
        </div>
        <p className="max-w-[220px] text-sm text-muted">
          Select a card in the org chart to see its details here.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {floatingClose && (
        <Tooltip label="Close details" side="left" className="absolute right-3 top-3 z-10">
          <button
            onClick={clearSelection}
            aria-label="Close details"
            className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-ink-900/[0.06] hover:text-ink"
          >
            <Icon name="X" size={15} />
          </button>
        </Tooltip>
      )}
      <AnimatePresence mode="wait">
        {selection.kind === 'node' ? (
          <NodeDetails key={selection.id} nodeId={selection.id} />
        ) : selection.kind === 'salesPerson' ? (
          <SalesPersonDetails key={selection.id} salesPersonId={selection.id} />
        ) : (
          <EmployeeDetails key={selection.id} employeeId={selection.id} />
        )}
      </AnimatePresence>
    </div>
  )
}
