import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccountMappingRail } from './AccountMappingRail'

function renderRail(path = '/map') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountMappingRail />
    </MemoryRouter>,
  )
}

describe('AccountMappingRail — Bid Tracker entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides the Bid Tracker button while the build flag is off', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', '')
    renderRail()
    expect(screen.queryByTitle('Bid Tracker')).not.toBeInTheDocument()
  })

  it('shows the Bid Tracker button when the flag is on, and marks it active on its routes', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', 'true')
    renderRail('/bid-tracker/actions')
    const button = screen.getByTitle('Bid Tracker')
    expect(button.className).toContain('shadow-sm')
    expect(screen.getByTitle('Account Mapping').className).not.toContain('shadow-sm')
  })
})
