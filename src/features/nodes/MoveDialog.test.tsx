import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { MoveDialog } from './MoveDialog'
import type { HierNode } from '@/lib/types'

const NODE = { id: 'n-1', typeKey: 'unit', name: 'Cyber Cell' } as unknown as HierNode
const TARGET = { id: 'n-2', typeKey: 'division', name: 'IT Division', code: 'ITD' }

const moveMutateAsync = vi.fn().mockResolvedValue({})

beforeEach(() => {
  vi.spyOn(api, 'useMoveTargets').mockReturnValue({ data: [TARGET] } as unknown as ReturnType<typeof api.useMoveTargets>)
  vi.spyOn(api, 'useNodeMutations').mockReturnValue({
    move: { mutateAsync: moveMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useNodeMutations>)
  moveMutateAsync.mockClear()
})

// The move is consequential (it relocates the node's whole subtree), so
// picking a target and committing the move are two separate, explicit
// steps — "Move here" opens a confirmation naming both the node and its
// picked destination, and only the confirmation step's own "Move here"
// actually calls the mutation.
describe('MoveDialog — move confirmation', () => {
  it('picking a target and clicking "Move here" shows a confirmation instead of moving immediately', async () => {
    const user = userEvent.setup()
    render(<MoveDialog open node={NODE} stateCode={7} onClose={vi.fn()} />)

    await user.click(screen.getByText('IT Division'))
    await user.click(screen.getByRole('button', { name: 'Move here' }))

    expect(moveMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Move Cyber Cell?' })).toBeInTheDocument()
    expect(screen.getAllByText('IT Division').length).toBeGreaterThan(0)
  })

  it('confirming the move calls the mutation with the picked target', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MoveDialog open node={NODE} stateCode={7} onClose={onClose} />)

    await user.click(screen.getByText('IT Division'))
    await user.click(screen.getByRole('button', { name: 'Move here' }))
    await user.click(screen.getByRole('button', { name: 'Move here' }))

    expect(moveMutateAsync).toHaveBeenCalledWith({ id: 'n-1', newParentId: 'n-2' })
    expect(onClose).toHaveBeenCalled()
  })

  it('"Back" from the confirmation returns to the picker without moving anything', async () => {
    const user = userEvent.setup()
    render(<MoveDialog open node={NODE} stateCode={7} onClose={vi.fn()} />)

    await user.click(screen.getByText('IT Division'))
    await user.click(screen.getByRole('button', { name: 'Move here' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(moveMutateAsync).not.toHaveBeenCalled()
    // Back in the picker: the target row is selectable again and "Move
    // here" is still enabled (the pick itself wasn't cleared).
    expect(screen.getByRole('button', { name: 'Move here' })).toBeEnabled()
  })

  it('"Move here" is disabled until a target is picked', () => {
    render(<MoveDialog open node={NODE} stateCode={7} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled()
  })
})
