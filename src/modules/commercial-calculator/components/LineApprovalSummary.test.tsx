import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LineApprovalSummary } from './LineApprovalSummary'
import type { ApprovalMatrixRule, CommercialBoqLineItem } from '../types'
import type { Employee } from '@/lib/types'

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

  it('does not render decision controls when employees/onDecide are not provided, even if pending', () => {
    render(<LineApprovalSummary line={line({ discountPct: 20, approvalStatus: 'pending' })} approvalMatrix={approvalMatrix} />)
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('renders approver/remarks/Approve/Reject when pending and employees/onDecide are provided', async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    const employees = [{ id: 'e1', name: 'Jane Doe', designation: 'Manager' }] as Employee[]
    render(
      <LineApprovalSummary
        line={line({ id: 'l9', discountPct: 20, approvalStatus: 'pending' })}
        approvalMatrix={approvalMatrix}
        employees={employees}
        onDecide={onDecide}
      />,
    )
    await user.selectOptions(screen.getByLabelText(/approver/i), 'e1')
    await user.type(screen.getByLabelText(/remarks/i), 'Looks good')
    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(onDecide).toHaveBeenCalledWith('l9', 'approved', 'e1', 'Looks good')
  })

  it('disables Approve/Reject until an approver is selected', () => {
    const employees = [{ id: 'e1', name: 'Jane Doe', designation: 'Manager' }] as Employee[]
    render(
      <LineApprovalSummary
        line={line({ discountPct: 20, approvalStatus: 'pending' })}
        approvalMatrix={approvalMatrix}
        employees={employees}
        onDecide={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled()
  })

  it('does not render decision controls for an already-decided line even when employees/onDecide are provided', () => {
    render(
      <LineApprovalSummary
        line={line({ discountPct: 20, approvalStatus: 'approved' })}
        approvalMatrix={approvalMatrix}
        employees={[]}
        onDecide={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
