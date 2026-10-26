import { useEffect, useState } from 'react'
import type { GridColumnMeta } from './gridColumns'

// Built-in column names renamed from the header pencil: a display label only (the column id never
// changes, so filters, views and imports keep working), remembered in this browser.
const KEY = 'goms:bidGrid:headerLabels'
export type HeaderLabels = Record<string, string>

export function loadHeaderLabels(): HeaderLabels {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()))
  } catch { return {} }
}

/** A blank name drops the override, so the column goes back to its default name. */
export function withHeaderLabel(labels: HeaderLabels, id: string, name: string): HeaderLabels {
  const { [id]: _previous, ...rest } = labels
  return name.trim() ? { ...rest, [id]: name.trim() } : rest
}

export function applyHeaderLabels(columns: GridColumnMeta[], labels: HeaderLabels): GridColumnMeta[] {
  return columns.map((column) => (labels[column.id] ? { ...column, header: labels[column.id] } : column))
}

/** Current overrides, kept in step with other open tabs through the `storage` event. */
export function useHeaderLabels() {
  const [labels, setLabels] = useState<HeaderLabels>(loadHeaderLabels)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setLabels(loadHeaderLabels()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const setLabel = (id: string, name: string) => {
    const next = withHeaderLabel(loadHeaderLabels(), id, name)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: the rename lasts for this page only */ }
    setLabels(next)
  }
  return { labels, setLabel }
}
