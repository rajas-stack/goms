import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBreadcrumb, useChildCounts, useChildren, useNode } from '@/lib/api'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { GeoBreadcrumb } from './GeoBreadcrumb'
import { GeoMapView, type MapFeature } from './GeoMapView'
import { GeoSidePanel } from './GeoSidePanel'
import { EntityGrid } from './EntityGrid'
import { loadStateDistrictShapes } from './district-shapes'
import { loadStateTalukaShapes } from './taluka-shapes'
import { loadVillageShapes } from './village-shapes'
import { matchDistrictName } from './district-match'
import { loadVillages } from './villages'
import type { HierNode } from '@/lib/types'

type Level = 'state' | 'district' | 'taluka' | 'village'

/** State → District → Taluka → Village drill-down, scoped to one state and
 *  rendered inside that state's workspace. Every level shows a real boundary
 *  map (all sibling regions outlined and named, clickable to drill in) beside
 *  an administrative side panel that updates as you descend.
 *
 *  Geography loads on demand, one state at a time: district boundaries are
 *  bundled per-state chunks; taluka boundaries are bundled per-state chunks
 *  (national coverage); village boundaries are fetched at runtime per state and
 *  cached, so nothing beyond the currently viewed state is ever held in memory.
 *  Boundaries join to this app's nodes by LGD code. Levels/states without
 *  geometry fall back to named tiles (`EntityGrid`). */
export function GeographyExplorer({ stateNodeId }: { stateNodeId: string }) {
  const [selectedId, setSelectedId] = useState(stateNodeId)
  // Villages aren't real repository nodes (there are ~640k nationwide), so the
  // village level is tracked locally rather than through the workspace selection.
  const [village, setVillage] = useState<{ code: string; name: string } | null>(null)

  useEffect(() => {
    setSelectedId(stateNodeId)
    setVillage(null)
  }, [stateNodeId])

  const { data: stateNode } = useNode(stateNodeId)
  const { data: stateDistricts = [] } = useChildren(stateNodeId)
  const { data: current } = useNode(selectedId)
  const { data: fullTrail = [] } = useBreadcrumb(selectedId)
  const { data: children = [] } = useChildren(selectedId)
  const { data: counts = {} } = useChildCounts(selectedId)

  const stateCode = stateNode?.stateCode ?? null
  const realLevel = (current?.typeKey as Level | undefined) ?? 'state'
  const level: Level = village ? 'village' : realLevel
  const atRoot = selectedId === stateNodeId && !village

  const trail = useMemo(() => {
    const idx = fullTrail.findIndex((n) => n.id === stateNodeId)
    const base = idx >= 0 ? fullTrail.slice(idx) : fullTrail
    if (!village) return base
    // Append a display-only crumb for the selected village.
    const villageCrumb = { id: `geo_vl_${village.code}`, name: village.name } as HierNode
    return [...base, villageCrumb]
  }, [fullTrail, stateNodeId, village])

  const drillTo = useCallback((id: string) => { setSelectedId(id); setVillage(null) }, [])
  const goTo = useCallback((id: string | null) => { setSelectedId(id ?? stateNodeId); setVillage(null) }, [stateNodeId])
  const back = useCallback(() => {
    if (village) { setVillage(null); return }
    if (trail.length >= 2) setSelectedId(trail[trail.length - 2].id)
  }, [trail, village])

  const currentType = current ? NODE_TYPE_MAP[current.typeKey] : undefined

  // --- District boundaries (state level) ------------------------------------
  const { data: districtShapes } = useQuery({
    queryKey: ['districtShapes', stateCode],
    queryFn: () => loadStateDistrictShapes(stateCode!),
    enabled: stateCode != null,
  })
  // The district layer is dissolved from the taluka layer by LGD district code
  // (scripts/dissolve-districts.cjs), so every feature carries the same code as
  // its hierarchy node and joins exactly. The name match is only a fallback for
  // a feature whose code somehow isn't in this state's node list.
  const districtFeats = useMemo<MapFeature[]>(() => {
    if (!districtShapes || stateDistricts.length === 0) return []
    const byCode = new Map(
      stateDistricts.filter((d) => d.code).map((d) => [String(Number(d.code)), d] as const),
    )
    const out: MapFeature[] = []
    for (const f of districtShapes.features) {
      const match = byCode.get(String(Number(f.properties.code)))
        ?? matchDistrictName(f.properties.name, stateDistricts as HierNode[])
      if (match) out.push({ code: match.id, name: match.name, geometry: f.geometry })
    }
    return out
  }, [districtShapes, stateDistricts])
  const hasDistrictMap = districtFeats.length > 0
  const unmappedDistricts = useMemo(
    () => stateDistricts.filter((d) => !districtFeats.some((f) => f.code === d.id)),
    [stateDistricts, districtFeats],
  )

  // --- Taluka boundaries (district level) -----------------------------------
  const { data: talukaShapes } = useQuery({
    queryKey: ['talukaShapes', stateCode],
    queryFn: () => loadStateTalukaShapes(stateCode!),
    enabled: stateCode != null,
  })
  // Match this district's taluka child nodes to bundled shapes by LGD code.
  const talukaFeats = useMemo<MapFeature[]>(() => {
    if (!talukaShapes || realLevel !== 'district' || children.length === 0) return []
    const shapeByCode = new Map(talukaShapes.features.map((f) => [f.properties.code, f]))
    const out: MapFeature[] = []
    for (const c of children) {
      const shape = c.code ? shapeByCode.get(c.code) : undefined
      if (shape) out.push({ code: c.id, name: c.name, geometry: shape.geometry })
    }
    return out
  }, [talukaShapes, children, realLevel])
  const hasTalukaMap = talukaFeats.length > 0
  const unmappedTalukas = useMemo(
    () => children.filter((t) => !talukaFeats.some((f) => f.code === t.id)),
    [children, talukaFeats],
  )
  const talukaVillageCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of children) out[c.id] = Number(c.metadata.villageCount ?? 0)
    return out
  }, [children])

  // --- Village boundaries (taluka + village levels) -------------------------
  const talukaCode = realLevel === 'taluka' ? current?.code ?? null : null
  const { data: villageFeats, isLoading: villagesLoading } = useQuery({
    queryKey: ['villageShapes', talukaCode],
    queryFn: () => loadVillageShapes(talukaCode!, stateCode!),
    enabled: (level === 'taluka' || level === 'village') && !!talukaCode,
  })
  const hasVillageMap = !!villageFeats && villageFeats.length > 0

  // Named-tile fallback: villages as a flat list where no polygons exist.
  const { data: villageRows } = useQuery({
    queryKey: ['villages', talukaCode],
    queryFn: () => loadVillages(talukaCode!),
    enabled: level === 'taluka' && !!talukaCode && !hasVillageMap && !villagesLoading,
  })
  const villageNodes = useMemo<HierNode[]>(() => {
    if (!villageRows) return []
    return villageRows.map(([code, name], i) => ({
      id: `geo_vl_${code}`, domain: 'geo', typeKey: 'village', parentId: selectedId,
      stateCode: current?.stateCode ?? null, name, code, sortOrder: i, metadata: {}, status: 'active',
    }))
  }, [villageRows, selectedId, current])

  const selectVillage = useCallback((code: string) => {
    const f = villageFeats?.find((v) => v.code === code)
    if (f) setVillage({ code: f.code, name: f.name })
  }, [villageFeats])

  const headerCount = level === 'state' ? stateDistricts.length
    : level === 'district' ? children.length
    : level === 'taluka' ? (hasVillageMap ? villageFeats!.length : villageNodes.length)
    : 1

  const sidePanelRegion = level === 'state' ? stateNode ?? null
    : level === 'village' ? { name: village!.name, code: null }
    : current ?? null
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white/80 px-4 py-2.5">
        <Tooltip label="Back one level" side="bottom">
          <button
            onClick={back}
            disabled={atRoot}
            aria-label="Back one level"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-panel hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
          >
            <Icon name="ArrowLeft" size={15} />
          </button>
        </Tooltip>
        <GeoBreadcrumb root={trail[0]} trail={trail} onSelect={goTo} />
        <span className="ml-auto shrink-0 text-[12px] text-muted">
          <span className="eyebrow mr-1.5">{level === 'village' ? 'Village' : currentType?.label ?? 'State'}</span>
          {level !== 'village' && `${headerCount} ${childNounFor(level)}${headerCount === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-h-0 overflow-hidden">
          {level === 'state' && (
            hasDistrictMap ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="min-h-0 flex-1">
                  <GeoMapView
                    features={districtFeats}
                    selectedCode={null}
                    onSelect={drillTo}
                    countsByCode={counts}
                    countNoun="taluka"
                    ariaLabel={`Map of ${current?.name ?? 'the state'} — select a district to open it`}
                  />
                </div>
                {unmappedDistricts.length > 0 && (
                  <FallbackTiles items={unmappedDistricts} counts={counts} countNoun="taluka" icon="MapPin" onSelect={drillTo} />
                )}
              </div>
            ) : (
              <TilePane heading="Districts" count={children.length}>
                <EntityGrid items={children} counts={counts} countNoun="taluka" icon="MapPin"
                  emptyMessage={`No districts recorded yet for ${current?.name ?? 'this state'}.`}
                  onSelect={(n) => drillTo(n.id)} />
              </TilePane>
            )
          )}

          {level === 'district' && (
            hasTalukaMap ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="min-h-0 flex-1">
                  <GeoMapView
                    features={talukaFeats}
                    selectedCode={null}
                    onSelect={drillTo}
                    countsByCode={talukaVillageCounts}
                    countNoun="village"
                    ariaLabel={`Map of ${current?.name ?? 'the district'} — select a taluka to open it`}
                  />
                </div>
                {unmappedTalukas.length > 0 && (
                  <FallbackTiles items={unmappedTalukas} counts={talukaVillageCounts} countNoun="village" icon="Map" onSelect={drillTo} />
                )}
              </div>
            ) : (
              <TilePane heading="Talukas / Sub-districts" count={children.length}>
                <EntityGrid items={children} counts={talukaVillageCounts} countNoun="village" icon="Map"
                  emptyMessage={`No sub-districts recorded yet for ${current?.name ?? 'this district'}.`}
                  onSelect={(n) => drillTo(n.id)} />
              </TilePane>
            )
          )}

          {level === 'taluka' && (
            hasVillageMap ? (
              <GeoMapView
                features={villageFeats!}
                selectedCode={null}
                onSelect={selectVillage}
                ariaLabel={`Map of ${current?.name ?? 'the taluka'} — select a village to open it`}
              />
            ) : villagesLoading ? (
              <LoadingPane label="Loading village boundaries…" />
            ) : (
              <TilePane heading="Villages" count={villageNodes.length}>
                <EntityGrid items={villageNodes} counts={{}} countNoun={null} icon="Home"
                  emptyMessage={`No village data available for ${current?.name ?? 'this taluka'}.`} />
              </TilePane>
            )
          )}

          {level === 'village' && (
            hasVillageMap ? (
              <GeoMapView
                features={villageFeats!}
                selectedCode={null}
                onSelect={selectVillage}
                highlightCode={village!.code}
                ariaLabel={`Boundary of ${village!.name}, with neighbouring villages`}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-white/60 p-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
                  <Icon name="Home" size={20} />
                </div>
                <p className="text-sm font-medium text-ink-900">{village!.name} is a village.</p>
                <p className="max-w-xs text-xs text-muted">Use the breadcrumb or Back button to go back up.</p>
              </div>
            )
          )}
        </div>

        <GeoSidePanel
          region={sidePanelRegion}
          levelLabel={levelLabel}
          stateCode={stateCode}
          stateName={stateNode?.name ?? null}
        />
      </div>
    </div>
  )
}

function TilePane({ heading, count, children }: { heading: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-card border border-line bg-panel/40 p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="eyebrow">{heading}</span>
        <span className="font-mono text-[11px] text-muted">{count}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
    </div>
  )
}

/** A residual handful of regions with no bundled boundary still need a way
 *  in — shown as plain tiles alongside the map, with no "gap" messaging. */
function FallbackTiles({ items, counts, countNoun, icon, onSelect }: {
  items: HierNode[]; counts: Record<string, number>; countNoun: string; icon: string; onSelect: (id: string) => void
}) {
  return (
    <div className="max-h-32 shrink-0 overflow-y-auto scrollbar-thin">
      <EntityGrid items={items} counts={counts} countNoun={countNoun} icon={icon} emptyMessage="" onSelect={(n) => onSelect(n.id)} />
    </div>
  )
}

function LoadingPane({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-card border border-line bg-white">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-teal-600" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  )
}

function childNounFor(level: Level): string {
  switch (level) {
    case 'state': return 'district'
    case 'district': return 'taluka'
    case 'taluka': return 'village'
    default: return 'entity'
  }
}
