import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineApprovalSummary } from './LineApprovalSummary'
import type { ApprovalMatrixRule, CommercialBoqLineItem } from '../types'

const approvalMatrix: ApprovalMatrixRule[] = [
  { id: 'a1', code: 'A1', name: 'Auto', description: '', active: true, displayOrder: 0, minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: 'None', allowAutoApproval: true },
  { id: 'a2', code: 'A2', name: 'Manager', description: '', active: true, displayOrder: 1, minDiscountPct: 10, maxDiscountPct: 100, approvalLevelLabel: 'Manager Approval', allowAutoApproval: false },
]

function line(overrides: Partial<CommercialBoqLineItem> = {}): CommercialBoqLineItem {
  return {
    id: 'l1', boqId: 'b1', skuId: 's1', quantity: 1, unitPrice: 1000, discountPct: 5, taxPct: 18,
    approverId: null, approvalDate: null, approvalRemarks: '', approvalStatus: 'auto_approved', lineTotal: 1000,
    pricingLevels: [], activePricingLevel: null,
    ...overrides,
  }
}

describe('LineApprovalSummary', () => {
  it('explains that no approval is required when auto-approved', () => {
    render(<LineApprovalSummary line={line({ discountPct: 5, approvalStatus: 'auto_approved' })} approvalMatrix={approvalMatrix} />)
    expect(screen.getByText(/no approval required/i)).toBeInTheDocument()
    expect(screen.getByText(/5\.0%/)).toBeInTheDocument()
  })

  it('explains that approval is required, naming the band, when pending', () => {
    render(<LineApprovalSummary line={line({ discountPct: 20, approvalStatus: 'pending' })} approvalMatrix={approvalMatrix} />)
    expect(screen.getByText(/approval required/i)).toBeInTheDocument()
    expect(screen.getByText(/manager approval/i)).toBeInTheDocument()
  })

  it('shows the recorded approver/remarks once a decision has been made', () => {
    render(<LineApprovalSummary line={line({ discountPct: 20, approvalStatus: 'approved', approvalRemarks: 'Looks fine' })} approvalMatrix={approvalMatrix} />)
    expect(screen.getByText(/looks fine/i)).toBeInTheDocument()
  })
})
