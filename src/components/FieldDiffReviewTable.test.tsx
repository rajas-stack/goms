import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldDiffReviewTable } from './FieldDiffReviewTable'

const row = { id: 'c1', label: 'submissionDeadline', currentValue: '15 Oct 2026 03:00 pm', proposedValue: '18 Oct 2026 03:00 pm' }

describe('FieldDiffReviewTable', () => {
  it('shows current vs proposed per row, and accepts a ticked row explicitly', async () => {
    const onAccept = vi.fn(); const onReject = vi.fn()
    render(<FieldDiffReviewTable rows={[row]} onAccept={onAccept} onReject={onReject} />)
    expect(screen.getByText('15 Oct 2026 03:00 pm')).toBeInTheDocument()
    expect(screen.getByText('18 Oct 2026 03:00 pm')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /accept change/i }))
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    expect(onAccept).toHaveBeenCalledWith('c1')
    expect(onReject).not.toHaveBeenCalled()
  })

  it('rejects rows that were not ticked', async () => {
    const onReject = vi.fn()
    render(<FieldDiffReviewTable rows={[row]} onAccept={vi.fn()} onReject={onReject} />)
    await userEvent.click(screen.getByRole('button', { name: /save 0 changes/i }))
    expect(onReject).toHaveBeenCalledWith('c1')
  })

  it('"Keep Existing Values" resets every row to not-accepted', async () => {
    const onAccept = vi.fn()
    render(<FieldDiffReviewTable rows={[row]} onAccept={onAccept} onReject={vi.fn()} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /accept change/i }))
    await userEvent.click(screen.getByRole('button', { name: /keep existing values/i }))
    await userEvent.click(screen.getByRole('button', { name: /save 0 changes/i }))
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('stops at the first failure and shows it, without applying later rows', async () => {
    const onAccept = vi.fn().mockRejectedValueOnce(new Error('"submissionDeadline" is protected — unfreeze it first.'))
    const onReject = vi.fn()
    render(<FieldDiffReviewTable rows={[row, { ...row, id: 'c2', label: 'tenderLink' }]} onAccept={onAccept} onReject={onReject} />)
    await userEvent.click(screen.getAllByRole('checkbox', { name: /accept change/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is protected')
    expect(onReject).not.toHaveBeenCalled()
  })

  it('shows an already-decided row read-only, with no checkbox', () => {
    render(<FieldDiffReviewTable rows={[{ ...row, decided: 'Accepted' }]} onAccept={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})
