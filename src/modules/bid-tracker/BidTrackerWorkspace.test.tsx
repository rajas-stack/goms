import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BidTrackerWorkspace } from './BidTrackerWorkspace'

function Path() {
  return <span data-testid="path">{useLocation().pathname}</span>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/bid-tracker" element={<BidTrackerWorkspace />} />
        <Route path="/bid-tracker/:section" element={<BidTrackerWorkspace />} />
      </Routes>
      <Path />
    </MemoryRouter>,
  )
}

describe('BidTrackerWorkspace', () => {
  it('renders the Master Grid tab by default', () => {
    renderAt('/bid-tracker')
    expect(screen.getByRole('button', { name: 'Master Grid' })).toBeInTheDocument()
    expect(screen.getByTestId('bid-tracker-grid-placeholder')).toBeInTheDocument()
  })

  it('navigates between sections through the URL', async () => {
    renderAt('/bid-tracker')
    await userEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/bid-tracker/actions')
    await userEvent.click(screen.getByRole('button', { name: 'Master Grid' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/bid-tracker$/)
  })
})
