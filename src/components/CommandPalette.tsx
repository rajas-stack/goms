import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useSearch } from '@/lib/api'
import type { SearchResult } from '@/lib/types'
import { Icon } from './ui/Icon'
import { Badge, CodeChip } from './ui/Badge'
import { cn } from '@/lib/utils'

const EXAMPLES = [
  'Connected officers', 'Vacant positions', 'Follow-ups due today',
  'IAS officers in Gujarat', 'Transferred officers', 'People reporting to Director',
  'Everyone under Revenue', 'High priority contacts',
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { data: results = [] } = useSearch(q)

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => setActive(0), [q])

  function go(r: SearchResult) {
    onClose()
    if (r.stateCode != null) {
      navigate(`/state/${r.stateCode}?sel=${r.id}&kind=${r.kind}`)
    } else {
      navigate('/')
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]) }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div className="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-paper shadow-pop"
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="Search" className="text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search or ask — “connected officers”, “vacant positions”, “IAS in Gujarat”…"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/70"
              />
              {q && (
                <button
                  onClick={() => { setQ(''); inputRef.current?.focus() }}
                  aria-label="Clear search"
                  className="rounded-md p-1 text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                >
                  <Icon name="X" size={15} />
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-muted hover:bg-ink-900/[0.06] hover:text-ink"
              >
                <Icon name="X" />
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto scrollbar-thin p-2">
              {q && results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{q}”.</p>
              )}
              {!q && (
                <div className="px-3 py-6">
                  <p className="mb-3 text-center text-sm text-muted">
                    Search across both hierarchies and every employee — or ask in plain language.
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => { setQ(ex); inputRef.current?.focus() }}
                        className="rounded-full border border-line bg-white px-2.5 py-1 text-[12px] text-ink-700 transition-colors hover:border-ink-600"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.kind}-${r.id}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    i === active ? 'bg-ink-900/[0.06]' : 'hover:bg-ink-900/[0.03]',
                  )}
                >
                  <span className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    r.kind === 'employee' ? 'bg-indigo-100 text-indigo-600' : 'bg-teal-100 text-teal-600',
                  )}>
                    <Icon name={r.kind === 'employee' ? 'User' : 'MapPin'} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                    <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                  </span>
                  {r.note && <Badge tone="neutral">{r.note}</Badge>}
                  {r.kind === 'node' && <CodeChip code={r.code} />}
                  <Icon name="CornerDownLeft" size={13} className={cn('text-muted', i === active ? 'opacity-100' : 'opacity-0')} />
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
