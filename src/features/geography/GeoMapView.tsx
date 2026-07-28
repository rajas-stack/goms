import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { geoMercator, geoPath } from 'd3-geo'
import type { Geometry } from 'geojson'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { useMapPanZoom } from './useMapPanZoom'

const W = 760
const H = 640

export interface MapFeature {
  code: string
  name: string
  geometry: Geometry
}

interface Feat {
  code: string
  name: string
  d: string
  cx: number
  cy: number
}

/** Signed planar area of a ring (shoelace formula) in lon/lat space. */
function ringArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

/** Some bundled boundary sources (taluka/village, shapefile-derived) wind
 *  rings the opposite way from this app's district data, which makes d3-geo
 *  treat the polygon as covering the whole globe instead of the small region
 *  it actually is (`fitExtent` then squashes real content to a speck at the
 *  frame's center). Enforce this project's working winding sense — exterior
 *  rings negative-signed area, holes positive — regardless of source. */
function rewindRings(rings: number[][][]): number[][][] {
  return rings.map((ring, i) => {
    const isExterior = i === 0
    const needsFlip = isExterior ? ringArea(ring) > 0 : ringArea(ring) < 0
    return needsFlip ? [...ring].reverse() : ring
  })
}

function rewind(geometry: Geometry): Geometry {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: rewindRings(geometry.coordinates) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(rewindRings) }
  }
  return geometry
}

/** Projects a (sub)set of features into the fixed WxH viewBox. Passing every
 *  feature in scope (e.g. all of a state's districts) naturally reconstructs
 *  that parent's silhouette from its parts; passing just one selected feature
 *  re-fits the projection to it alone — which is what gives the "zoom into
 *  the clicked region" effect for free, no manual bounding-box math needed. */
function buildFeats(features: MapFeature[], padding: number): Feat[] {
  const geometries = features.map((f) => rewind(f.geometry))
  const fc = { type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })) } as never
  const projection = geoMercator().fitExtent([[padding, padding], [W - padding, H - padding]], fc)
  const path = geoPath(projection)
  return features.map((f, i) => {
    const geoFeature = { type: 'Feature', properties: {}, geometry: geometries[i] } as never
    const [cx, cy] = path.centroid(geoFeature)
    return { code: f.code, name: f.name, d: path(geoFeature) ?? '', cx, cy }
  })
}

/** A generic zoomable/pannable polygon map, reused at every level of the
 *  Geography explorer that has real boundary geometry (state outlines within
 *  India, district outlines within a state). Given the full set of features
 *  in scope with `selectedCode` null, every feature renders clickable — used
 *  to show "all districts of this state" or "all states of India". Given a
 *  `selectedCode`, only that one feature renders, re-projected to fill the
 *  frame — used to zoom into a single clicked region. Levels with no boundary
 *  geometry (taluka, village) never render this component; they use
 *  `EntityGrid` instead. */
export function GeoMapView({
  features, selectedCode, onSelect,
  countsByCode, countNoun = 'district', ariaLabel, highlightCode,
}: {
  features: MapFeature[]
  selectedCode: string | null
  onSelect: (code: string) => void
  /** feature code → child count, shown in the hover tooltip when clickable. */
  countsByCode?: Record<string, number>
  countNoun?: string
  ariaLabel?: string
  /** When set (with selectedCode null), keeps every sibling boundary visible
   *  but emphasizes this one — used by the village level so context isn't lost. */
  highlightCode?: string | null
}) {
  const [hoverCode, setHoverCode] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const { transform, setTransform, dragging, resetView, zoomBy, onWheel, onPointerDown, onPointerMove, endPan } = useMapPanZoom(viewportRef)

  // Whenever the selected feature changes (drilling in or out), the
  // projection itself already re-fits the new content to the frame — so any
  // leftover manual pan/zoom from the previous view is cleared rather than
  // carried over onto unrelated geometry.
  useEffect(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [selectedCode, setTransform])

  const clickable = selectedCode == null

  const feats = useMemo<Feat[]>(() => {
    if (selectedCode == null) return buildFeats(features, 24)
    const only = features.filter((f) => f.code === selectedCode)
    return buildFeats(only, 40)
  }, [features, selectedCode])

  const hoverFeat = hoverCode != null ? feats.find((f) => f.code === hoverCode) : undefined
  const hoverCount = hoverFeat && countsByCode ? countsByCode[hoverFeat.code] ?? 0 : undefined

  return (
    <div className="relative h-full w-full overflow-hidden rounded-card border border-line bg-white">
      <div
        ref={viewportRef}
        className={cn('h-full w-full touch-none select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel ?? (clickable ? 'Map — select a region to open it' : 'Selected region boundary')}
        >
          <AnimatePresence mode="wait">
            <motion.g
              key={selectedCode ?? 'all'}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{ transformOrigin: '50% 50%' }}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                {feats.map((f) => {
                  const isHover = hoverCode === f.code
                  const isHighlight = highlightCode != null && f.code === highlightCode
                  return (
                    <path
                      key={f.code}
                      d={f.d}
                      onMouseEnter={() => setHoverCode(f.code)}
                      onMouseLeave={() => setHoverCode(null)}
                      onClick={() => clickable && onSelect(f.code)}
                      className={cn(
                        'transition-colors duration-150',
                        clickable ? 'cursor-pointer' : 'cursor-default',
                        isHighlight ? 'fill-teal/30' : isHover && clickable ? 'fill-teal/25' : 'fill-white',
                      )}
                      stroke={isHighlight ? '#22695B' : isHover && clickable ? '#22695B' : '#2B4A70'}
                      strokeOpacity={isHighlight || (isHover && clickable) ? 1 : 0.45}
                      strokeWidth={isHighlight ? 1.6 : isHover && clickable ? 1.4 : 0.7}
                    />
                  )
                })}
                {feats.map((f) => (
                  <text
                    key={`label-${f.code}`}
                    x={f.cx}
                    y={f.cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={clickable ? 9 : 16}
                    className="pointer-events-none select-none font-sans font-medium fill-ink-900"
                    style={{ paintOrder: 'stroke', stroke: '#FAFAF7', strokeWidth: 2.5, strokeLinejoin: 'round' }}
                  >
                    {f.name}
                  </text>
                ))}
              </g>
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>

      {hoverFeat && clickable && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-lg border border-line bg-paper/95 px-2.5 py-1.5 shadow-panel">
          <div className="font-display text-[13px] font-semibold text-ink-900">{hoverFeat.name}</div>
          {hoverCount != null && (
            <div className="mt-0.5 font-mono text-[11px] text-muted">
              {hoverCount} {countNoun}{hoverCount === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}

      {/* Bottom-LEFT on a phone — the global FAB owns the bottom-right corner. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-xl border border-line bg-white/95 p-1 shadow-panel backdrop-blur sm:left-auto sm:right-3" data-map-ui>
        {/* Desktop-only duplicate of Reset (below) — both call `resetView`, and
            the full 5-slot cluster doesn't fit a phone-width map. */}
        <Tooltip label="Fit to screen" className="hidden sm:inline-flex">
          <button onClick={resetView} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Fit to screen">
            <Icon name="Maximize" size={14} />
          </button>
        </Tooltip>
        <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
        <Tooltip label="Zoom out">
          <button onClick={() => zoomBy(0.85)} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom out">
            <span className="text-base leading-none">−</span>
          </button>
        </Tooltip>
        <span className="pointer-events-auto w-10 text-center font-mono text-[11px] text-muted sm:w-11">{Math.round(transform.scale * 100)}%</span>
        <Tooltip label="Zoom in">
          <button onClick={() => zoomBy(1 / 0.85)} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom in">
            <span className="text-base leading-none">+</span>
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Reset view">
          <button onClick={resetView} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Reset view">
            <Icon name="MoveRight" size={14} className="rotate-[225deg]" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
