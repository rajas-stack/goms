import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasViewport } from './useCanvasViewport'

const setup = () => {
  const viewport = document.createElement('div')
  document.body.appendChild(viewport)
  const content = document.createElement('div')
  const hook = renderHook(() => useCanvasViewport({ current: viewport }, { current: content }))
  return { viewport, hook }
}
const downEvent = (viewport: HTMLElement) => ({
  target: viewport, pointerId: 1, clientX: 10, clientY: 10, currentTarget: { setPointerCapture: () => undefined },
}) as never

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('useCanvasViewport', () => {
  // Production crash ("Cannot read properties of null (reading 'originX')", error boundary on /teams): the pan update was queued
  // as a functional setState that read dragRef.current later; if the pointer was released before React ran it, the ref was null.
  it('does not crash when the drag ends before a queued pan update runs', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const { viewport, hook } = setup()
    act(() => { hook.result.current.onPointerDown(downEvent(viewport)) })
    act(() => { hook.result.current.onPointerMove({ pointerId: 1, clientX: 60, clientY: 40 } as never) })
    expect(frames).toHaveLength(1)
    expect(() => act(() => {
      // another pending update makes the pan one non-eager, so it runs at render time, after endPan
      hook.result.current.zoomBy(1.1)
      frames[0](0)
      hook.result.current.endPan({ pointerId: 1 } as never)
    })).not.toThrow()
  })

  it('pans by the drag distance from where the drag started', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length })
    const { viewport, hook } = setup()
    act(() => { hook.result.current.onPointerDown(downEvent(viewport)) })
    act(() => { hook.result.current.onPointerMove({ pointerId: 1, clientX: 60, clientY: 40 } as never) })
    act(() => { frames[0](0) })
    expect(hook.result.current.transform).toMatchObject({ x: 90, y: 86 })
  })

  // React's onWheel is passive, so preventDefault() was refused with a console error on every wheel event.
  it('handles the wheel with a non-passive native listener, so preventDefault works', () => {
    const { viewport, hook } = setup()
    const event = new WheelEvent('wheel', { deltaY: 30, cancelable: true, bubbles: true })
    act(() => { viewport.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(hook.result.current.transform.y).toBe(56 - 30)
    expect(hook.result.current.userInteractedRef.current).toBe(true)
  })

  // Expanding/collapsing changes the tree width; without this the clicked card slid away and the whole chart seemed to vanish.
  it('keeps the card whose button was clicked at the same screen position after the layout changes', () => {
    const { viewport, hook } = setup()
    const card = document.createElement('div'); card.setAttribute('data-canvas-card', '')
    const button = document.createElement('button'); card.appendChild(button); viewport.appendChild(card)
    let rect = { left: 300, top: 120 }
    card.getBoundingClientRect = () => ({ ...rect, right: rect.left + 200, bottom: rect.top + 80, width: 200, height: 80, x: rect.left, y: rect.top, toJSON: () => ({}) })
    const before = hook.result.current.transform
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    rect = { left: 240, top: 150 } // the layout moved the card 60px left and 30px down
    hook.rerender()
    expect(hook.result.current.transform).toMatchObject({ x: before.x + 60, y: before.y - 30 })
    expect(hook.result.current.userInteractedRef.current).toBe(true)
    hook.rerender() // consumed once: a later re-render does not shift it again
    expect(hook.result.current.transform).toMatchObject({ x: before.x + 60, y: before.y - 30 })
  })

  it('ignores clicks that are not on a button inside a card', () => {
    const { viewport, hook } = setup()
    const card = document.createElement('div'); card.setAttribute('data-canvas-card', ''); viewport.appendChild(card)
    let left = 300
    card.getBoundingClientRect = () => ({ left, top: 0, right: left + 200, bottom: 80, width: 200, height: 80, x: left, y: 0, toJSON: () => ({}) })
    const before = hook.result.current.transform
    act(() => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    left = 100
    hook.rerender()
    expect(hook.result.current.transform).toEqual(before)
  })

  it('stops listening to the wheel once unmounted', () => {
    const { viewport, hook } = setup()
    hook.unmount()
    const event = new WheelEvent('wheel', { deltaY: 30, cancelable: true })
    viewport.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
