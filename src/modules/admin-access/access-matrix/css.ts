import type { CSSProperties } from 'react'

const cache = new Map<string, CSSProperties>()

/** Turns the design's inline style strings ("display:grid;gap:12px") into React style objects so the screen
 *  keeps the Access Matrix design's CSS verbatim. */
export function css(text: string): CSSProperties {
  const hit = cache.get(text)
  if (hit) return hit
  const out: Record<string, string> = {}
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (!prop) continue
    out[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  cache.set(text, out as CSSProperties)
  return out as CSSProperties
}
