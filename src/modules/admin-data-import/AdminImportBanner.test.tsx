import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AdminImportBanner } from './AdminImportBanner'

describe('AdminImportBanner', () => {
  it('renders the "access control not yet enforced" warning', () => {
    render(<AdminImportBanner />)
    expect(screen.getByText(/access control not yet enforced/i)).toBeInTheDocument()
  })

  it('renders as an alert role for accessibility', () => {
    render(<AdminImportBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
