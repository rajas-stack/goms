import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Tooltip } from './Tooltip'

// A closed tooltip is a `whitespace-nowrap` box; if it stays laid out it widens
// every scroll container it sits in (phantom horizontal scrollbars).
describe('Tooltip', () => {
  it('is not laid out while closed, and only displays (lg+) while open', () => {
    render(<Tooltip label="Close details"><button>x</button></Tooltip>)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip).toHaveClass('hidden')
    expect(tip).not.toHaveClass('lg:block')

    fireEvent.pointerEnter(screen.getByRole('button').parentElement!)
    expect(tip).toHaveClass('lg:block')

    fireEvent.pointerLeave(screen.getByRole('button').parentElement!)
    expect(tip).not.toHaveClass('lg:block')
  })
})
