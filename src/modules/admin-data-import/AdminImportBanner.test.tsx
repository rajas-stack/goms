import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AdminImportBanner } from './AdminImportBanner'

describe('AdminImportBanner', () => {
  it('renders the allow-list warning', () => {
    render(<AdminImportBanner />)
    expect(screen.getByText(/explicit allow-list of authorized Google accounts/i)).toBeInTheDocument()
  })

  it('renders as an alert role for accessibility', () => {
    render(<AdminImportBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
