import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type Row, type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CustomFieldType, type CustomValue, type TypedFilterRule } from '@goms/domain'
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
  ATTENTION_OPTIONS, CUSTOM_GROUP, GRID_GROUPS, cellValue, ignoredRules, isEmptyCell, isRuleComplete,
  operatorLabel, resolveColumns, resolveVisibleColumns, rowMatchesSearch, type GridColumnMeta,
} from '../gridColumns'
import { AddCustomColumnDialog } from './AddCustomColumnDialog'
import { ManageColumnsPanel } from './ManageColumnsPanel'
import { EditableCell, type CellDraft } from './EditableCell'
import { FilterBuilder } from './FilterBuilder'

const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], BadgeTone> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}
const NUMERIC_TYPES: (CustomFieldType | null)[] = ['number']

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
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
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

function ruleSummary(rule: TypedFilterRule, col: GridColumnMeta | undefined): string {
  const type = col?.type ?? null
  const labelOf = (v: string) => col?.options?.find((o) => o.value === v)?.label ?? v
  const value = rule.operator === 'in'
    ? (rule.values ?? []).map(labelOf).join(', ')
    : rule.operator === 'between' ? `${rule.value} – ${rule.value2 ?? ''}`
    : type === 'boolean' ? (rule.value === 'true' ? 'true' : 'false') : labelOf(rule.value)
  return `${col?.header ?? rule.field} ${operatorLabel(type, rule.operator)} ${value}`
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
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reassignOpen, setReassignOpen] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})

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

  // --- columns ------------------------------------------------------------------
  const renderCell = (row: BidGridRow, col: GridColumnMeta): ReactNode => {
    const v = cellValue(row, col)
    const dash = <span className="text-muted">—</span>
    if (col.id === 'manage') {
      return (
        <Button
          variant="ghost" size="sm"
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
        ? <a href={row.tenderLink} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>Link</a>
        : dash
    }
    if (col.id === 'stateCode') return v === null || v === undefined ? dash : (stateName.get(v as number) ?? String(v))
    if (col.id === 'updatedAt' && typeof v === 'string') return <span className="tabular-nums">{v.slice(0, 16).replace('T', ' ')}</span>
    if (col.id === 'decision') return <span className="capitalize">{String(v).replace('_', ' ')}</span>
    if (isEmptyCell(v)) return dash
    if (col.type === 'boolean') return v ? <Icon name="Check" size={14} className="text-emerald-600" /> : <span className="text-muted">No</span>
    if (col.type === 'select') {
      const label = col.options?.find((o) => o.value === v)?.label
      return col.group === 'custom'
        ? <Badge tone={label ? 'neutral' : 'gray'}>{label ?? `${String(v)} (removed)`}</Badge>
        : (label ?? String(v))
    }
    if (col.type === 'number') return <span className="tabular-nums">{String(v)}</span>
    return <span className={cn(col.id === 'opportunityName' && 'inline-block max-w-[22rem] truncate align-bottom')}>{String(v)}</span>
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
    estimateSize: () => 44,
    overscan: 8,
    // First-paint window, used until the scroll container has been measured.
    initialRect: { width: 1200, height: 800 },
  })
  const virtualItems = virtualizer.getVirtualItems()
  const visibleColumnCount = table.getVisibleLeafColumns().length + 1 // + selection column

  // Group header cells: consecutive visible columns of the same group merge
  // into one colSpan cell. Reordering can split a group into several runs.
  const groupRuns = useMemo(() => {
    const runs: { group: string; label: string; span: number }[] = []
    for (const c of visible) {
      const last = runs[runs.length - 1]
      if (last && last.group === c.group) { last.span += 1; continue }
      const label = c.group === 'custom' ? CUSTOM_GROUP.label : GRID_GROUPS.find((g) => g.id === c.group)!.label
      runs.push({ group: c.group, label, span: 1 })
    }
    return runs
  }, [visible])

  const rulesByField = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of appliedRules) m.set(r.field, (m.get(r.field) ?? 0) + 1)
    return m
  }, [appliedRules])

  if (isLoading) return <div className="p-4 text-sm text-muted">Loading bids…</div>

  const totalCount = fetched?.length ?? 0
  const hasFilters = rules.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bid-master-grid">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" aria-label="Search bids" placeholder="Search bids…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 rounded-lg border border-line bg-white pl-7 pr-2 text-[13px] text-ink focus-visible:focus-ring"
          />
        </div>
        <ToolbarPopover label="Filters" icon="SlidersHorizontal" badge={appliedRules.length}>
          <FilterBuilder columns={filterable} rules={rules} onChange={setRules} />
        </ToolbarPopover>
        <ToolbarPopover label="Columns" icon="List">
          <ManageColumnsPanel all={allColumns} visible={visible} onVisibleChange={setVisibleIds} onAddColumn={() => setAddColumnOpen(true)} />
        </ToolbarPopover>
        <Button variant="secondary" size="sm" onClick={() => setAddColumnOpen(true)}><Icon name="Plus" size={14} /> Add column</Button>
        {hasFilters && <Button variant="ghost" size="sm" onClick={() => setRules([])}>Clear all filters</Button>}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-ink-900/[0.06] px-2 py-1 text-[13px]" data-testid="bulk-toolbar">
            <span>{selectedIds.length} selected</span>
            <Button variant="secondary" size="sm" onClick={archiveSelected}>Archive Selected</Button>
            <Button variant="secondary" size="sm" onClick={() => setReassignOpen(true)}>Reassign Owner</Button>
          </div>
        )}
        {bulkError && <span role="alert" className="text-[12px] text-crimson-600">{bulkError}</span>}
        <span className="ml-auto text-[12px] text-muted" aria-live="polite">
          {rows.length === totalCount ? `${totalCount} bids` : `${rows.length} of ${totalCount} bids`}
        </span>
      </div>

      {(appliedRules.length > 0 || ignored.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5" data-testid="active-filters">
          {rules.map((rule, index) => {
            const col = columnById.get(rule.field)
            if (!isRuleComplete(rule) || ignored.includes(rule)) return null
            return (
              <span key={index} className="inline-flex items-center gap-1 rounded-full bg-ink-900/[0.06] py-0.5 pl-2.5 pr-1 text-[12px] text-ink">
                {ruleSummary(rule, col)}
                <button
                  type="button" aria-label={`Clear filter ${ruleSummary(rule, col)}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-ink-900/[0.1] hover:text-ink"
                  onClick={() => setRules(rules.filter((r) => r !== rule))}
                >
                  <Icon name="X" size={12} />
                </button>
              </span>
            )
          })}
          {ignored.length > 0 && (
            <span role="status" className="text-[12px] text-amber-600">
              {ignored.length} filter{ignored.length === 1 ? '' : 's'} ignored — column archived
            </span>
          )}
        </div>
      )}

      {/* One scroll element serves vertical virtualization AND horizontal scroll —
          a nested second scroller would desync the virtualizer's offsets. */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              <th scope="col" rowSpan={2} className="w-10 border-b border-line bg-paper px-3">
                <Checkbox aria-label="Select all rows" checked={allSelected} indeterminate={selectedIds.length > 0 && !allSelected} onChange={toggleAll} />
              </th>
              {groupRuns.map((run, i) => (
                <th
                  key={i} colSpan={run.span} scope="colgroup"
                  className={cn(
                    'whitespace-nowrap border-b border-l border-line px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide',
                    run.group === 'custom' ? 'bg-indigo-100 text-indigo-600' : 'bg-panel text-muted',
                  )}
                >
                  {run.label}
                </th>
              ))}
            </tr>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as GridColumnMeta
                  const sorted = h.column.getIsSorted()
                  const filteredCount = rulesByField.get(meta.id) ?? 0
                  return (
                    <th
                      key={h.id} scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      className="whitespace-nowrap border-b border-l border-line bg-paper px-3 py-2 text-left text-[13px] font-medium text-ink"
                    >
                      <button
                        type="button" disabled={!h.column.getCanSort()}
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn('inline-flex items-center gap-1', h.column.getCanSort() ? 'cursor-pointer hover:text-ink-900' : 'cursor-default')}
                        aria-label={h.column.getCanSort() ? `Sort by ${meta.header}` : meta.header}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' && <Icon name="ArrowUp" size={12} />}
                        {sorted === 'desc' && <Icon name="ArrowDown" size={12} />}
                      </button>
                      {filteredCount > 0 && (
                        <span title="Filtered" className="ml-1 inline-flex align-middle text-indigo-600">
                          <Icon name="SlidersHorizontal" size={12} />
                          <span className="sr-only">Filtered</span>
                        </span>
                      )}
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
              return (
                <tr
                  key={row.id} data-testid="bid-row"
                  className={cn('cursor-pointer hover:bg-ink-900/[0.03]', row.original.status === 'archived' && 'opacity-60')}
                  onClick={() => navigate(`/bid-tracker/bid/${row.original.id}`)}
                >
                  <td className="h-11 w-10 border-b border-line px-3 py-1" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label="Select row" checked={selected.has(row.original.id)} onChange={() => toggleRow(row.original.id)} />
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as GridColumnMeta
                    const display = renderCell(row.original, meta)
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'h-11 whitespace-nowrap border-b border-line px-3 py-1',
                          NUMERIC_TYPES.includes(meta.type) && 'text-right',
                        )}
                      >
                        {meta.editable ? (
                          <EditableCell
                            col={meta} value={cellValue(row.original, meta)} display={display}
                            externalError={cellErrors[`${row.original.id}:${meta.id}`]}
                            onCommit={(value) => commitCell(row.original, meta, value)}
                          />
                        ) : display}
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
          <div className="p-6 text-center text-sm text-muted" data-testid="grid-empty">
            {totalCount === 0 && !hasFilters ? 'No bids yet.' : 'No bids match the current search and filters.'}
            {(hasFilters || search) && (
              <div className="mt-2">
                <Button variant="ghost" size="sm" onClick={() => { setRules([]); setSearch('') }}>Clear search and filters</Button>
              </div>
            )}
          </div>
        )}
      </div>
      <AddCustomColumnDialog
        open={addColumnOpen} onClose={() => setAddColumnOpen(false)}
        // With an explicit column list (a saved view), absence means hidden — so a
        // brand-new column is appended to it; in the default view it shows itself.
        onCreated={(field) => { if (visibleIds?.length) setVisibleIds([...visibleIds, `custom:${field.key}`]) }}
      />
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
