import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useRouteError } from 'react-router-dom'
import { GlobalErrorScreen } from './GlobalErrorScreen'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useRouteError: vi.fn() }
})

describe('GlobalErrorScreen', () => {
  // installStaleChunkRecovery (src/lib/staleChunkRecovery.ts) intercepts the
  // one failure mode this screen must NOT have to show (a stale post-deploy
  // chunk reference) before it ever reaches the router's errorElement. Any
  // other uncaught render error — a genuine bug, not a deploy-timing
  // artifact — must still land here unchanged.
  it('shows the generic crash screen for a genuine, unrelated render error', () => {
    vi.mocked(useRouteError).mockReturnValue(new TypeError("Cannot read properties of undefined (reading 'foo')"))

    render(<GlobalErrorScreen />)

    expect(screen.getByText(/this page hit a snag/i)).toBeInTheDocument()
  })
})
