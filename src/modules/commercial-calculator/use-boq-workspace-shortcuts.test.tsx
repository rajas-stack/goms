import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useBoqWorkspaceShortcuts } from './use-boq-workspace-shortcuts'

function Host({ onSave, onEscape }: { onSave?: () => void; onEscape?: () => void }) {
  useBoqWorkspaceShortcuts({ onSave, onEscape })
  return <input aria-label="host input" />
}

describe('useBoqWorkspaceShortcuts', () => {
  it('calls onSave and prevents the browser default on Ctrl+S', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Host onSave={onSave} />)
    await user.keyboard('{Control>}s{/Control}')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('calls onSave on Cmd+S (metaKey) too', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Host onSave={onSave} />)
    await user.keyboard('{Meta>}s{/Meta}')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('calls onEscape on Escape', async () => {
    const user = userEvent.setup()
    const onEscape = vi.fn()
    render(<Host onEscape={onEscape} />)
    await user.keyboard('{Escape}')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the corresponding handler is omitted', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Host onSave={onSave} />) // onEscape omitted
    await user.keyboard('{Escape}') // must not throw
    expect(onSave).not.toHaveBeenCalled()
  })
})
