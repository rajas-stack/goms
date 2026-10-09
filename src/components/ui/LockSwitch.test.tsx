import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LockSwitch } from './LockSwitch'

function Harness({ size }: { size?: 'md' | 'sm' }) {
  const [unlocked, setUnlocked] = useState(false)
  return <LockSwitch size={size} unlocked={unlocked} onToggle={() => setUnlocked(value => !value)} lockedLabel="Unlock editing" unlockedLabel="Lock editing" />
}

describe('LockSwitch', () => {
  it('compact size toggles with an accessible name, pressed state and tooltip but no text', async () => {
    render(<Harness size="sm" />)
    const toggle = screen.getByRole('button', { name: 'Unlock editing' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('title', 'Unlock editing')
    expect(toggle).toHaveClass('lock-switch--compact')
    expect(toggle.textContent).toBe('')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Lock editing' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lock editing' })).toHaveAttribute('title', 'Lock editing')
  })

  it('compact size is keyboard operable and respects disabled', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<LockSwitch size="sm" unlocked onToggle={onToggle} lockedLabel="Unlock" unlockedLabel="Lock" />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Lock' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Lock' })).toHaveAttribute('data-instant', 'true')
    rerender(<LockSwitch size="sm" unlocked onToggle={onToggle} lockedLabel="Unlock" unlockedLabel="Lock" disabled />)
    expect(screen.getByRole('button', { name: 'Lock' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('keeps the labelled pill as the default size', () => {
    render(<Harness />)
    const toggle = screen.getByRole('button', { name: 'Unlock editing' })
    expect(toggle).toHaveTextContent('Locked')
    expect(toggle).not.toHaveAttribute('title')
  })
})
