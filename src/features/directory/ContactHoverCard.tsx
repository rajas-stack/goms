import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, type AvatarPerson } from '@/components/ui/Avatar'
import type { DirectoryEntry } from './directoryEntries'

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const PHOTO_SIZE = 32
/** Final scales the hover preview grows to: the card ×1.5, the cut-out photo ×3.5. */
const CARD_SCALE = 1.5
const PHOTO_SCALE = 3.5

/** Hover preview beside a Directory row: the card grows from nothing, and the person's background-free
 *  Drive photo pops out of its left edge with a 3D shadow. Portalled so the scrolling list can't clip it. */
export function ContactHoverCard({ entry, person, anchor }: { entry: DirectoryEntry; person: AvatarPerson; anchor: DOMRect }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const grow = (el: HTMLElement | null, to: number, duration: number, delay = 0) => el?.animate(
      [{ transform: 'scale(0)', opacity: 0 }, { transform: `scale(${to})`, opacity: 1 }],
      { duration: instant ? 0 : duration, delay: instant ? 0 : delay, easing: EASE_OUT, fill: 'both' },
    )
    const animations = [grow(cardRef.current, CARD_SCALE, 280), grow(photoRef.current, PHOTO_SCALE, 360, 40)]
    return () => animations.forEach((a) => a?.cancel())
  }, [entry.kind, entry.id])

  // Beside the name, vertically centred on the row; kept inside the viewport.
  const left = Math.min(anchor.left + Math.min(anchor.width * 0.4, 300), window.innerWidth - 400)
  const top = Math.min(Math.max(anchor.top + anchor.height / 2, 90), window.innerHeight - 90)

  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-50" style={{ left, top }}>
      {/* Centring lives on this wrapper: the animation owns the card's own transform. */}
      <div className="absolute left-0 top-0 -translate-y-1/2">
        <div ref={cardRef} className="w-56 rounded-xl border border-line bg-white/95 py-2.5 pl-16 pr-3 shadow-lg backdrop-blur-sm" style={{ transformOrigin: 'left center' }}>
          <p className="break-words text-[12px] font-semibold leading-tight text-ink-900">{entry.name}</p>
          {entry.designation && <p className="break-words text-[10px] text-muted">{entry.designation}</p>}
          {entry.organisation && <p className="break-words text-[10px] text-muted">{entry.organisation}</p>}
          {entry.displayId && <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted">ID {entry.displayId}</p>}
          {(entry.email || entry.phone) && <p className="mt-0.5 break-all text-[10px] text-ink-700">{entry.email || entry.phone}</p>}
        </div>
      </div>
      {/* A sibling, not a child, so the photo's own scale isn't multiplied by the card's. */}
      <div ref={photoRef} className="absolute" style={{ left: 8, top: -PHOTO_SIZE / 2, width: PHOTO_SIZE, height: PHOTO_SIZE, transformOrigin: 'center' }}>
        <Avatar person={person} size="sm" cutout />
      </div>
    </div>,
    document.body,
  )
}
