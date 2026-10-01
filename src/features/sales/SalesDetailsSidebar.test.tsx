import { useRef, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  SalesDetailsSidebar, SalesDetailsSidebarProvider, useSalesDetailsSidebar,
} from './SalesDetailsSidebar'

// The workspace selection lives in the URL in the real app; here a module-level
// value plus a re-render trigger is enough to drive the sidebar.
let selection: { kind: 'salesPerson'; id: string } | null = null
vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection }),
}))
vi.mock('@/features/details/DetailsPanel', () => ({
  DetailsPanel: () => <div data-testid="details-panel">details for {selection?.id}</div>,
}))

const WIDTH_KEY = 'goms.sales.detailsWidth'
const CONTAINER_WIDTH = 1400

function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width: 1024px'),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function Harness({ pick }: { pick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const details = useSalesDetailsSidebar()
  return (
    <div>
      <button onClick={() => { pick('a'); details.reveal() }}>row-a</button>
      <button onClick={() => { pick('b'); details.reveal() }}>row-b</button>
      <span data-testid="selection">{selection?.id ?? 'none'}</span>
      <div
        ref={(el) => {
          (ref as { current: HTMLDivElement | null }).current = el
          if (el) el.getBoundingClientRect = () => ({ left: 0, right: CONTAINER_WIDTH, width: CONTAINER_WIDTH, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
        }}
      >
        <SalesDetailsSidebar containerRef={ref} />
      </div>
    </div>
  )
}

// Selection state sits above the provider, like the router does in the app, so
// a selection change re-renders the provider.
function Root() {
  const [, force] = useState(0)
  const pick = (id: string) => { selection = { kind: 'salesPerson', id }; force((n) => n + 1) }
  return <SalesDetailsSidebarProvider><Harness pick={pick} /></SalesDetailsSidebarProvider>
}
const mount = () => render(<Root />)
const sidebar = () => screen.queryByRole('complementary', { name: 'Details' })
const handle = () => screen.getByRole('separator', { name: 'Resize details panel' })
const width = () => Number(handle().getAttribute('aria-valuenow'))

/** Drags the handle so the sidebar's left edge ends at `clientX`. */
function dragTo(clientX: number) {
  const h = handle()
  fireEvent.pointerDown(h, { pointerId: 1, clientX: CONTAINER_WIDTH - width() })
  fireEvent.pointerMove(h, { pointerId: 1, clientX })
  fireEvent.pointerUp(h, { pointerId: 1, clientX })
}

beforeAll(() => {
  // jsdom lacks PointerEvent (drops clientX) and pointer capture.
  if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
})

beforeEach(() => {
  selection = null
  sessionStorage.clear()
  setViewport(true)
})
afterEach(() => vi.restoreAllMocks())

describe('SalesDetailsSidebar — desktop', () => {
  it('is hidden when nothing is selected', () => {
    mount()
    expect(sidebar()).toBeNull()
    expect(screen.queryByTestId('details-panel')).toBeNull()
  })

  it('opens at the default width when a person is selected', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    expect(sidebar()).toBeInTheDocument()
    expect(screen.getByTestId('details-panel')).toHaveTextContent('details for a')
    expect(width()).toBe(SIDEBAR_DEFAULT)
  })

  it('close hides the sidebar but keeps the selection; re-selecting the same person reopens it', async () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(sidebar()).toBeNull())
    expect(screen.getByTestId('selection')).toHaveTextContent('a')

    fireEvent.click(screen.getByText('row-a')) // already-selected row
    expect(sidebar()).toBeInTheDocument()
    expect(screen.getByTestId('details-panel')).toHaveTextContent('details for a')
  })

  it('switching person updates the open sidebar', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    fireEvent.click(screen.getByText('row-b'))
    expect(screen.getByTestId('details-panel')).toHaveTextContent('details for b')
  })

  it('selecting a different person after closing reopens it', async () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(sidebar()).toBeNull())
    fireEvent.click(screen.getByText('row-b'))
    expect(screen.getByTestId('details-panel')).toHaveTextContent('details for b')
  })

  it('resizes by dragging the left-edge handle', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    dragTo(CONTAINER_WIDTH - 500)
    expect(width()).toBe(500)
  })

  it('clamps the width to the 320–720px bounds', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    dragTo(CONTAINER_WIDTH - 100)
    expect(width()).toBe(SIDEBAR_MIN)
    dragTo(0)
    expect(width()).toBe(SIDEBAR_MAX)
  })

  it('never takes more than 60% of a narrower workspace', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    // 60% of 1400 = 840 > max, so the absolute max wins; shrink the container to prove the share cap.
    handle().closest('aside')!.parentElement!.getBoundingClientRect = () =>
      ({ left: 0, right: 800, width: 800, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(handle(), { pointerId: 1, clientX: 400 })
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(handle(), { pointerId: 1, clientX: 0 })
    expect(width()).toBe(480)
  })

  it('supports keyboard resizing', () => {
    mount()
    fireEvent.click(screen.getByText('row-a'))
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(width()).toBe(SIDEBAR_DEFAULT + 24)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(width()).toBe(SIDEBAR_DEFAULT)
  })

  it('remembers the width across close/reopen and a fresh mount in the same session', async () => {
    const first = mount()
    fireEvent.click(screen.getByText('row-a'))
    dragTo(CONTAINER_WIDTH - 560)
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('560')

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(sidebar()).toBeNull())
    fireEvent.click(screen.getByText('row-a'))
    expect(width()).toBe(560)

    first.unmount()
    mount()
    fireEvent.click(screen.getByText('row-b'))
    expect(width()).toBe(560)
  })

  it('ignores an out-of-range stored width', () => {
    sessionStorage.setItem(WIDTH_KEY, '5000')
    mount()
    fireEvent.click(screen.getByText('row-a'))
    expect(width()).toBe(SIDEBAR_DEFAULT)
  })
})

describe('SalesDetailsSidebar - mobile drawer', () => {
  beforeEach(() => setViewport(false))

  it('renders a drawer without a resize handle, and closes via the button', async () => {
    mount()
    expect(sidebar()).toBeNull()
    fireEvent.click(screen.getByText('row-a'))
    expect(sidebar()).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize details panel' })).toBeNull()
    expect(screen.getByTestId('details-panel')).toHaveTextContent('details for a')

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(sidebar()).toBeNull())
    expect(screen.getByTestId('selection')).toHaveTextContent('a')
  })

  it('closes when the scrim is tapped, keeping the selection', async () => {
    const { container } = mount()
    fireEvent.click(screen.getByText('row-a'))
    fireEvent.click(container.querySelector('.fixed.inset-0')!)
    await waitFor(() => expect(sidebar()).toBeNull())
    expect(screen.getByTestId('selection')).toHaveTextContent('a')
  })
})
