import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Landing } from './Landing'

vi.mock('@/features/map/IndiaMap', () => ({ IndiaMap: () => <div data-testid="india-map" /> }))

// Same regression as Home.test.tsx (the two routes share this exact
// headline): the font-family was already the intended new face
// (`font-display` → "Bricolage Grotesque") but a prior change dropped it to
// regular weight. Locks in both: the face stays, the bold weight is back.
describe('Landing — headline typography', () => {
  it('uses the font-display face at bold weight', () => {
    vi.spyOn(api, 'useStates').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useStates>)
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveClass('font-display')
    expect(heading).toHaveClass('font-bold')
    expect(heading).not.toHaveClass('font-normal')
  })
})
