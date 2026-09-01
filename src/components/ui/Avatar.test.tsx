import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('renders an <img> when photoUrl is a non-empty string', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', photoUrl: 'https://example.com/photo.jpg' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg')
    expect(img).toHaveAttribute('alt', 'John Doe')
  })

  it('renders initials when photoUrl is null', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', photoUrl: null }}
      />
    )
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('renders initials when photoUrl is undefined', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
      />
    )
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('renders initials when photoUrl is an empty string', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', photoUrl: '' }}
      />
    )
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('renders the vacant variant when vacant is true, regardless of photoUrl', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', photoUrl: 'https://example.com/photo.jpg', vacant: true }}
      />
    )
    // Should not render img or initials when vacant
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('JD')).not.toBeInTheDocument()
    // Should have vacant styling (amber background)
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('bg-amber-100')
  })

  it('renders vacant variant with correct styling when vacant and no photoUrl', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', vacant: true }}
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('bg-amber-100', 'text-amber-600')
  })

  it('maps size xs to 24px', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
        size="xs"
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('h-6', 'w-6', 'text-xs')
  })

  it('maps size sm to 32px', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
        size="sm"
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('h-8', 'w-8', 'text-sm')
  })

  it('maps size md to 40px', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
        size="md"
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('h-10', 'w-10', 'text-base')
  })

  it('maps size lg to 56px', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
        size="lg"
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('h-14', 'w-14', 'text-lg')
  })

  it('defaults to md size when no size prop is provided', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('h-10', 'w-10', 'text-base')
  })

  it('applies custom className to the container', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
        className="custom-class"
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('custom-class')
  })

  it('renders both first letter and last letter initial for single-word names', () => {
    render(
      <Avatar
        person={{ name: 'Cher' }}
      />
    )
    expect(screen.getByText('CC')).toBeInTheDocument()
  })

  it('renders initials in uppercase', () => {
    render(
      <Avatar
        person={{ name: 'john doe' }}
      />
    )
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('uses rounded-full class for circular shape', () => {
    render(
      <Avatar
        person={{ name: 'John Doe' }}
      />
    )
    const container = screen.getByTestId('avatar')
    expect(container).toHaveClass('rounded-full')
  })

  it('renders img with rounded-full when photoUrl is present', () => {
    render(
      <Avatar
        person={{ name: 'John Doe', photoUrl: 'https://example.com/photo.jpg' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img).toHaveClass('rounded-full')
  })
})
