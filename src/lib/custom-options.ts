import { useCallback, useState } from 'react'

const PREFIX = 'gorms:custom-options:'

function readStored(key: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeStored(key: string, values: string[]) {
  localStorage.setItem(PREFIX + key, JSON.stringify(values))
}

/** Options a user has added to a dropdown via its "+" button, persisted per
 *  `storageKey` (localStorage) so they're still there next time — this app
 *  has no backend yet, so this is the option list's source of truth for
 *  anything beyond the shipped defaults. */
export function useCustomOptions(storageKey: string): [string[], (label: string) => string] {
  const [custom, setCustom] = useState(() => readStored(storageKey))

  const addOption = useCallback((label: string) => {
    const trimmed = label.trim()
    if (!trimmed) return trimmed
    setCustom((prev) => {
      if (prev.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return prev
      const next = [...prev, trimmed]
      writeStored(storageKey, next)
      return next
    })
    return trimmed
  }, [storageKey])

  return [custom, addOption]
}
