// Zoom / pan state for the timeline viewport. The window is kept in DAYS
// (start + span) so it is independent of the frame's pixel width; the pixel
// scale is derived from it. Every update goes through the pure clamps.
import { useCallback, useMemo, useState } from 'react'
import {
  centerView, clampView, fitView, lifecycleDomain, panStepDays, panView, scaleView, zoomLevelOf, zoomView,
  type Domain, type ViewWindow, type ZoomLevel, type ZoomPreset,
} from './timelineMath'
import type { IsoDate } from './types'

export interface TimelineViewport {
  domain: Domain
  view: ViewWindow
  zoom: ZoomLevel
  pxPerDay: number
  setZoom: (preset: ZoomPreset, centerDay?: number) => void
  /** Moves by one ← / → step for the current zoom (direction −1 or +1). */
  step: (direction: -1 | 1) => void
  panDays: (days: number) => void
  panPx: (px: number) => void
  centerOn: (day: number) => void
  fit: (fromDay: number, toDay: number) => void
  /** Scales the visible span by `factor` around `anchorDay`. */
  scale: (factor: number, anchorDay: number) => void
  /** Sets the window directly (navigator drag / resize). */
  setWindow: (view: ViewWindow) => void
}

export function useTimelineViewport(startDate: IsoDate, endDate: IsoDate, widthPx: number): TimelineViewport {
  const domain = useMemo(() => lifecycleDomain(startDate, endDate), [startDate, endDate])
  const [raw, setRaw] = useState<ViewWindow>(() => zoomView({ startDay: domain.startDay, spanDays: 1 }, 'All', domain))
  // Re-clamped on read, so a changed domain (new deadline) never leaves the window out of range.
  const view = useMemo(() => clampView(raw, domain), [raw, domain])
  const zoom = zoomLevelOf(view.spanDays, domain)
  const pxPerDay = widthPx / view.spanDays

  const update = useCallback((fn: (v: ViewWindow) => ViewWindow) => {
    setRaw((current) => fn(clampView(current, domain)))
  }, [domain])

  const setZoom = useCallback((preset: ZoomPreset, centerDay?: number) => update((v) => zoomView(v, preset, domain, centerDay)), [update, domain])
  const step = useCallback((direction: -1 | 1) => update((v) => panView(v, direction * panStepDays(zoomLevelOf(v.spanDays, domain), v), domain)), [update, domain])
  const panDays = useCallback((days: number) => update((v) => panView(v, days, domain)), [update, domain])
  const panPx = useCallback((px: number) => update((v) => panView(v, (px * v.spanDays) / Math.max(1, widthPx), domain)), [update, domain, widthPx])
  const centerOn = useCallback((day: number) => update((v) => centerView(v, day, domain)), [update, domain])
  const fit = useCallback((from: number, to: number) => update(() => fitView(from, to, domain)), [update, domain])
  const scale = useCallback((factor: number, anchorDay: number) => update((v) => scaleView(v, factor, anchorDay, domain)), [update, domain])
  const setWindow = useCallback((next: ViewWindow) => update(() => clampView(next, domain)), [update, domain])

  return { domain, view, zoom, pxPerDay, setZoom, step, panDays, panPx, centerOn, fit, scale, setWindow }
}
