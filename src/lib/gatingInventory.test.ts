import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GATED = new Set([
  'features/competitors/CompetitorsSection.tsx', 'features/departments/AmnexDepartmentsSection.tsx',
  'features/employees/MeetingDepartmentDialog.tsx', 'features/employees/MeetingPersonDialog.tsx',
  'features/tender-websites/TenderWebsitesSection.tsx',
  'modules/bid-tracker/attachments/BidAttachmentsSection.tsx',
  'modules/bid-tracker/corrigenda/CorrigendaSection.tsx', 'modules/bid-tracker/synopsis/GeneralTab.tsx',
  'modules/rbac-tree/RolesAccessPage.tsx',
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

// These mutation controls inherit the permission decision from their owning screen.
const INHERITED_GATES = {
  'modules/bid-tracker/attachments/AttachmentUploadForm.tsx': {
    parent: 'modules/bid-tracker/attachments/BidAttachmentsSection.tsx', gate: /open && canUpload && <AttachmentUploadForm/,
  },
  'modules/bid-tracker/corrigenda/EditRegisterDialog.tsx': {
    parent: 'modules/bid-tracker/corrigenda/CorrigendaSection.tsx', gate: /onEditRegister=\{canEditRegister \?/, state: /editing && selected && <EditRegisterDialog/,
  },
  'modules/bid-tracker/corrigenda/RecordCorrigendumDialog.tsx': {
    parent: 'modules/bid-tracker/corrigenda/CorrigendaSection.tsx', gate: /disabled=\{!canCreate\}/, state: /recording &&/,
  },
  'modules/rbac-tree/SubjectEditor.tsx': {
    parent: 'modules/rbac-tree/RolesAccessPage.tsx', gate: /canEdit=\{canEdit\}/, state: /useIsSystemAdmin\(subjects.isSuccess\)/,
  },
  'modules/rbac-tree/SubjectActions.tsx': {
    parent: 'modules/rbac-tree/SubjectEditor.tsx', gate: /<SubjectActions[^>]*canEdit=\{canEdit\}/,
  },
} satisfies Record<string, { parent: string; gate: RegExp; state?: RegExp }>

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
      const inherited = INHERITED_GATES[rel as keyof typeof INHERITED_GATES]
      if (inherited) {
        const parent = readFileSync(join(root, inherited.parent), 'utf8')
        expect(parent, `${rel}: parent permission gate`).toMatch(inherited.gate)
        if ('state' in inherited) expect(parent, `${rel}: gated state`).toMatch(inherited.state)
        continue
      }
      if (!GATED.has(rel)) missing.push(rel)
      else if (!/usePermissions|useAllowed|useIsSystemAdmin|<Can\b|canEditCell/.test(src)) ungated.push(rel)
    }
    expect(missing).toEqual([])
    expect(ungated).toEqual([]) // fails until each listed screen consults permissions
  })
})
