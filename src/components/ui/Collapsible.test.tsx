import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Collapsible } from './Collapsible'

describe('Collapsible', () => {
  it('renders open by default when defaultOpen is true', () => {
    render(<Collapsible title="Section"><p>Body content</p></Collapsible>)
    expect(screen.getByText('Body content')).toBeVisible()
  })

  it('renders closed by default when defaultOpen is false', () => {
    render(<Collapsible title="Section" defaultOpen={false}><p>Body content</p></Collapsible>)
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()
  })

  it('toggles open/closed on click without losing children state', async () => {
    const user = userEvent.setup()
    render(<Collapsible title="Section" defaultOpen={false}><p>Body content</p></Collapsible>)
    await user.click(screen.getByRole('button', { name: /section/i }))
    await waitFor(() => expect(screen.getByText('Body content')).toBeVisible())
    await user.click(screen.getByRole('button', { name: /section/i }))
    await waitFor(() => expect(screen.queryByText('Body content')).not.toBeInTheDocument())
  })

  it('is controlled when open/onOpenChange are supplied — clicking calls onOpenChange instead of toggling itself', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Collapsible title="Section" open={false} onOpenChange={onOpenChange}><p>Body content</p></Collapsible>,
    )
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /section/i }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    // The click alone must not have opened it — only the controlling parent re-rendering with open=true does.
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()
    rerender(<Collapsible title="Section" open={true} onOpenChange={onOpenChange}><p>Body content</p></Collapsible>)
    await waitFor(() => expect(screen.getByText('Body content')).toBeVisible())
  })
})
