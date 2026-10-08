import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PressKey, PressKeyGroup } from './PressKey'

describe('PressKey', () => {
  it('sits latched down with its lamp lit when selected, raised otherwise', () => {
    render(
      <PressKeyGroup aria-label="Zoom" role="group">
        <PressKey lamp latched aria-pressed>1M</PressKey>
        <PressKey lamp aria-pressed={false}>3M</PressKey>
      </PressKeyGroup>,
    )
    const on = screen.getByRole('button', { name: '1M' })
    const off = screen.getByRole('button', { name: '3M' })
    expect(on.className).toContain('translate-y-[2px]')
    expect(on.querySelector('span')?.className).toContain('bg-emerald')
    expect(off.className).not.toContain(' translate-y-[2px]')
    expect(off.querySelector('span')?.className).toContain('bg-line')
  })

  it('acts as a normal button', async () => {
    const onClick = vi.fn()
    render(<PressKey onClick={onClick}>Today</PressKey>)
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('type', 'button')
  })
})
