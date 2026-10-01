import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePopoverPosition } from './usePopoverPosition'

// Regression: the hook tracks its anchor with a requestAnimationFrame loop for as long as the
// panel is open. It used to call setPosition with a NEW object every frame, re-rendering the
// popover subtree at ~60 Hz even when nothing had moved — with two popovers open over the
// Bid Tracker grid that froze the page for seconds on real data.
describe('usePopoverPosition', () => {
  let frame: FrameRequestCallback | null = null
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { frame = null })
  })
  afterEach(() => vi.unstubAllGlobals())

  const run = (n: number) => { for (let i = 0; i < n; i++) act(() => { const cb = frame; frame = null; cb?.(0) }) }
  const anchor = (rect: Partial<DOMRect>) => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 40, right: 140, width: 100, height: 30, x: 40, y: 100, toJSON: () => ({}), ...rect }) as DOMRect
    return { current: el }
  }
  const panel = { current: document.createElement('div') }

  it('does not re-render on frames where the anchor has not moved', () => {
    let renders = 0
    const { result } = renderHook(() => { renders++; return usePopoverPosition({ open: true, anchorRef: anchor({}), panelRef: panel }) })
    run(2) // first frames settle the position away from the off-screen start value
    const settled = renders
    const pos = result.current
    run(60) // a full second of frames with a stationary anchor
    expect(renders).toBe(settled)
    expect(result.current).toBe(pos) // same object — no state churn at all
  })

  it('still follows the anchor when it really moves', () => {
    const ref = anchor({})
    const { result } = renderHook(() => usePopoverPosition({ open: true, anchorRef: ref, panelRef: panel }))
    run(2)
    const before = result.current.top
    ref.current.getBoundingClientRect = () => ({ top: 300, bottom: 330, left: 40, right: 140, width: 100, height: 30, x: 40, y: 300, toJSON: () => ({}) }) as DOMRect
    run(2)
    expect(result.current.top).not.toBe(before)
    expect(result.current.top).toBe(334) // bottom (330) + gap (4)
  })

  it('ignores sub-pixel jitter', () => {
    const ref = anchor({})
    let renders = 0
    renderHook(() => { renders++; return usePopoverPosition({ open: true, anchorRef: ref, panelRef: panel }) })
    run(2)
    const settled = renders
    ref.current.getBoundingClientRect = () => ({ top: 100.2, bottom: 130.2, left: 40.1, right: 140.1, width: 100, height: 30, x: 40.1, y: 100.2, toJSON: () => ({}) }) as DOMRect
    run(10)
    expect(renders).toBe(settled)
  })
})
