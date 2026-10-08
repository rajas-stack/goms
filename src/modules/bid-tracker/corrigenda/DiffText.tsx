import type { ChangeHunk, DiffSegment } from './textDiff'
import { cn } from '@/lib/utils'

/** One column of a clause comparison. Only the changed words carry colour:
 *  deletions in the original (struck, crimson), additions in the modified
 *  text (emerald). Uses <del>/<ins> so assistive tech announces them. */
export function DiffText({ segments, className }: { segments: DiffSegment[]; className?: string }) {
  return (
    <p className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-800', className)}>
      {segments.map((s, i) => {
        if (s.type === 'removed') {
          return (
            <del key={i} data-diff="removed" className="rounded-[3px] bg-crimson-100 px-0.5 text-crimson decoration-crimson/70 decoration-2">
              {s.text}
            </del>
          )
        }
        if (s.type === 'added') {
          return (
            <ins key={i} data-diff="added" className="rounded-[3px] bg-emerald-100 px-0.5 font-semibold text-emerald-700 no-underline shadow-[inset_0_-2px_0_rgb(var(--c-emerald)/0.55)]">
              {s.text}
            </ins>
          )
        }
        return <span key={i}>{s.text}</span>
      })}
    </p>
  )
}

const KIND_ICON: Record<ChangeHunk['kind'], string> = { modified: '→', added: '+', removed: '−' }
const truncate = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** The "WHAT CHANGED" chips: `₹100 Crore → ₹75 Crore`. */
export function WhatChanged({ hunks }: { hunks: ChangeHunk[] }) {
  if (!hunks.length) return <span className="text-[13px] text-muted">No textual change</span>
  return (
    <ul className="flex flex-wrap gap-2" aria-label="What changed">
      {hunks.map((h, i) => (
        <li key={i} data-testid="what-changed" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] tabular-nums shadow-sm">
          {h.before && <span className="text-crimson line-through decoration-crimson/60">{truncate(h.before)}</span>}
          <span aria-hidden className="font-semibold text-muted">{KIND_ICON[h.kind]}</span>
          <span className="sr-only">{h.kind === 'modified' ? 'changed to' : h.kind}</span>
          {h.after && <span className="font-semibold text-emerald-700">{truncate(h.after)}</span>}
        </li>
      ))}
    </ul>
  )
}
