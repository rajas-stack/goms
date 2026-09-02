import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NodeCard } from './NodeCard'
import type { HierNode } from '@/lib/types'

// Task 9.1 (Avatar rollout): the department card's "Head:" row renders an
// Avatar for heads[0].

const DEPARTMENT: HierNode = {
  id: 'dept-1', domain: 'org', typeKey: 'department', parentId: null, stateCode: 5,
  name: 'Health', code: null, sortOrder: 0, metadata: {}, status: 'active',
}

function baseProps() {
  return {
    node: DEPARTMENT,
    selected: false,
    expanded: false,
    canExpand: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onAdd: vi.fn(),
  }
}

describe('NodeCard — Avatar rollout (Task 9.1)', () => {
  it('renders a photo Avatar for heads[0] when its photoUrl is set', () => {
    render(
      <NodeCard
        {...baseProps()}
        heads={[{ name: 'Dept Head', photoUrl: 'https://example.com/head.jpg' }]}
      />,
    )
    const img = screen.getByAltText('Dept Head')
    expect(img).toHaveAttribute('src', 'https://example.com/head.jpg')
  })

  it('renders initials for heads[0] when photoUrl is unset', () => {
    render(
      <NodeCard
        {...baseProps()}
        heads={[{ name: 'Dept Head', photoUrl: null }]}
      />,
    )
    expect(screen.getByText('DH')).toBeInTheDocument()
    expect(screen.queryByAltText('Dept Head')).not.toBeInTheDocument()
  })
})
