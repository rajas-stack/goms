import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from './Home'

// The homepage headline renders via the `font-display` class, which maps to
// IBM Plex Sans (tailwind.config.ts) — the site-wide font-family. This locks
// in both: the class stays wired up, and the bold weight is preserved.
describe('Home — headline typography', () => {
  it('uses the font-display face at bold weight', () => {
    render(<Home />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveClass('font-display')
    expect(heading).toHaveClass('font-bold')
    expect(heading).not.toHaveClass('font-normal')
  })
})
