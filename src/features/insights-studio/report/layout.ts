import { REPORT_GRID_COLUMNS, STUDIO_LIMITS, type ChartType, type ReportWidget } from '@goms/domain'

/** Pure, immutable layout operations for the 12-column report grid. After any move or resize, widgets that would
 *  overlap the changed one are pushed down, so the canvas never stacks cards on top of each other. */

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const overlaps = (a: ReportWidget, b: ReportWidget) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function resolveCollisions(widgets: readonly ReportWidget[], anchorId: string): ReportWidget[] {
  const anchor = widgets.find((w) => w.id === anchorId)
  if (!anchor) return [...widgets]
  const placed: ReportWidget[] = [anchor]
  const rest = widgets.filter((w) => w.id !== anchorId).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const w of rest) {
    let next = w
    while (placed.some((p) => overlaps(p, next))) {
      const blocker = placed.filter((p) => overlaps(p, next)).reduce((low, p) => Math.max(low, p.y + p.h), 0)
      next = { ...next, y: blocker }
    }
    placed.push(next)
  }
  return widgets.map((w) => placed.find((p) => p.id === w.id)!)
}

const update = (widgets: readonly ReportWidget[], id: string, fn: (w: ReportWidget) => ReportWidget) =>
  resolveCollisions(widgets.map((w) => (w.id === id ? fn(w) : w)), id)

export const moveWidget = (widgets: readonly ReportWidget[], id: string, dx: number, dy: number) =>
  update(widgets, id, (w) => ({ ...w, x: clamp(w.x + dx, 0, REPORT_GRID_COLUMNS - w.w), y: clamp(w.y + dy, 0, 500) }))

export const placeWidget = (widgets: readonly ReportWidget[], id: string, x: number, y: number) =>
  update(widgets, id, (w) => ({ ...w, x: clamp(x, 0, REPORT_GRID_COLUMNS - w.w), y: clamp(y, 0, 500) }))

export const resizeWidget = (widgets: readonly ReportWidget[], id: string, dw: number, dh: number) =>
  update(widgets, id, (w) => ({ ...w, w: clamp(w.w + dw, 1, REPORT_GRID_COLUMNS - w.x), h: clamp(w.h + dh, 1, STUDIO_LIMITS.maxHeight) }))

export const sizeWidget = (widgets: readonly ReportWidget[], id: string, width: number, height: number) =>
  update(widgets, id, (w) => ({ ...w, w: clamp(width, 1, REPORT_GRID_COLUMNS - w.x), h: clamp(height, 1, STUDIO_LIMITS.maxHeight) }))

export const bottomOf = (widgets: readonly ReportWidget[]) => widgets.reduce((n, w) => Math.max(n, w.y + w.h), 0)

export function nextWidgetId(widgets: readonly ReportWidget[]): string {
  const used = new Set(widgets.map((w) => w.id))
  let n = widgets.length + 1
  while (used.has(`w${n}`)) n++
  return `w${n}`
}

export function defaultSize(chart: ChartType | 'text'): { w: number; h: number } {
  if (chart === 'text') return { w: 12, h: 1 }
  if (chart === 'kpi') return { w: 3, h: 2 }
  return { w: 6, h: 4 }
}

/** Adds a widget at the bottom-left of the canvas. */
export function addWidget(widgets: readonly ReportWidget[], widget: Omit<ReportWidget, 'id' | 'x' | 'y' | 'w' | 'h'>, size: { w: number; h: number }): ReportWidget[] {
  return [...widgets, { ...widget, id: nextWidgetId(widgets), x: 0, y: bottomOf(widgets), ...size }]
}

export const removeWidget = (widgets: readonly ReportWidget[], id: string) => widgets.filter((w) => w.id !== id)

export function duplicateWidget(widgets: readonly ReportWidget[], id: string): ReportWidget[] {
  const source = widgets.find((w) => w.id === id)
  return source ? [...widgets, { ...source, id: nextWidgetId(widgets), x: 0, y: bottomOf(widgets) }] : [...widgets]
}

export const patchWidget = (widgets: readonly ReportWidget[], id: string, patch: Partial<Pick<ReportWidget, 'title' | 'text'>>) =>
  widgets.map((w) => (w.id === id ? { ...w, ...patch } : w))
