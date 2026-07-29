import { useAllEmployees } from '@/lib/api'
import { WorkspaceProvider } from '@/features/workspace/context'
import { PeopleDirectory } from '@/features/directory/PeopleDirectory'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { MobileDetailsSheet } from './StateWorkspace'

/** Global cross-state phonebook. Reuses the same workspace context, details
 *  panel, and phonebook list the state workspace's People tab uses — this
 *  page just scopes the list to every employee instead of one state. */
export function Directory() {
  const { data: employees = [] } = useAllEmployees()

  return (
    <WorkspaceProvider stateCode={-1}>
      <div className="flex h-full flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
          <div className="z-10 border-b border-line bg-white/80 px-4 py-3">
            <h1 className="font-display text-[15px] font-semibold leading-tight text-ink-900">Directory</h1>
            <p className="text-[12px] text-muted">Every employee across every state</p>
          </div>
          <div className="relative min-h-0 flex-1">
            <PeopleDirectory employees={employees} />
          </div>
        </div>

        <aside className="hidden min-h-0 w-[400px] shrink-0 overflow-y-auto scrollbar-thin bg-paper lg:block">
          <DetailsPanel />
        </aside>

        <MobileDetailsSheet />
      </div>
    </WorkspaceProvider>
  )
}
