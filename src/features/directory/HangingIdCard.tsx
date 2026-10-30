import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'

const SPRING = { damping: 14, stiffness: 120, mass: 0.6 }
const TILT = 8 // degrees of 3D lean toward the cursor
/** Pendulum tuning: g/L sets the period (~2.8 s, slow enough to read the card), damping is per second. */
const G_OVER_L = 5
const DAMPING = { free: 0.06, hover: 1.2 }
const DROP_ANGLE = 17.5 // degrees it is let go from on load
/** The card hangs from the strap's ring and chases the strap's angle on its own springy joint (a loose double pendulum). */
const RING = { k: 20, c: 1.4 }
const ZERO = { k: 70, c: 16.7 } // critically damped return to rest after a click
/** It can't swing past the rail: at this angle it hits and bounces back, losing some speed. */
const LIMIT = 42.5 * (Math.PI / 180)
const RESTITUTION = 0.45
/** Pulling the card away from the clip stretches it off the strap, up to this many pixels. */
const MAX_STRETCH = 140
const CLICK = { px: 5, ms: 250 }
const RAD = Math.PI / 180

/** One step of the swing: free pendulum, or a quick critically-damped settle once clicked to zero. Bounces off ±LIMIT. */
export function stepSwing(theta: number, w: number, dt: number, mode: 'free' | 'hover' | 'zero'): [number, number] {
  const a = mode === 'zero' ? -ZERO.k * theta - ZERO.c * w : -G_OVER_L * Math.sin(theta) - DAMPING[mode] * w
  const nw = w + a * dt
  const nt = theta + nw * dt
  if (Math.abs(nt) > LIMIT) return [Math.sign(nt) * LIMIT, -nw * RESTITUTION]
  return [nt, nw]
}

/** One step of the card around the ring: its absolute angle phi chases the strap angle theta. */
export function stepRing(phi: number, w: number, theta: number, dt: number): [number, number] {
  const nw = w + (-RING.k * (phi - theta) - RING.c * w) * dt
  return [phi + nw * dt, nw]
}

/** What the badge prints. */
export interface IdCardPerson { name: string; photoUrl?: string | null; designation?: string; code?: string | null; base?: string | null; email?: string | null }

/** Deterministic dummy QR-ish grid from a string, with the three finder squares. */
function QrPattern({ seed }: { seed: string }) {
  let h = 2166136261
  const cells: boolean[] = []
  for (let i = 0; i < 21 * 21; i++) { h = Math.imul(h ^ (seed.charCodeAt(i % Math.max(seed.length, 1)) || 7) ^ i, 16777619); cells.push((h >>> 7) % 3 === 0) }
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}><rect x={x} y={y} width="7" height="7" fill="#0b0f14" /><rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" /><rect x={x + 2} y={y + 2} width="3" height="3" fill="#0b0f14" /></g>
  )
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)
  return (
    <svg viewBox="0 0 21 21" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect width="21" height="21" fill="#fff" />
      {cells.map((on, i) => { const x = i % 21, y = Math.floor(i / 21); return on && !inFinder(x, y) ? <rect key={i} x={x} y={y} width="1" height="1" fill="#0b0f14" /> : null })}
      {finder(0, 0)}{finder(14, 0)}{finder(0, 14)}
    </svg>
  )
}

function Barcode({ seed }: { seed: string }) {
  const bars = Array.from({ length: 42 }, (_, i) => 1 + ((seed.charCodeAt(i % Math.max(seed.length, 1)) || 3) + i * 7) % 3)
  return <div className="flex h-7 items-stretch gap-[1.5px]" aria-hidden>{bars.map((w, i) => <span key={i} className="bg-[#fff]/85" style={{ width: w }} />)}</div>
}

/** The signed-in user's badge details, from their Sales profile when they have one. */
export function useSignedInIdCardPerson(): IdCardPerson {
  const { user } = useAuthUser()
  const { data: people = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const email = user?.email?.toLowerCase() ?? ''
  const person = people.find((p) => p.officialEmail.toLowerCase() === email)
  const posting = person ? postings[person.id] : undefined
  return {
    name: person?.name || user?.displayName || 'Your name', photoUrl: person?.photoUrl, designation: posting?.designation,
    code: person?.employeeCode, base: person?.metadata?.baseLocation || posting?.office, email: person?.officialEmail || user?.email,
  }
}

/** Directory > ID card: the signed-in person's own badge. */
export function MyIdCard() {
  return <HangingIdCard person={useSignedInIdCardPerson()} />
}

/** A badge hanging from a rail on a lanyard. It swings like a dropped pendulum; hover slows it, a click stops it,
 *  holding and dragging swings it (pulling stretches it off the strap), and a double-click flips it. */
export function HangingIdCard({ person }: { person: IdCardPerson }) {
  const { name } = person
  const code = person.code || '—'
  const [flipped, setFlipped] = useState(false)

  const reduce = useReducedMotion()
  const mouseX = useMotionValue(0), mouseY = useMotionValue(0)
  const rotateX = useSpring(useTransform(mouseY, [-300, 300], [TILT, -TILT]), SPRING)
  const rotateY = useSpring(useTransform(mouseX, [-300, 300], [-TILT, TILT]), SPRING)
  const glareX = useTransform(mouseX, [-300, 300], ['-35%', '35%'])
  // Swing angle (degrees) from a small pendulum simulation; the card's own lag on its ring; and the pull-off stretch.
  const swing = useMotionValue(reduce ? 0 : DROP_ANGLE)
  const ringLag = useMotionValue(0)
  const stretch = useMotionValue(0)
  const ring = useRef({ phi: (reduce ? 0 : DROP_ANGLE) * RAD, w: 0 })
  const pivotRef = useRef<HTMLDivElement>(null)
  const sim = useRef({ w: 0, hover: false, zero: false, held: null as null | { x: number; y: number; t: number; grab: number; reach: number; from: number; last: number; lastT: number; moved: boolean } })
  const raf = useRef(0)

  // The loop runs only while something moves, so a card at rest costs nothing (keeps trackpads smooth).
  const run = useCallback(() => {
    if (reduce || raf.current) return
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - prev) / 1000); prev = now
      const st = sim.current
      if (!st.held) {
        const [th, w] = stepSwing(swing.get() * RAD, st.w, dt, st.zero ? 'zero' : st.hover ? 'hover' : 'free')
        st.w = w; swing.set(th / RAD)
      }
      const [phi, rw] = stepRing(ring.current.phi, ring.current.w, swing.get() * RAD, dt)
      ring.current = { phi, w: rw }
      ringLag.set(phi / RAD - swing.get())
      const resting = !st.held && Math.abs(swing.get()) < 0.05 && Math.abs(st.w) < 0.002 && Math.abs(ringLag.get()) < 0.05 && Math.abs(rw) < 0.002 && stretch.get() === 0
      raf.current = resting ? 0 : requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [reduce, swing, ringLag, stretch])
  useEffect(() => {
    if (reduce) { swing.set(0); return }
    run()
    return () => { cancelAnimationFrame(raf.current); raf.current = 0 }
  }, [reduce, run, swing])

  /** The pointer's angle around the clip in degrees (CSS sign), and its distance from it. */
  function polar(e: PointerEvent) {
    const r = pivotRef.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2), dy = Math.max(1, e.clientY - r.top)
    return { angle: -Math.atan2(dx, dy) / RAD, reach: Math.hypot(dx, dy) }
  }
  function onDown(e: PointerEvent<HTMLButtonElement>) {
    if (reduce) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = polar(e), now = performance.now()
    sim.current.held = { x: e.clientX, y: e.clientY, t: now, grab: p.angle, reach: p.reach, from: swing.get(), last: swing.get(), lastT: now, moved: false }
    sim.current.w = 0
    run()
  }
  function onHoldMove(e: PointerEvent<HTMLButtonElement>) {
    const h = sim.current.held
    if (!h) return
    if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > CLICK.px) h.moved = true
    if (!h.moved) return
    const p = polar(e), now = performance.now()
    const next = Math.max(-LIMIT / RAD, Math.min(LIMIT / RAD, h.from + p.angle - h.grab))
    // Smoothed angular velocity, so letting go tosses the card with the hand's speed.
    sim.current.w = 0.6 * sim.current.w + 0.4 * ((next - h.last) * RAD) / Math.max(0.008, (now - h.lastT) / 1000)
    h.last = next; h.lastT = now; sim.current.zero = false
    swing.set(next)
    stretch.set(Math.min(MAX_STRETCH, Math.max(0, (p.reach - h.reach) * 0.55)))
  }
  function onUp() {
    const h = sim.current.held
    if (!h) return
    sim.current.held = null
    // Snap back onto the strap like elastic.
    if (stretch.get() > 0) animate(stretch, 0, { type: 'spring', stiffness: 320, damping: 13 })
    // A quick click without dragging is "click-zero": bring the card to rest and keep it there.
    if (!h.moved && performance.now() - h.t < CLICK.ms) { sim.current.zero = true; sim.current.w = 0 }
    run()
  }
  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    mouseX.set(e.clientX - r.left - r.width / 2)
    mouseY.set(e.clientY - r.top - r.height / 2)
  }
  const onLeave = () => { mouseX.set(0); mouseY.set(0) }
  const setHover = (on: boolean) => { sim.current.hover = on; run() }

  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden bg-[radial-gradient(ellipse_at_top,rgb(var(--c-panel))_0%,rgb(var(--c-paper))_70%)]"
      style={{ perspective: 1100 }} onMouseMove={onMove} onMouseLeave={onLeave}>
      {/* The rail the lanyard hangs from, and its ring. */}
      <div className="h-2.5 w-full shrink-0 bg-gradient-to-b from-zinc-300 via-zinc-400 to-zinc-500 shadow-[0_2px_6px_rgba(0,0,0,0.18)]" aria-hidden />
      <div className="-mt-1.5 h-6 w-6 shrink-0 rounded-full border-[3px] border-zinc-400 bg-transparent shadow-sm" aria-hidden />

      <div ref={pivotRef} className="-mt-1.5 flex flex-col items-center">
      <motion.div className="origin-top will-change-transform" style={{ rotate: swing }}>
        <motion.div style={{ rotateX, rotateY, transformOrigin: 'top center', transformStyle: 'preserve-3d' }} className="flex flex-col items-center will-change-transform">
          {/* Lanyard strap with printed text, then the metal clip. */}
          <div className="flex h-36 w-7 items-center justify-center rounded-t-sm bg-gradient-to-r from-[#0b0f14] via-[#1c232c] to-[#0b0f14] shadow-md" aria-hidden>
            <span className="rotate-90 whitespace-nowrap font-mono text-[8px] tracking-[0.3em] text-[#fff]/50">AMNEX · GOMS · AMNEX</span>
          </div>
          <div className="h-5 w-4 rounded-b-sm bg-gradient-to-b from-zinc-300 to-zinc-500 shadow" aria-hidden />
          <motion.div className="flex origin-top flex-col items-center will-change-transform" style={{ rotate: ringLag, y: stretch }}>
          <div className="-mt-0.5 h-4 w-4 rounded-full border-[3px] border-zinc-400" aria-hidden />

          <motion.button type="button" aria-label={`ID card for ${name}. ${flipped ? 'Showing back' : 'Showing front'}; double-click to flip.`}
            onPointerDown={onDown} onPointerMove={onHoldMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
            onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
            onDoubleClick={() => setFlipped((f) => !f)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped((f) => !f) } }}
            animate={{ rotateY: flipped ? 180 : 0 }} transition={{ type: 'spring', damping: 18, stiffness: 140 }}
            className="relative -mt-1 h-[25rem] w-60 cursor-grab rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-goms-sky active:cursor-grabbing"
            style={{ touchAction: 'none' }}>
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-[#fff]/10 bg-[#11161d] p-4 text-[#fff] shadow-[0_40px_70px_-25px_rgba(0,0,0,0.6)] [backface-visibility:hidden]">
              <div className="mx-auto -mt-1 mb-3 h-2 w-10 rounded-full bg-black/60 ring-1 ring-[#fff]/10" aria-hidden />
              <div className="flex items-center justify-between">
                <span className="text-base font-bold tracking-tight">amnex<span className="text-crimson">.</span></span>
                <span className="rounded bg-[#fff]/10 px-1.5 py-0.5 font-mono text-[8px] tracking-widest text-[#fff]/70">EMPLOYEE ID</span>
              </div>
              <div className="mt-3 flex flex-col items-center text-center">
                <Avatar person={{ name, photoUrl: person.photoUrl }} size="lg" className="h-28 w-28 text-3xl ring-[3px] ring-[#fff]/20" />
                <p className="mt-2.5 max-w-full truncate text-[16px] font-semibold leading-tight">{name}</p>
                <p className="max-w-full truncate text-[11px] text-[#fff]/60">{person.designation || 'Amnex employee'}</p>
              </div>
              <dl className="mt-3 space-y-1.5 border-t border-[#fff]/10 pt-3 font-mono text-[10px]">
                {[['EMP', code], ['BASE', person.base || '—'], ['MAIL', person.email || '—']].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-[#fff]/40">{k}</dt><dd className="truncate text-[#fff]/85">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-auto flex flex-col items-center gap-1">
                <Barcode seed={code + name} />
                <span className="font-mono text-[8px] tracking-[0.25em] text-[#fff]/40">GOMS-{code}</span>
              </div>
              {/* Glare slides with the cursor; a transform, so it never repaints the card. */}
              <motion.div aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-[200%] bg-[linear-gradient(115deg,transparent_40%,rgba(255,255,255,0.12)_50%,transparent_60%)] will-change-transform" style={{ x: glareX }} />
            </div>
            <div className="absolute inset-0 flex flex-col items-center rounded-2xl border border-[#fff]/10 bg-[#11161d] p-5 text-[#fff] [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <span className="font-mono text-[9px] tracking-[0.3em] text-[#fff]/50">SCAN FOR ACCESS</span>
              <div className="mt-4 h-36 w-36 rounded-lg bg-[#fff] p-2"><QrPattern seed={code + name} /></div>
              <p className="mt-4 text-center text-[11px] leading-snug text-[#fff]/60">If found, please return to Amnex Infotechnologies front desk.</p>
              <div className="mt-auto h-1.5 w-full rounded-full bg-gradient-to-r from-goms-navy via-crimson to-goms-navy" aria-hidden />
            </div>
          </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>
      </div>
    </div>
  )
}
