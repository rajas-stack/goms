import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Landing } from './Landing'

vi.mock('@/features/map/IndiaMap', () => ({ IndiaMap: () => <div data-testid="india-map" /> }))

// Same as Home.test.tsx (the two routes share this exact headline): renders
// via `font-display`, which maps to IBM Plex Sans (tailwind.config.ts).
// Locks in both: the class stays wired up, the bold weight is preserved.
describe('Landing — headline typography', () => {
  it('uses the font-display face at bold weight', () => {
    vi.spyOn(api, 'useStates').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useStates>)
    vi.spyOn(api, 'useAllEmployees').mockReturnValue({
      data: [
        { vacant: false, name: 'A', designation: 'Secretary (IAS)' },
        { vacant: false, name: 'B', designation: 'Section Officer' },
        { vacant: true, name: '', designation: 'Director' },
      ],
    } as unknown as ReturnType<typeof api.useAllEmployees>)
    vi.spyOn(api, 'useSalesPersons').mockReturnValue({
      data: [{ status: 'active' }, { status: 'resigned' }],
    } as unknown as ReturnType<typeof api.useSalesPersons>)
    render(<MemoryRouter><Landing /></MemoryRouter>)
    for (const label of ['IAS Officers', 'Departments', 'Dept Officers', 'Sales Members']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveClass('font-display')
    expect(heading).toHaveClass('font-bold')
    expect(heading).not.toHaveClass('font-normal')
  })
})
