import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useDismiss } from './useDismiss'

/** `data-canvas-ui` on `dialog-chrome` mirrors Dialog.tsx's own full-screen
 *  wrapper — an unrelated marker (HierarchyCanvas's click-outside-deselects
 *  guard) that happens to wrap everything while a dialog is open.
 *  `data-popover-panel` on `nested-popover` mirrors a *different*
 *  PopoverPanel-rendered dropdown (e.g. a Combobox opened from within this
 *  one) — the only thing this hook should actually treat as "not outside". */
function Harness({ onClose }: { onClose: () => void }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismiss({ open: true, onClose, anchorRef, panelRef })
  return (
    <div>
      <div ref={anchorRef} data-testid="anchor">Anchor</div>
      <div ref={panelRef} data-testid="panel">Panel</div>
      <div data-canvas-ui data-testid="dialog-chrome">
        <button data-testid="unrelated-dialog-field">Some other field</button>
      </div>
      <div data-popover-panel data-testid="nested-popover">
        <button data-testid="nested-option">Option in a different popover</button>
      </div>
    </div>
  )
}

describe('useDismiss', () => {
  it('closes on a click inside an unrelated data-canvas-ui ancestor (e.g. Dialog.tsx) — regression for 2026-09-03', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(getByTestId('unrelated-dialog-field'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on a click inside a different, nested popover panel', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(getByTestId('nested-option'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on a click inside its own anchor or panel', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(getByTestId('anchor'))
    fireEvent.pointerDown(getByTestId('panel'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
