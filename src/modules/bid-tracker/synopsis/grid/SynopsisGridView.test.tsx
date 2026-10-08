import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SynopsisGrid } from '@goms/domain'
import { emptyGrid, setCell } from './gridModel'
import { SynopsisGridView } from './SynopsisGridView'

function Harness({ initial, onGrid }: { initial: SynopsisGrid; onGrid: (grid: SynopsisGrid) => void }) {
  const [grid, setGrid] = useState(initial)
  return <SynopsisGridView grid={grid} label="Test grid" onError={vi.fn()} onChange={next => { setGrid(next); onGrid(next) }} />
}

function setup(initial = emptyGrid(2, 2)) {
  let latest = initial
  render(<Harness initial={initial} onGrid={grid => { latest = grid }} />)
  return { get: () => latest, grid: screen.getByRole('grid', { name: 'Test grid' }) }
}

const cell = (r: number, c: number) => document.querySelector<HTMLElement>(`[data-pos="${r}:${c}"]`)!

describe('SynopsisGridView', () => {
  it('types into a cell and moves down on Enter', async () => {
    const { get } = setup()
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    await userEvent.keyboard('Hello{Enter}')
    const grid = get()
    expect(grid.rows[0].cells[grid.columns[0].id]).toBe('Hello')
    expect(cell(1, 0)).toHaveAttribute('aria-selected', 'true')
  })

  it('moves a row with Alt+Shift+Arrow and deletes it from the context menu', async () => {
    const start = emptyGrid(1, 3)
    const { get } = setup(setCell(start, start.rows[0].id, start.columns[0].id, 'first'))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}')
    expect(get().rows.map(r => r.id)).toEqual([start.rows[1].id, start.rows[0].id, start.rows[2].id])
    fireEvent.contextMenu(cell(1, 0))
    await userEvent.click(within(screen.getByTestId('grid-context-menu')).getByRole('menuitem', { name: 'Delete row' }))
    expect(get().rows.map(r => r.id)).toEqual([start.rows[1].id, start.rows[2].id])
  })

  it('adds a dropdown column and picks a newly created option', async () => {
    const { get } = setup(emptyGrid(1, 1))
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }))
    await userEvent.clear(screen.getByLabelText('Column name'))
    await userEvent.type(screen.getByLabelText('Column name'), 'Compliance')
    await userEvent.selectOptions(screen.getByLabelText('Column type'), 'singleSelect')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(get().columns.map(c => c.name)).toEqual(['Column 1', 'Compliance'])
    fireEvent.mouseDown(cell(0, 1), { button: 0 })
    await userEvent.keyboard('{Enter}')
    await userEvent.type(screen.getByLabelText('Compliance option search'), 'complied{Enter}')
    const grid = get()
    const column = grid.columns[1]
    expect(column.options?.map(o => o.value)).toEqual(['complied'])
    expect(grid.rows[0].cells[column.id]).toBe(column.options![0].id)
  })

  it('reorders, hides and deletes columns from the header menu', async () => {
    const start = emptyGrid(3, 1)
    const { get } = setup(start)
    await userEvent.click(screen.getByRole('button', { name: 'Column 1 column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move column right' }))
    expect(get().columns.map(c => c.name)).toEqual(['Column 2', 'Column 1', 'Column 3'])
    await userEvent.click(screen.getByRole('button', { name: 'Column 3 column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide column' }))
    expect(screen.queryByRole('columnheader', { name: /Column 3/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Column 2 column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete column' }))
    expect(get().columns.map(c => c.name)).toEqual(['Column 1', 'Column 3'])
  })

  it('pastes tab-separated text from Sheets, adding rows', () => {
    const { get, grid } = setup(emptyGrid(2, 1))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    fireEvent.paste(grid, { clipboardData: { getData: () => 'a\tb\nc\td' } })
    const result = get()
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map(r => result.columns.map(c => r.cells[c.id]))).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('toggles a checkbox cell with Space', async () => {
    const start = emptyGrid(1, 1)
    const { get } = setup({ ...start, columns: [{ ...start.columns[0], type: 'checkbox' }] })
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    await userEvent.keyboard(' ')
    expect(get().rows[0].cells[start.columns[0].id]).toBe(true)
  })

  it('keeps the old value when a number cell gets text that is not a number', async () => {
    const start = emptyGrid(1, 1)
    const col = start.columns[0].id
    const { get } = setup(setCell({ ...start, columns: [{ ...start.columns[0], type: 'number' }] }, start.rows[0].id, col, 42))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    await userEvent.keyboard('{Enter}')
    const input = screen.getByLabelText('Column 1')
    await userEvent.clear(input)
    await userEvent.type(input, '12 lakh{Enter}')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.keyboard('{Escape}')
    expect(get().rows[0].cells[col]).toBe(42)
  })

  it('commits the open editor when another cell is clicked', async () => {
    const { get } = setup(emptyGrid(2, 2))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    await userEvent.keyboard('kept')
    await userEvent.click(cell(1, 1))
    const grid = get()
    expect(grid.rows[0].cells[grid.columns[0].id]).toBe('kept')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('clears the right-clicked cell, not the previous selection', async () => {
    const start = emptyGrid(2, 1)
    const [a, b] = start.columns.map(c => c.id)
    const { get } = setup(setCell(setCell(start, start.rows[0].id, a, 'A'), start.rows[0].id, b, 'B'))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    fireEvent.contextMenu(cell(0, 1))
    await userEvent.click(within(screen.getByTestId('grid-context-menu')).getByRole('menuitem', { name: 'Clear cells' }))
    expect(get().rows[0].cells).toEqual({ [a]: 'A', [b]: null })
  })

  it('lets Tab leave the grid from the last column', () => {
    setup(emptyGrid(1, 1))
    fireEvent.mouseDown(cell(0, 0), { button: 0 })
    const event = fireEvent.keyDown(screen.getByRole('grid'), { key: 'Tab' })
    expect(event).toBe(true)
  })
})
