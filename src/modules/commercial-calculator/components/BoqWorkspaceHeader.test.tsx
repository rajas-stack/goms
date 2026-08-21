import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoqWorkspaceHeader } from './BoqWorkspaceHeader'

describe('BoqWorkspaceHeader', () => {
  it('shows identity, live totals, and calls onPreview/saveDraft.onClick/submit.onClick', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onSaveDraft = vi.fn()
    const onSubmit = vi.fn()
    render(
      <BoqWorkspaceHeader
        boqNumber="BOQ-2026-000042" statusLabel="Draft" customerName="Acme Corp"
        lineCount={12} marginPct={18.4} grandTotal={482300} currencyCode="INR"
        onPreview={onPreview}
        saveDraft={{ onClick: onSaveDraft, label: 'Save Draft' }}
        submit={{ onClick: onSubmit, label: 'Submit' }}
      />,
    )
    expect(screen.getByText('BOQ-2026-000042')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('18.4%')).toBeInTheDocument()
    expect(screen.getAllByText((_, el) => (el?.textContent ?? '').includes((482300).toLocaleString())).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /preview/i }))
    expect(onPreview).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(onSaveDraft).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('omits Save Draft/Submit entirely when not supplied (frozen BOQ)', () => {
    render(
      <BoqWorkspaceHeader
        boqNumber="BOQ-2026-000042" statusLabel="Approved" customerName="Acme Corp"
        lineCount={12} marginPct={18.4} grandTotal={482300} currencyCode="INR" onPreview={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
  })

  it('shows "New BOQ" when boqNumber is null (pre-save)', () => {
    render(
      <BoqWorkspaceHeader
        boqNumber={null} statusLabel="Draft" customerName="" lineCount={0} marginPct={0} grandTotal={0} currencyCode="INR" onPreview={() => {}}
      />,
    )
    expect(screen.getByText('New BOQ')).toBeInTheDocument()
  })
})
