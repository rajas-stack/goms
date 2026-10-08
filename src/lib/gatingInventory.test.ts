import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GATED = new Set([
  'app/routes/TeamsWorkspace.tsx', 'features/canvas/CanvasBranch.tsx', 'features/canvas/HierarchyCanvas.tsx',
  'features/details/EmployeeDetails.tsx', 'features/details/NodeDetails.tsx', 'features/details/SalesPersonDetails.tsx',
  'features/employees/ChargeDialog.tsx', 'features/employees/EmployeeFormDialog.tsx', 'features/employees/MarkDuplicateDialog.tsx',
  'features/employees/MergeEmployeesDialog.tsx', 'features/employees/SelectEmployeeDialog.tsx', 'features/employees/TimelineEventDialog.tsx',
  'features/employees/TransferDialog.tsx', 'features/employees/VisitingCard.tsx', 'features/import/ImportDialog.tsx',
  'features/nodes/ConfirmDialog.tsx', 'features/nodes/MoveDialog.tsx', 'features/nodes/NodeFormDialog.tsx', 'features/nodes/WorksEditor.tsx',
  'features/org/OrgEmployees.tsx', 'features/sales/AssignOwnerDialog.tsx', 'features/sales/EditPostingDatesDialog.tsx',
  'features/sales/SalesPersonFormDialog.tsx', 'features/sales/TransferBookOfBusinessDialog.tsx', 'features/sales/TransferSalesPersonDialog.tsx',
  'modules/admin-access/AccessManagement.tsx',
  'modules/bid-tracker/BidDetailWorkspace.tsx', 'modules/bid-tracker/GridSheet.tsx',
  'modules/bid-tracker/components/AddCustomColumnDialog.tsx', 'modules/bid-tracker/components/CorrigendumReviewDialog.tsx',
  'modules/bid-tracker/components/CreateBidDialog.tsx', 'modules/bid-tracker/components/CreateCorrigendumDialog.tsx',
  'modules/bid-tracker/components/CreateSavedViewDialog.tsx', 'modules/bid-tracker/components/ManageColumnsPanel.tsx',
  'modules/bid-tracker/components/MasterGrid.tsx', 'modules/bid-tracker/pages/CommercialAndFilesTab.tsx',
  'modules/bid-tracker/pages/MilestonesTab.tsx', 'modules/bid-tracker/pages/OverviewTab.tsx', 'modules/bid-tracker/pages/ProtectedValuesTab.tsx',
  'modules/commercial-calculator/components/MasterCrudScreen.tsx', 'modules/commercial-calculator/components/SkuBomEditor.tsx',
  'modules/commercial-calculator/pages/CreateBoq.tsx', 'modules/commercial-calculator/pages/HierarchyView.tsx',
  'modules/commercial-calculator/pages/ProposalDetail.tsx', 'modules/commercial-calculator/pages/SkuCatalog.tsx',
])

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* tsx(p)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) yield p
  }
}

describe('gating inventory', () => {
  it('every screen that calls a *Mutations hook is in the gated list and actually uses permissions', () => {
    const root = join(__dirname, '..')
    const missing: string[] = []
    const ungated: string[] = []
    for (const file of tsx(root)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, '/')
      const src = readFileSync(file, 'utf8')
      if (!/use[A-Za-z]+Mutations?\(/.test(src)) continue
      if (!GATED.has(rel)) missing.push(rel)
      else if (!/usePermissions|useAllowed|<Can\b|canEditCell/.test(src)) ungated.push(rel)
    }
    expect(missing).toEqual([])
    expect(ungated).toEqual([]) // fails until each listed screen consults permissions
  })
})
