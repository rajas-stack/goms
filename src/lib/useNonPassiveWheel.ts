import { useEffect, useRef, type RefObject } from 'react'

/** Attaches a wheel handler to `ref`'s element as a NON-passive native listener, so `preventDefault()` works.
 *
 *  Never use React's `onWheel` prop for pan/zoom surfaces: React registers it passive, the browser refuses `preventDefault()`
 *  ("Unable to preventDefault inside passive event listener", once per wheel event) and the page scrolls under the canvas.
 *  (`src/lib/noPassiveWheelReactProp.test.ts` fails if an `onWheel` prop that calls `preventDefault` is reintroduced.)
 *
 *  The listener follows the element: it is re-attached if the ref's element changes (surfaces often render a loading state
 *  first) and removed on unmount. The latest `handler` is always used, without re-subscribing. */
export function useNonPassiveWheel(ref: RefObject<HTMLElement | null>, handler: (event: WheelEvent) => void) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const listener = useRef((event: WheelEvent) => handlerRef.current(event)).current
  const attached = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === attached.current) return
    attached.current?.removeEventListener('wheel', listener)
    el?.addEventListener('wheel', listener, { passive: false })
    attached.current = el
  })
  useEffect(() => () => { attached.current?.removeEventListener('wheel', listener); attached.current = null }, [listener])
}
