import { OPPORTUNITY_CODE_PLACEHOLDER, formatOpportunityCode, opportunityCodePrefix } from '@goms/domain'
import { useDepartments } from '@/lib/api'

export interface OpportunityCodePreviewDepartment {
  name: string
  shortName?: string | null
  stateCode: number | null
}

/** Live preview of the Opportunity ID a create form will produce, e.g.
 *  `FY27-Q2-DF-WEST-GJ-DST-RFP-DL-#` — built by the same domain function the
 *  save path uses, with `#` standing in for the sequence number, which is
 *  only assigned on save. Pass `department` directly when it is not (yet) a
 *  saved node (Create Bid's "new department"); otherwise `departmentId` is
 *  looked up in the live department list. */
export function OpportunityCodePreview({ departmentId, department, submissionDate, vertical, opportunityType, component }: {
  departmentId?: string | null
  department?: OpportunityCodePreviewDepartment | null
  submissionDate?: string
  vertical?: string
  opportunityType?: string
  component?: string[]
}) {
  const { data: departments = [] } = useDepartments()
  const node = !department && departmentId ? departments.find((d) => d.id === departmentId) : undefined
  const dept = department ?? (node ? { name: node.name, shortName: node.metadata?.shortName, stateCode: node.stateCode } : null)
  const code = formatOpportunityCode(opportunityCodePrefix({
    submissionDate, createdAt: null, vertical, opportunityType, component,
    stateCode: dept?.stateCode ?? null,
    department: dept ? { name: dept.name, shortName: dept.shortName } : null,
  }), OPPORTUNITY_CODE_PLACEHOLDER)

  return (
    <div className="rounded-lg border border-dashed border-line bg-panel/60 px-3 py-2" aria-live="polite">
      <span className="block text-[13px] font-medium text-ink-800">Opportunity ID</span>
      <code data-testid="opportunity-code-preview" className="mt-0.5 block break-all font-mono text-sm font-semibold text-goms-navy">
        {code}
      </code>
      <span className="mt-0.5 block text-xs text-muted">Number assigned on save — the ID never changes afterwards.</span>
    </div>
  )
}
