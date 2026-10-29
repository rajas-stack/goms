import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, type AvatarPerson } from '@/components/ui/Avatar'
import type { DirectoryEntry } from './directoryEntries'

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
// Card and photo are both drawn at their final size and grow from 0 to 1, so text and photo stay sharp and in proportion.
const PHOTO_SIZE = 96
/** How far the photo sits left of the card's edge: it overlaps the card's left side like a badge. */
const PHOTO_OUTSET = 24

/** Hover preview beside a Directory row: the card grows from nothing, and the person's round 3D
 *  Drive photo pops out of its left edge. Portalled so the scrolling list can't clip it. */
export function ContactHoverCard({ entry, person, anchor }: { entry: DirectoryEntry; person: AvatarPerson; anchor: DOMRect }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const grow = (el: HTMLElement | null, to: number, duration: number, delay = 0) => el?.animate(
      [{ transform: 'scale(0)', opacity: 0 }, { transform: `scale(${to})`, opacity: 1 }],
      { duration: instant ? 0 : duration, delay: instant ? 0 : delay, easing: EASE_OUT, fill: 'both' },
    )
    const animations = [grow(cardRef.current, 1, 280), grow(photoRef.current, 1, 360, 40)]
    return () => animations.forEach((a) => a?.cancel())
  }, [entry.kind, entry.id])

  // Beside the name, vertically centred on the row; kept inside the viewport.
  const left = Math.min(anchor.left + Math.min(anchor.width * 0.4, 300), window.innerWidth - 400)
  const top = Math.min(Math.max(anchor.top + anchor.height / 2, 90), window.innerHeight - 90)

  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-50" style={{ left, top }}>
      {/* Centring lives on this wrapper: the animation owns the card's own transform. */}
      <div className="absolute left-0 top-0 -translate-y-1/2">
        <div ref={cardRef} className="flex min-h-[84px] w-80 flex-col justify-center rounded-2xl border border-line bg-white py-3 pr-4 shadow-xl"
          style={{ transformOrigin: 'left center', paddingLeft: PHOTO_SIZE - PHOTO_OUTSET + 14 }}>
          <p className="break-words text-[16px] font-semibold leading-snug text-ink-900">{entry.name}</p>
          {entry.designation && <p className="break-words text-[13px] leading-snug text-muted">{entry.designation}</p>}
          {entry.organisation && <p className="break-words text-[13px] leading-snug text-muted">{entry.organisation}</p>}
          {entry.displayId && <p className="mt-1 font-mono text-[12px] tabular-nums text-muted">ID {entry.displayId}</p>}
          {(entry.email || entry.phone) && <p className="mt-1 break-all text-[12px] text-ink-700">{entry.email || entry.phone}</p>}
        </div>
      </div>
      {/* A sibling, not a child, so the photo's own scale isn't multiplied by the card's. */}
      {/* Solid backing + a ring in the card's colour: without a photo the initials circle is translucent and the card edge showed through. */}
      <div ref={photoRef} className="absolute overflow-hidden rounded-full bg-panel shadow-lg ring-4 ring-white"
        style={{ left: -PHOTO_OUTSET, top: -PHOTO_SIZE / 2, width: PHOTO_SIZE, height: PHOTO_SIZE, transformOrigin: 'center' }}>
        <Avatar person={person} size="lg" className="h-full w-full text-[28px] font-semibold tracking-wide" />
      </div>
    </div>,
    document.body,
  )
}
