import { AnimatePresence } from 'framer-motion'
import { useWorkspace } from '@/features/workspace/context'
import { NodeDetails } from './NodeDetails'
import { EmployeeDetails } from './EmployeeDetails'
import { SalesPersonDetails } from './SalesPersonDetails'
import { Icon } from '@/components/ui/Icon'

export function DetailsPanel() {
  const { selection } = useWorkspace()

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
    <AnimatePresence mode="wait">
      {selection.kind === 'node' ? (
        <NodeDetails key={selection.id} nodeId={selection.id} />
      ) : selection.kind === 'salesPerson' ? (
        <SalesPersonDetails key={selection.id} salesPersonId={selection.id} />
      ) : (
        <EmployeeDetails key={selection.id} employeeId={selection.id} />
      )}
    </AnimatePresence>
  )
}
