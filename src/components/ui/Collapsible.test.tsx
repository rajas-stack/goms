import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('component test harness smoke test', () => {
  it('renders into jsdom', () => {
    render(<div>hello</div>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
