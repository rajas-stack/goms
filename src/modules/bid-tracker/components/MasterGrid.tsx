import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type Row, type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { OPERATORS_BY_TYPE, type CustomFieldType, type CustomValue, type TypedFilterRule } from '@goms/domain'
import { motion } from 'framer-motion'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import {
  useBidCustomFields, useBidMutations, useBidsForGrid, useOpportunityMutations, useOwnershipMutations, useSalesPersons,
  useSetBidCustomValue, useStates,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { BidGridRow } from '@/lib/types'
import {
  ATTENTION_OPTIONS, CUSTOM_GROUP, GRID_GROUPS, cellValue, columnWidth, ignoredRules, isEmptyCell, isRuleComplete,
  resolveColumns, resolveVisibleColumns, rowMatchesSearch, type GridColumnMeta,
} from '../gridColumns'
import { AddCustomColumnDialog } from './AddCustomColumnDialog'
import { ColumnHeaderMenu } from './ColumnHeaderMenu'
import { CreateBidDialog } from './CreateBidDialog'
import { FilterBar } from './FilterBar'
import { ManageColumnsPanel } from './ManageColumnsPanel'
import { EditableCell, type CellDraft } from './EditableCell'
import { FilterBuilder } from './FilterBuilder'

const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], BadgeTone> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}
// State is typed `number` (its code, for filtering) but displays a name.
const rightAligned = (col: GridColumnMeta) => col.type === 'number' && col.id !== 'stateCode'

const ROW_HEIGHT = 32
const SELECT_COL_WIDTH = 40
// Spreadsheet surfaces: editable cells are white, read-only cells a cool grey, so
// "can I type here?" is answered before the pointer gets there. Frozen cells need
// solid fills (they sit over scrolling content), hence explicit colours.
const EDITABLE_BG = 'bg-white group-hover/row:bg-[#F3F5FD]'
const READONLY_BG = 'bg-[#F6F7FA] group-hover/row:bg-[#EEF1F8]'
const SELECTED_BG = 'bg-[#E7EAFC]'

/** Empty cells become `undefined` so `sortUndefined: 'last'` keeps them at the
 *  bottom in BOTH directions. */
const sortValue = (row: BidGridRow, col: GridColumnMeta) => {
  const v = cellValue(row, col)
  return isEmptyCell(v) ? undefined : v
}

/** Typed comparison: numbers numerically, dates chronologically, booleans
 *  false<true, everything else case-insensitive natural order. */
function compareTyped(type: CustomFieldType | null, a: unknown, b: unknown): number {
  switch (type) {
    case 'number': return Number(a) - Number(b)
    case 'date': return String(a).slice(0, 10).localeCompare(String(b).slice(0, 10))
    case 'boolean': return Number(Boolean(a)) - Number(Boolean(b))
    default: return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  }
}

const helper = createColumnHelper<BidGridRow>()

function ToolbarPopover({ label, icon, badge, children }: {
  label: string; icon: string; badge?: number; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchorRef} className="relative inline-block">
      <Button variant="secondary" size="sm" className="h-7 px-2.5" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} size={14} /> {label}
        {badge ? <span className="rounded-full bg-ink-900 px-1.5 text-[11px] text-paper">{badge}</span> : null}
      </Button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} maxPanelHeight={480}>
        {({ maxHeight }) => (
          <motion.div
            data-canvas-ui
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            style={{ maxHeight }}
            className="overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper shadow-pop"
          >
            {children}
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}

export interface MasterGridProps {
  /** Filter rules. Controlled when `onFilterRulesChange` is given (a saved view
   *  owns them); otherwise the grid keeps its own, seeded from this. */
  filterRules?: TypedFilterRule[]
  onFilterRulesChange?: (rules: TypedFilterRule[]) => void
  /** ORDERED visible column ids — the array saved views persist (order =
   *  display order, absence = hidden). Same controlled/uncontrolled rule.
   *  Undefined/empty = default: every column, canonical order. */
  visibleColumns?: string[]
  onVisibleColumnsChange?: (columns: string[]) => void
}

export function MasterGrid(props: MasterGridProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // --- controlled-or-internal state -----------------------------------------
  const [innerRules, setInnerRules] = useState<TypedFilterRule[]>(props.filterRules ?? [])
  const rules = props.onFilterRulesChange ? (props.filterRules ?? []) : innerRules
  const setRules = (next: TypedFilterRule[]) => (props.onFilterRulesChange ?? setInnerRules)(next)
  const [innerVisible, setInnerVisible] = useState<string[] | undefined>(props.visibleColumns)
  const visibleIds = props.onVisibleColumnsChange ? props.visibleColumns : innerVisible
  const setVisibleIds = (next: string[]) => (props.onVisibleColumnsChange ?? setInnerVisible)(next)

  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [createBidOpen, setCreateBidOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reassignOpen, setReassignOpen] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [editingRule, setEditingRule] = useState<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // A column just added: scrolled into view and briefly highlighted, so a new
  // column off at the far right of a wide sheet is never "where did it go?".
  const [flashId, setFlashId] = useState<string | null>(null)
  const scrollToId = useRef<string | null>(null)

  // --- data -------------------------------------------------------------------
  const appliedRules = useMemo(() => rules.filter(isRuleComplete), [rules])
  const { data: fetched, isLoading } = useBidsForGrid(appliedRules)
  const { data: customFields = [] } = useBidCustomFields()
  const { data: states = [] } = useStates()
  const { archive, unarchive } = useBidMutations()
  const { assign } = useOwnershipMutations()
  const { data: salesPersons = [] } = useSalesPersons()
  const setCustomValue = useSetBidCustomValue()
  const { update: updateOpportunity } = useOpportunityMutations()
  const stateName = useMemo(() => new Map(states.map((s) => [s.code, s.name])), [states])

  const allColumns = useMemo(() => resolveColumns(customFields), [customFields])
  const visible = useMemo(() => resolveVisibleColumns(allColumns, visibleIds), [allColumns, visibleIds])
  const ignored = useMemo(() => ignoredRules(rules, allColumns), [rules, allColumns])
  const filterable = useMemo(() => allColumns.filter((c) => c.type !== null), [allColumns])
  const columnById = useMemo(() => new Map(allColumns.map((c) => [c.id, c])), [allColumns])

  const rows = useMemo(
    () => (fetched ?? []).filter((r) => rowMatchesSearch(r, visible, search)),
    [fetched, visible, search],
  )

  // --- selection & bulk actions -----------------------------------------------
  // Selection is by bid id and only ever counts rows still on screen, so a
  // filter or search change cannot leave an invisible row selected.
  const visibleIdSet = useMemo(() => new Set(rows.map((r) => r.id)), [rows])
  const selectedIds = useMemo(() => [...selected].filter((id) => visibleIdSet.has(id)), [selected, visibleIdSet])
  const allSelected = rows.length > 0 && selectedIds.length === rows.length
  const toggleRow = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
  const runBulk = async (action: (id: string) => Promise<unknown>) => {
    setBulkError(null)
    const failed: string[] = []
    for (const id of selectedIds) {
      try { await action(id) } catch { failed.push(id) }
    }
    // Keep only the failures selected, so the user can see and retry them.
    setSelected(new Set(failed))
    if (failed.length) setBulkError(`${failed.length} of ${selectedIds.length} could not be updated.`)
    return failed.length === 0
  }
  const archiveSelected = () => runBulk((id) => archive.mutateAsync(id))
  const reassignSelected = async (salesPersonId: string) => {
    if (!salesPersonId) return
    const today = new Date().toISOString().slice(0, 10)
    const ok = await runBulk((id) => assign.mutateAsync({ entityType: 'bid', entityId: id, salesPersonId, startDate: today }))
    if (ok) setReassignOpen(false)
  }

  // --- inline edit: optimistic, with rollback + inline error -------------------
  const commitCell = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    const errorKey = `${row.id}:${col.id}`
    setCellErrors((e) => { const { [errorKey]: _drop, ...rest } = e; return rest })
    const snapshot = qc.getQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] })
    const patchRow = (r: BidGridRow): BidGridRow => {
      if (col.custom) {
        const customValues = { ...r.customValues }
        if (value === null) delete customValues[col.custom.key]
        else customValues[col.custom.key] = value as CustomValue
        return { ...r, customValues }
      }
      return { ...r, [col.id]: value } as BidGridRow
    }
    qc.setQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] }, (old) => old?.map((r) => (r.id === row.id ? patchRow(r) : r)))
    try {
      if (col.custom) await setCustomValue.mutateAsync({ bidId: row.id, fieldId: col.custom.id, value })
      else await updateOpportunity.mutateAsync({ id: row.opportunityId, patch: { [col.id]: value } })
    } catch (e) {
      for (const [key, data] of snapshot) qc.setQueryData(key, data)
      setCellErrors((errs) => ({ ...errs, [errorKey]: e instanceof Error ? e.message : 'Could not save.' }))
    }
  }

  // --- filters ---------------------------------------------------------------
  const addRule = (fieldId?: string) => {
    const col = (fieldId ? filterable.find((c) => c.id === fieldId) : undefined) ?? filterable[0]
    if (!col?.type) return
    setRules([...rules, { field: col.id, operator: OPERATORS_BY_TYPE[col.type][0], value: '' }])
    setEditingRule(rules.length)
  }

  // --- column layout: remove / move / drag ---------------------------------------
  const orderedIds = visible.map((c) => c.id)
  const removeColumn = (id: string) => {
    // An empty list means "default view = every column", so the last column stays.
    if (orderedIds.length > 1) setVisibleIds(orderedIds.filter((v) => v !== id))
  }
  const moveColumn = (id: string, delta: -1 | 1) => {
    const i = orderedIds.indexOf(id)
    const t = i + delta
    if (i < 0 || t < 0 || t >= orderedIds.length) return
    const next = [...orderedIds]
    ;[next[i], next[t]] = [next[t], next[i]]
    setVisibleIds(next)
  }
  const dropColumn = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const from = orderedIds.indexOf(fromId)
    const to = orderedIds.indexOf(toId)
    if (from < 0 || to < 0) return
    const next = orderedIds.filter((i) => i !== fromId)
    next.splice(from < to ? next.indexOf(toId) + 1 : next.indexOf(toId), 0, fromId)
    setVisibleIds(next)
  }

  // --- cells ----------------------------------------------------------------------
  const renderCell = (row: BidGridRow, col: GridColumnMeta): ReactNode => {
    const v = cellValue(row, col)
    const dash = <span className="text-muted">—</span>
    if (col.id === 'manage') {
      return (
        <Button
          variant="ghost" size="sm" className="h-6 px-1.5 text-[12px]"
          onClick={(e) => { e.stopPropagation(); (row.status === 'archived' ? unarchive : archive).mutate(row.id) }}
        >
          {row.status === 'archived' ? 'Unarchive' : 'Archive'}
        </Button>
      )
    }
    if (col.id === 'attentionFlag') {
      const flag = row.attentionFlag
      return <Badge tone={ATTENTION_TONE[flag]}>{ATTENTION_OPTIONS.find((o) => o.value === flag)?.label ?? flag}</Badge>
    }
    if (col.id === 'tenderLink') {
      return row.tenderLink
        ? <a href={row.tenderLink} target="_blank" rel="noreferrer" className="text-indigo-600 underline" onClick={(e) => e.stopPropagation()}>Link</a>
        : dash
    }
    if (col.id === 'stateCode') return v === null || v === undefined ? dash : (stateName.get(v as number) ?? String(v))
    if (col.id === 'updatedAt' && typeof v === 'string') return <span className="tabular-nums">{v.slice(0, 16).replace('T', ' ')}</span>
    if (col.id === 'decision') return <span className="capitalize">{String(v).replace('_', ' ')}</span>
    if (isEmptyCell(v)) return dash
    if (col.type === 'boolean') return v ? <Icon name="Check" size={14} className="text-emerald-600" /> : <span className="text-muted">No</span>
    if (col.type === 'select') {
      const label = col.options?.find((o) => o.value === v)?.label
      return label ?? (col.group === 'custom' ? `${String(v)} (removed)` : String(v))
    }
    if (col.type === 'number') return <span className="tabular-nums">{String(v)}</span>
    if (col.id === 'opportunityName') return <span className="font-medium text-ink-900">{String(v)}</span>
    return String(v)
  }

  const columns = useMemo<ColumnDef<BidGridRow, unknown>[]>(
    () => visible.map((meta) => helper.accessor((r) => sortValue(r, meta), {
      id: meta.id,
      header: meta.header,
      enableSorting: meta.type !== null,
      // react-table's default is descending-first for non-string columns; every
      // column here starts ascending, like a spreadsheet.
      sortDescFirst: false,
      sortUndefined: 'last',
      sortingFn: (a: Row<BidGridRow>, b: Row<BidGridRow>, id: string) => compareTyped(meta.type, a.getValue(id), b.getValue(id)),
      meta,
    }) as ColumnDef<BidGridRow, unknown>),
    [visible],
  )

  const table = useReactTable({
    data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  // --- virtualization (native <table>: two colSpan spacer rows) -------------------
  const parentRef = useRef<HTMLDivElement>(null)
  const { rows: tableRows } = table.getRowModel()
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // First-paint window, used until the scroll container has been measured.
    initialRect: { width: 1200, height: 800 },
  })
  const virtualItems = virtualizer.getVirtualItems()
  const visibleColumnCount = table.getVisibleLeafColumns().length + 1 // + selection column

  // Group header cells: consecutive visible columns of the same group merge
  // into one colSpan cell. Reordering can split a group into several runs.
  const groupRuns = useMemo(() => {
    const runs: { group: string; label: string; span: number; start: number }[] = []
    for (const [start, c] of visible.entries()) {
      const last = runs[runs.length - 1]
      if (last && last.group === c.group) { last.span += 1; continue }
      const label = c.group === 'custom' ? CUSTOM_GROUP.label : GRID_GROUPS.find((g) => g.id === c.group)!.label
      runs.push({ group: c.group, label, span: 1, start })
    }
    return runs
  }, [visible])

  // Frozen panes: the selection column always, plus the leading column(s) up to
  // and including Opportunity / Mission when it is one of the first two — so the
  // row's name stays on screen while the wide sheet scrolls sideways.
  const frozen = useMemo(() => {
    const nameAt = visible.findIndex((c) => c.id === 'opportunityName')
    const count = nameAt >= 0 && nameAt <= 1 ? nameAt + 1 : 1
    const left = new Map<string, number>()
    let offset = SELECT_COL_WIDTH
    visible.slice(0, count).forEach((c) => { left.set(c.id, offset); offset += columnWidth(c) })
    return { left, lastId: visible[count - 1]?.id, width: offset }
  }, [visible])
  const tableWidth = SELECT_COL_WIDTH + visible.reduce((sum, c) => sum + columnWidth(c), 0)

  const rulesByField = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of appliedRules) m.set(r.field, (m.get(r.field) ?? 0) + 1)
    return m
  }, [appliedRules])

  useEffect(() => {
    const id = scrollToId.current
    if (!id || !parentRef.current) return
    const th = parentRef.current.querySelector(`th[data-col-id="${id}"]`)
    if (!th) return
    scrollToId.current = null
    th.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setFlashId(null), 2600)
    return () => clearTimeout(t)
  })

  if (isLoading) return <div className="p-4 text-sm text-muted">Loading bids…</div>

  const totalCount = fetched?.length ?? 0
  const hasFilters = rules.length > 0
  const frozenStyle = (id: string) => (frozen.left.has(id) ? { left: frozen.left.get(id) } : undefined)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bid-master-grid">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-1.5">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" aria-label="Search bids" placeholder="Search bids…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-52 rounded-lg border border-line bg-white pl-7 pr-2 text-[13px] text-ink focus-visible:focus-ring"
          />
        </div>
        <ToolbarPopover label="Filters" icon="SlidersHorizontal" badge={appliedRules.length}>
          <FilterBuilder columns={filterable} rules={rules} onChange={setRules} />
        </ToolbarPopover>
        <ToolbarPopover label="Columns" icon="List">
          <ManageColumnsPanel all={allColumns} visible={visible} onVisibleChange={setVisibleIds} onAddColumn={() => setAddColumnOpen(true)} />
        </ToolbarPopover>
        <Button variant="secondary" size="sm" className="h-7 px-2.5" onClick={() => setAddColumnOpen(true)}><Icon name="Plus" size={14} /> Add column</Button>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-indigo-100 px-2 py-0.5 text-[13px]" data-testid="bulk-toolbar">
            <span className="font-medium">{selectedIds.length} selected</span>
            <Button variant="secondary" size="sm" className="h-6 px-2" onClick={archiveSelected}>Archive Selected</Button>
            <Button variant="secondary" size="sm" className="h-6 px-2" onClick={() => setReassignOpen(true)}>Reassign Owner</Button>
          </div>
        )}
        {bulkError && <span role="alert" className="text-[12px] text-crimson-600">{bulkError}</span>}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 text-[11.5px] text-muted xl:flex">
            <span className="rounded border border-line bg-white px-1.5 py-px text-ink">Editable</span>
            <span className="rounded border border-line bg-[#F6F7FA] px-1.5 py-px text-ink-600">Read-only</span>
            <span>Click a cell to edit · Enter saves · Esc cancels</span>
          </span>
          <span className="text-[12px] text-muted" aria-live="polite">
            {rows.length === totalCount ? `${totalCount} bids` : `${rows.length} of ${totalCount} bids`}
          </span>
          <Button variant="primary" size="sm" className="h-7 px-2.5" onClick={() => setCreateBidOpen(true)}>
            <Icon name="Plus" size={14} /> Create Bid
          </Button>
        </div>
      </div>

      {hasFilters && (
        <FilterBar
          rules={rules} columns={filterable} columnById={columnById} ignoredCount={ignored.length}
          editing={editingRule} onEditing={setEditingRule}
          onChange={setRules} onAdd={() => addRule()}
        />
      )}

      {/* One scroll element serves vertical virtualization AND horizontal scroll —
          a nested second scroller would desync the virtualizer's offsets. */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-thin" data-testid="grid-scroller">
        <table className="border-separate border-spacing-0 text-[12.5px] text-ink" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: SELECT_COL_WIDTH }} />
            {visible.map((c) => <col key={c.id} style={{ width: columnWidth(c) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                scope="col" rowSpan={2} style={{ left: 0 }}
                className="sticky z-10 border-b-2 border-r border-line border-b-ink-900/30 bg-panel px-0 text-center"
              >
                <div className="flex justify-center">
                  <Checkbox
                    aria-label="Select all rows" checked={allSelected} disabled={rows.length === 0}
                    indeterminate={selectedIds.length > 0 && !allSelected} onChange={toggleAll}
                  />
                </div>
              </th>
              {groupRuns.map((run, i) => (
                <th
                  key={i} colSpan={run.span} scope="colgroup"
                  className="h-6 overflow-hidden whitespace-nowrap border-r border-paper/20 bg-ink-900 px-2 text-left text-[11px] font-semibold tracking-wide text-paper"
                >
                  {/* Sticky, so the label stays readable when its group scrolls under the frozen columns. */}
                  {run.start < frozen.left.size
                    ? run.label
                    : <span className="sticky inline-block" style={{ left: frozen.width + 8 }}>{run.label}</span>}
                </th>
              ))}
            </tr>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as GridColumnMeta
                  const sorted = h.column.getIsSorted()
                  const filteredCount = rulesByField.get(meta.id) ?? 0
                  const isFrozen = frozen.left.has(meta.id)
                  const index = orderedIds.indexOf(meta.id)
                  return (
                    <th
                      key={h.id} scope="col" data-col-id={meta.id} style={frozenStyle(meta.id)}
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      draggable title="Drag to reorder"
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', meta.id); setDragId(meta.id) }}
                      onDragOver={(e) => { if (dragId && dragId !== meta.id) { e.preventDefault(); setDragOverId(meta.id) } }}
                      onDragLeave={() => setDragOverId((cur) => (cur === meta.id ? null : cur))}
                      onDrop={(e) => { e.preventDefault(); if (dragId) dropColumn(dragId, meta.id); setDragId(null); setDragOverId(null) }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                      className={cn(
                        'group/th h-8 border-b-2 border-r border-line border-b-ink-900/30 pl-2 pr-1 text-left transition-colors duration-700',
                        sorted ? 'bg-indigo-100' : 'bg-panel',
                        flashId === meta.id && 'bg-indigo-100 shadow-[inset_0_-3px_0_#5B6EE8]',
                        isFrozen && 'sticky z-10',
                        frozen.lastId === meta.id && 'border-r-2 border-r-ink-900/25',
                        dragId === meta.id && 'opacity-40',
                        dragOverId === meta.id && 'shadow-[inset_3px_0_0_#5B6EE8]',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button" disabled={!h.column.getCanSort()}
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-1 text-left text-[12px] font-semibold text-ink-900',
                            h.column.getCanSort() ? 'cursor-pointer' : 'cursor-default',
                          )}
                          aria-label={h.column.getCanSort() ? `Sort by ${meta.header}` : meta.header}
                        >
                          <span className="truncate" title={meta.header}>{flexRender(h.column.columnDef.header, h.getContext())}</span>
                          {meta.editable && <span title="Editable column" className="shrink-0 text-muted"><Icon name="Pencil" size={10} /></span>}
                        </button>
                        {filteredCount > 0 && (
                          <span title="Filtered" className="inline-flex shrink-0 text-indigo-600">
                            <Icon name="SlidersHorizontal" size={12} />
                            <span className="sr-only">Filtered</span>
                          </span>
                        )}
                        {h.column.getCanSort() && (
                          sorted
                            ? <span className="shrink-0 text-indigo-600"><Icon name={sorted === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={13} /></span>
                            : <span className="shrink-0 text-muted opacity-0 group-hover/th:opacity-60"><Icon name="ChevronsUpDown" size={12} /></span>
                        )}
                        <ColumnHeaderMenu
                          header={meta.header} sorted={sorted}
                          canSort={h.column.getCanSort()}
                          canMoveLeft={index > 0} canMoveRight={index < orderedIds.length - 1}
                          canRemove={orderedIds.length > 1}
                          onSort={(dir) => (dir ? h.column.toggleSorting(dir === 'desc', false) : h.column.clearSorting())}
                          onFilter={meta.type !== null ? () => addRule(meta.id) : null}
                          onMove={(delta) => moveColumn(meta.id, delta)}
                          onRemove={() => removeColumn(meta.id)}
                        />
                      </div>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {/* Virtualization on a native <table>: a <tr> cannot be
                position:absolute inside <tbody>, and a childless <tr> with an
                inline height is not guaranteed to render at that height. The
                skipped rows' space is instead reserved by two spacer rows, each
                holding ONE <td colSpan={visibleColumnCount}> — the cell is what
                actually gives the row height — above the first and below the
                last rendered row. */}
            {tableRows.length > 0 && virtualItems.length > 0 && (
              <tr aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: virtualItems[0].start, padding: 0, border: 0 }} />
              </tr>
            )}
            {virtualItems.map((vi) => {
              const row = tableRows[vi.index]
              const isSelected = selected.has(row.original.id)
              return (
                <tr
                  key={row.id} data-testid="bid-row" style={{ height: ROW_HEIGHT }}
                  className={cn('group/row cursor-pointer', row.original.status === 'archived' && 'opacity-60')}
                  onClick={() => navigate(`/bid-tracker/bid/${row.original.id}`)}
                >
                  <td
                    style={{ left: 0, height: ROW_HEIGHT }}
                    className={cn('sticky z-10 border-b border-r border-line p-0 text-center', isSelected ? SELECTED_BG : READONLY_BG)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-center">
                      <Checkbox aria-label="Select row" checked={isSelected} onChange={() => toggleRow(row.original.id)} />
                    </div>
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as GridColumnMeta
                    const display = renderCell(row.original, meta)
                    return (
                      <td
                        key={cell.id} style={{ ...frozenStyle(meta.id), height: ROW_HEIGHT }}
                        className={cn(
                          'relative overflow-hidden whitespace-nowrap border-b border-r border-line p-0 transition-colors duration-700',
                          meta.editable ? EDITABLE_BG : READONLY_BG,
                          isSelected && SELECTED_BG,
                          rightAligned(meta) && 'text-right',
                          frozen.left.has(meta.id) && 'sticky z-10',
                          frozen.lastId === meta.id && 'border-r-2 border-r-ink-900/25',
                          flashId === meta.id && 'bg-indigo-100',
                        )}
                      >
                        {meta.editable ? (
                          <EditableCell
                            col={meta} value={cellValue(row.original, meta)} display={display}
                            externalError={cellErrors[`${row.original.id}:${meta.id}`]}
                            onCommit={(value) => commitCell(row.original, meta, value)}
                          />
                        ) : (
                          <div className={cn('flex h-[31px] items-center px-2', rightAligned(meta) && 'justify-end')}>
                            <span className="min-w-0 truncate">{display}</span>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {tableRows.length > 0 && virtualItems.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumnCount}
                  style={{ height: virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end, padding: 0, border: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {tableRows.length === 0 && (
          <div className="sticky left-0 flex w-full max-w-full flex-col items-center gap-2 p-8 text-center text-sm text-muted" data-testid="grid-empty">
            {totalCount === 0 && !hasFilters ? 'No bids yet.' : 'No bids match the current search and filters.'}
            {(hasFilters || search) && (
              <Button variant="ghost" size="sm" onClick={() => { setRules([]); setSearch('') }}>Clear search and filters</Button>
            )}
            {totalCount === 0 && !hasFilters && (
              <Button variant="primary" size="sm" onClick={() => setCreateBidOpen(true)}><Icon name="Plus" size={14} /> Create Bid</Button>
            )}
          </div>
        )}
      </div>
      <AddCustomColumnDialog
        open={addColumnOpen} onClose={() => setAddColumnOpen(false)}
        // With an explicit column list (a saved view), absence means hidden — so a
        // brand-new column is appended to it; in the default view it shows itself.
        onCreated={(field) => {
          const id = `custom:${field.key}`
          if (visibleIds?.length) setVisibleIds([...visibleIds, id])
          scrollToId.current = id
          setFlashId(id)
        }}
      />
      <CreateBidDialog open={createBidOpen} onClose={() => setCreateBidOpen(false)} />
      <Dialog
        open={reassignOpen} onClose={() => setReassignOpen(false)}
        title={`Reassign owner for ${selectedIds.length} bid${selectedIds.length === 1 ? '' : 's'}`}
      >
        <Combobox
          value="" onChange={reassignSelected} placeholder="Choose a sales person…"
          options={salesPersons.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Dialog>
    </div>
  )
}
