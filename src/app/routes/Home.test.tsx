import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from './Home'

// The homepage headline's font-family was already the intended new face
// (`font-display` → "Bricolage Grotesque", index.html/tailwind.config.ts —
// untouched by this fix) but a prior change dropped it from bold to regular
// weight. This locks in both: the new face stays, and the bold weight is
// restored.
describe('Home — headline typography', () => {
  it('uses the font-display face at bold weight', () => {
    render(<Home />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveClass('font-display')
    expect(heading).toHaveClass('font-bold')
    expect(heading).not.toHaveClass('font-normal')
  })
})
