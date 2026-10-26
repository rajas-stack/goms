import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GridContextMenu } from './GridContextMenu'

describe('context menu keyboard and scrolling', () => {
  it('skips disabled actions and activates the chosen action once with Space', () => {
    const selected = vi.fn(), closed = vi.fn()
    render(<GridContextMenu x={20} y={20} title="Bid" onClose={closed} groups={[[
      { label: 'First', onSelect: vi.fn() },
      { label: 'Unavailable', disabled: true, onSelect: vi.fn() },
      { label: 'Last', onSelect: selected },
    ]]} />)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(menu).toHaveAttribute('aria-activedescendant', screen.getByRole('menuitem', { name: 'Last' }).id)
    fireEvent.keyDown(menu, { key: ' ' })
    expect(selected).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('allows scrolling within a long menu while outside scrolling closes it', () => {
    const closed = vi.fn()
    render(<GridContextMenu x={20} y={20} title="Bid" onClose={closed} groups={[[{ label: 'Open', onSelect: vi.fn() }]]} />)
    fireEvent.wheel(screen.getByRole('menuitem'), { deltaY: 100 })
    expect(closed).not.toHaveBeenCalled()
    fireEvent.wheel(document.body, { deltaY: 100 })
    expect(closed).toHaveBeenCalledOnce()
  })
})
