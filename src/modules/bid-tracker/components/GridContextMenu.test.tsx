import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GridContextMenu } from './GridContextMenu'

// Root cause under test: React flushes the effects of a discrete event (contextmenu) synchronously,
// i.e. while that same event is still bubbling. A `document` contextmenu listener registered by the
// menu's mount effect therefore received the very right-click that opened it and closed the menu
// in the same tick. jsdom treats a scripted dispatchEvent as a default-priority update, so the harness
// uses flushSync to reproduce the browser's ordering (a real contextmenu is a discrete, sync-lane event).
function Harness() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <div>
      <div data-testid="cell" onContextMenu={(e) => { e.preventDefault(); flushSync(() => setMenu({ x: e.clientX, y: e.clientY })) }}>cell</div>
      <div data-testid="other" onContextMenu={(e) => { e.preventDefault(); flushSync(() => setMenu({ x: e.clientX, y: e.clientY })) }}>other</div>
      {menu && <GridContextMenu x={menu.x} y={menu.y} title="t" groups={[[{ label: 'Go', onSelect: () => {} }]]} onClose={() => setMenu(null)} />}
    </div>
  )
}

const rightClick = (el: Element) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
const flush = () => new Promise((r) => setTimeout(r, 20))

describe('GridContextMenu opened by a real contextmenu event', () => {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  let prev: boolean | undefined
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { prev = g.IS_REACT_ACT_ENVIRONMENT; g.IS_REACT_ACT_ENVIRONMENT = false; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { root.unmount(); host.remove(); g.IS_REACT_ACT_ENVIRONMENT = prev })

  it('stays open after the right-click that opened it', async () => {
    root.render(<Harness />)
    await flush()
    rightClick(host.querySelector('[data-testid=cell]')!)
    await flush()
    expect(document.querySelector('[data-testid=grid-context-menu]')).not.toBeNull()
  })

  it('a second right-click elsewhere re-opens it (the menu is not stuck closed)', async () => {
    root.render(<Harness />)
    await flush()
    rightClick(host.querySelector('[data-testid=cell]')!)
    await flush()
    host.querySelector('[data-testid=other]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }))
    rightClick(host.querySelector('[data-testid=other]')!)
    await flush()
    expect(document.querySelectorAll('[data-testid=grid-context-menu]')).toHaveLength(1)
  })

  it('a later contextmenu outside the menu closes it', async () => {
    root.render(<Harness />)
    await flush()
    rightClick(host.querySelector('[data-testid=cell]')!)
    await flush()
    document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect(document.querySelector('[data-testid=grid-context-menu]')).toBeNull()
  })
})
