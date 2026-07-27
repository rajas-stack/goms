import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useRelatedRecords, useSearch } from '@/lib/api'
import { SEARCH_CATEGORIES, SEARCH_CATEGORY_MAP, type SearchCategoryColor } from '@/lib/search-categories'
import type { SearchResult } from '@/lib/types'
import { Icon } from './ui/Icon'
import { Badge, CodeChip } from './ui/Badge'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

const EXAMPLES = [
  'Connected officers', 'Vacant positions', 'Follow-ups due today',
  'IAS officers in Gujarat', 'Transferred officers', 'People reporting to Director',
  'Everyone under Revenue', 'High priority contacts',
]

const CATEGORY_CHIP: Record<SearchCategoryColor, string> = {
  teal: 'bg-teal-100 text-teal-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  blue: 'bg-blue-100 text-blue-600',
  amber: 'bg-amber-100 text-amber-600',
  purple: 'bg-purple-100 text-purple-600',
}

function resultKey(r: SearchResult) {
  return `${r.category}:${r.id}`
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState<SearchResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { data: results = [] } = useSearch(q)
  const { data: related = [], isLoading: relatedLoading } = useRelatedRecords(expanded)
  // Below `lg`, the palette is a full-screen page instead of a small
  // dropped-in panel — matches the plan's explicit "CommandPalette
  // (full-screen on mobile)" target, mirroring Dialog's own mobile variant.
  // At `lg` and up, every class below reverts to the exact original layout.
  const isMobile = useMediaQuery('(max-width: 1023.98px)')

  const grouped = useMemo(() => {
    const byCategory = new Map<string, SearchResult[]>()
    for (const r of results) {
      const list = byCategory.get(r.category) ?? []
      list.push(r)
      byCategory.set(r.category, list)
    }
    return SEARCH_CATEGORIES
      .map((c) => ({ category: c, items: byCategory.get(c.key) ?? [] }))
      .filter((g) => g.items.length > 0)
  }, [results])

  const flatRows = useMemo(() => grouped.flatMap((g) => g.items), [grouped])
  const rowIndex = useMemo(() => new Map(flatRows.map((r, i) => [resultKey(r), i])), [flatRows])

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setExpanded(null)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => { setActive(0); setExpanded(null) }, [q])

  function go(r: SearchResult) {
    onClose()
    const path = SEARCH_CATEGORY_MAP[r.category]?.path?.(r)
    if (path) { navigate(path); return }
    if (r.stateCode != null) navigate(`/state/${r.stateCode}?sel=${r.id}&kind=${r.kind}`)
    else navigate('/')
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flatRows.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && flatRows[active]) { e.preventDefault(); go(flatRows[active]) }
  }

  return (
    // Always mounted (never gated behind AnimatePresence) so pointer-events
    // tracks the live `open` value — otherwise the exiting backdrop keeps its
    // full-screen onClick active for its whole fade-out, swallowing whatever
    // the user clicks next. See Dialog.tsx for the same fix.
    <div
      data-canvas-ui
      className={cn(
        'fixed inset-0 z-[55] flex items-stretch justify-center p-0 lg:items-start lg:p-4 lg:pt-[12vh]',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
            <motion.div
            className="relative flex h-full w-full flex-col overflow-hidden bg-paper lg:block lg:h-auto lg:max-w-xl lg:rounded-2xl lg:border lg:border-line lg:shadow-pop"
            initial={isMobile ? { opacity: 0, y: 24 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isMobile ? { opacity: 0, y: 24 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={isMobile ? { type: 'spring', stiffness: 340, damping: 32 } : { type: 'spring', stiffness: 340, damping: 30 }}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4">
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

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2 lg:max-h-[52vh] lg:flex-none">
              {q && results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{q}”.</p>
              )}
              {!q && (
                <div className="px-3 py-6">
                  <p className="mb-3 text-center text-sm text-muted">
                    Search across both hierarchies, every employee, and every meeting — or ask in plain language.
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
              {grouped.map((g) => (
                <div key={g.category.key} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {g.category.label}
                  </p>
                  {g.items.map((r) => {
                    const i = rowIndex.get(resultKey(r)) ?? 0
                    const isExpanded = expanded != null && resultKey(expanded) === resultKey(r)
                    return (
                      <div key={resultKey(r)}>
                        <button
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(r)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                            i === active ? 'bg-ink-900/[0.06]' : 'hover:bg-ink-900/[0.03]',
                          )}
                        >
                          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', CATEGORY_CHIP[g.category.color])}>
                            <Icon name={g.category.icon} size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                            <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                          </span>
                          {r.note && <Badge tone="neutral">{r.note}</Badge>}
                          {r.kind === 'node' && <CodeChip code={r.code} />}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : r) }}
                            aria-label={isExpanded ? 'Hide related records' : 'Show related records'}
                            className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-ink-900/[0.06] hover:text-ink"
                          >
                            <Icon name="ChevronDown" size={13} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                          </button>
                          <Icon name="CornerDownLeft" size={13} className={cn('text-muted', i === active ? 'opacity-100' : 'opacity-0')} />
                        </button>
                        {isExpanded && (
                          <div className="ml-11 mt-1 space-y-0.5 border-l border-line pl-3">
                            {relatedLoading ? (
                              <p className="px-2 py-1.5 text-xs text-muted">Loading…</p>
                            ) : related.length === 0 ? (
                              <p className="px-2 py-1.5 text-xs text-muted">No related records</p>
                            ) : (
                              related.map((rel) => {
                                const relCategory = SEARCH_CATEGORY_MAP[rel.category]
                                return (
                                  <button
                                    key={resultKey(rel)}
                                    onClick={() => go(rel)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-900/[0.03]"
                                  >
                                    <span className={cn(
                                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                                      relCategory ? CATEGORY_CHIP[relCategory.color] : 'bg-panel text-muted',
                                    )}>
                                      <Icon name={relCategory?.icon ?? 'Circle'} size={12} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-medium text-ink-900">{rel.title}</span>
                                      <span className="block truncate text-[11px] text-muted">{rel.subtitle}</span>
                                    </span>
                                  </button>
                                )
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
