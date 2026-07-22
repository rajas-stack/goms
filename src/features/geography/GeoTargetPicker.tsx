import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useBreadcrumb, useChildCounts, useChildren, useNode, useStateNode } from '@/lib/api'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { GeoBreadcrumb } from './GeoBreadcrumb'
import { EntityGrid } from './EntityGrid'
import type { HierNode } from '@/lib/types'

/** Picker-mode sibling of `GeographyExplorer`'s drill-down: State → District
 *  → Taluka (the same `useChildren`/`useBreadcrumb` chain, the same
 *  `EntityGrid` tiles, and the same `GeoBreadcrumb`), but with no map
 *  rendering and no `useWorkspace()` — selecting a tile calls `onPick(node)`.
 *  Stops at Taluka on purpose: villages aren't real drill targets here, and
 *  every level down to Taluka can validly parent the next real geo type
 *  (District/Taluka/Village respectively), so every tile shows the pick
 *  affordance — no `requireChildType` filtering needed, unlike the org
 *  picker's Branch/Division/Office/Unit ambiguity. */
export function GeoTargetPicker({ open, stateCode, title, pickLabel, onPick, onClose }: {
  open: boolean
  stateCode: number
  title: string
  pickLabel: (node: HierNode) => string
  onPick: (node: HierNode) => void
  onClose: () => void
}) {
  const { data: stateNode } = useStateNode(stateCode)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (open) setSelectedId(stateNode?.id ?? null)
  }, [open, stateNode])

  const effectiveId = selectedId ?? stateNode?.id ?? null
  const { data: current } = useNode(effectiveId)
  const { data: fullTrail = [] } = useBreadcrumb(effectiveId)
  const { data: children = [] } = useChildren(effectiveId)
  const { data: counts = {} } = useChildCounts(effectiveId)

  const trail = (() => {
    if (!stateNode) return []
    const idx = fullTrail.findIndex((n) => n.id === stateNode.id)
    return idx >= 0 ? fullTrail.slice(idx) : fullTrail
  })()
  const atRoot = effectiveId === stateNode?.id
  const atTaluka = current?.typeKey === 'taluka'
  const currentType = current ? NODE_TYPE_MAP[current.typeKey] : undefined
  // Taluka's children are villages — a real drill target elsewhere, but not
  // something this picker lets you browse into or pick as a parent.
  const items = atTaluka ? [] : children

  function back() {
    if (trail.length >= 2) setSelectedId(trail[trail.length - 2].id)
  }

  function close() {
    setSelectedId(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={title} size="lg">
      <div className="flex h-[28rem] max-h-[65vh] flex-col overflow-hidden rounded-card border border-line">
        <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-panel/40 px-3 py-2.5">
          <Tooltip label="Back one level" side="bottom">
            <button
              onClick={back}
              disabled={atRoot}
              aria-label="Back one level"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
            >
              <Icon name="ArrowLeft" size={15} />
            </button>
          </Tooltip>
          <GeoBreadcrumb root={stateNode} trail={trail} onSelect={(id) => setSelectedId(id ?? stateNode?.id ?? null)} />
          <span className="ml-auto shrink-0 text-[12px] text-muted">
            <span className="eyebrow mr-1.5">{currentType?.label ?? 'State'}</span>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4">
          {!stateNode ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">Loading…</div>
          ) : atTaluka ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-white/60 p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
                <Icon name="Map" size={20} />
              </div>
              <p className="max-w-xs text-sm font-medium text-ink-900">{current?.name} has no further drill-down here.</p>
              <p className="text-xs text-muted">Use the "{pickLabel(current!)}" button below to add a village under it.</p>
            </div>
          ) : (
            <EntityGrid
              items={items}
              counts={counts}
              countNoun={atRoot ? 'taluka' : current?.typeKey === 'district' ? 'village' : 'item'}
              icon="MapPin"
              getIcon={(node) => NODE_TYPE_MAP[node.typeKey]?.icon}
              emptyMessage={`${current?.name ?? 'This region'} has no children recorded yet.`}
              onSelect={(node) => setSelectedId(node.id)}
              onAdd={(node) => { onPick(node); close() }}
              addLabel={pickLabel}
            />
          )}
          {current && (
            <button
              type="button"
              onClick={() => { onPick(current); close() }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[13px] font-medium text-teal-600 hover:border-teal-600 hover:bg-teal-100/40"
            >
              <Icon name="Plus" size={14} /> {pickLabel(current)}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
