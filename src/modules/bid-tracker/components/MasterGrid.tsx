import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type Row, type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  OPERATORS_BY_TYPE, flattenRules, parseMultiValue, pruneFilterNodes,
  type CustomValue, type FilterNode,
} from '@goms/domain'
import { motion } from 'framer-motion'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import {
  useBidCustomFields, useBidMutations, useBidsForGrid, useOpportunityMutations, useOwnershipMutations, useSalesPersons,
  useSetBidCustomValue,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { BidGridRow } from '@/lib/types'
import {
  ATTENTION_OPTIONS, CUSTOM_GROUP, GRID_GROUPS, cellValue, columnWidth, compareTyped, formatCurrency, formatValueText,
  ignoredRules, isEmptyCell, isRuleComplete, resolveColumns, resolveVisibleColumns, rowMatchesSearch, sortKeyOf,
  type GridColumnMeta,
} from '../gridColumns'
import { fromRoot, toRoot } from '../filterTree'
import { useEntityLookups } from '../useEntityLookups'
import { AddCustomColumnDialog } from './AddCustomColumnDialog'
import { ColumnHeaderMenu } from './ColumnHeaderMenu'
import { CreateBidDialog } from './CreateBidDialog'
import { FilterBar } from './FilterBar'
import { ManageColumnsPanel } from './ManageColumnsPanel'
import { EditableCell, type CellDraft, type PendingEdits } from './EditableCell'
import { FilterBuilder } from './FilterBuilder'

const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], BadgeTone> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}
const rightAligned = (col: GridColumnMeta) => col.type === 'number' || col.type === 'currency'

const ROW_HEIGHT = 36
const SELECT_COL_WIDTH = 40
// Spreadsheet surfaces. While the grid is UNLOCKED, editable cells are white and
// read-only cells a cool grey, so "can I type here?" is answered before the
// pointer gets there; while LOCKED every cell is the plain white surface (there
// is nothing to type into). Frozen cells need solid fills (they sit over
// scrolling content), hence explicit colours.
const EDITABLE_BG = 'bg-white group-hover/row:bg-[#F2F8FD]'
const READONLY_BG = 'bg-[#FAFBFC] group-hover/row:bg-[#F2F8FD]'
const SELECTED_BG = 'bg-[#E4F1FB]'
const FROZEN_SHADOW = '3px 0 5px -2px rgba(11,43,73,0.28)'
/** Frozen columns may take at most this share of the visible width, so the
 *  scrolling part of the sheet never disappears (matters most on a phone). */
const MAX_FROZEN_SHARE = 0.6
const frozenKey = (sheet: string) => (sheet === 'bidTracker' ? 'goms:bidGrid:frozenColumns' : 'goms:bidGrid:frozenColumns:' + sheet)

const loadFrozen = (sheet: string): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(frozenKey(sheet)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
const saveFrozen = (sheet: string, ids: string[]) => {
  try { localStorage.setItem(frozenKey(sheet), JSON.stringify(ids)) } catch { /* private mode: freeze just won't persist */ }
}

const helper = createColumnHelper<BidGridRow>()

/** Status-like standard columns read as coloured pills, not plain text. */
const STATUS_BADGE: Record<string, Record<string, BadgeTone>> = {
  stageKey: { solutioning: 'gray', qualification: 'blue', preBidQueries: 'purple', commercialProposal: 'amber', submitted: 'indigo', goApproved: 'emerald', dropped: 'crimson' },
  decision: { pending: 'gray', go: 'emerald', no_go: 'crimson' },
  dataConfidence: { verified: 'emerald', needs_review: 'amber' },
  latestCorrigendumStatus: { pending_review: 'amber', reviewed: 'emerald' },
}

/** A web address without its scheme and trailing slash, for a narrow cell. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '')

function ToolbarPopover({ label, icon, badge, children, open: controlledOpen, onOpenChange, align }: {
  label: string; icon: string; badge?: number; children: ReactNode
  /** Optional control from outside (the header menu opens the Columns panel). */
  open?: boolean; onOpenChange?: (open: boolean) => void
  align?: 'start' | 'end'
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    setInnerOpen(value)
    onOpenChange?.(value)
  }
  const anchorRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchorRef} className="relative inline-block">
      <Button variant="secondary" size="sm" className="h-7 px-2.5" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} size={14} /> {label}
        {badge ? <span className="rounded-full bg-goms-navy px-1.5 text-[11px] text-paper">{badge}</span> : null}
      </Button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} maxPanelHeight={480} align={align}>
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
  /** Which Opportunity sheet this is: frozen columns are remembered per sheet. */
  sheet?: string
  /** Filter rules. Controlled when `onFilterRulesChange` is given (a saved view
   *  owns them); otherwise the grid keeps its own, seeded from this. */
  filterRules?: FilterNode[]
  onFilterRulesChange?: (rules: FilterNode[]) => void
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
  const [innerRules, setInnerRules] = useState<FilterNode[]>(props.filterRules ?? [])
  const rules = props.onFilterRulesChange ? (props.filterRules ?? []) : innerRules
  const setRules = (next: FilterNode[]) => (props.onFilterRulesChange ?? setInnerRules)(next)
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
  // Where the open filter editor is: `"2"` (a top-level condition) or `"1.0"` (inside group 1).
  const [editingRule, setEditingRule] = useState<string | null>(null)
  // The Columns panel, opened either from the toolbar or from a header's "Manage column…".
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [manageColumnId, setManageColumnId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // A column just added: scrolled into view and briefly highlighted, so a new
  // column off at the far right of a wide sheet is never "where did it go?".
  const [flashId, setFlashId] = useState<string | null>(null)
  const scrollToId = useRef<string | null>(null)

  // Lock / Unlock: the grid always opens LOCKED. Unlocked, editable cells take
  // inline edits; a cell edit that is not saved yet blocks locking until it is
  // saved or explicitly discarded.
  const [unlocked, setUnlocked] = useState(false)
  const [lockPromptOpen, setLockPromptOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const pendingEdits: PendingEdits = useRef(new Map())
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked

  // Frozen (pinned) columns: chosen per column from its header menu, remembered in this browser.
  const [frozenIds, setFrozenIds] = useState<string[]>(() => loadFrozen(props.sheet ?? 'bidTracker'))

  // --- data -------------------------------------------------------------------
  const appliedRules = useMemo(() => pruneFilterNodes(rules, isRuleComplete), [rules])
  const { data: fetched, isLoading } = useBidsForGrid(appliedRules)
  const { data: customFields = [] } = useBidCustomFields()
  const lookups = useEntityLookups()
  const { archive, unarchive, update: updateBid } = useBidMutations()
  const { assign } = useOwnershipMutations()
  const { data: salesPersons = [] } = useSalesPersons()
  const setCustomValue = useSetBidCustomValue()
  const { update: updateOpportunity } = useOpportunityMutations()

  const allColumns = useMemo(() => resolveColumns(customFields), [customFields])
  const visible = useMemo(() => resolveVisibleColumns(allColumns, visibleIds), [allColumns, visibleIds])
  const ignored = useMemo(() => ignoredRules(rules, allColumns), [rules, allColumns])
  const filterable = useMemo(() => allColumns.filter((c) => c.type !== null), [allColumns])
  const columnById = useMemo(() => new Map(allColumns.map((c) => [c.id, c])), [allColumns])

  // Frozen columns lead the sheet (in their normal relative order), the rest follow —
  // that is what keeps stacked sticky offsets correct however the freezes were
  // chosen. Unfreezing puts a column straight back where the saved view has it.
  const frozenSet = useMemo(() => new Set(frozenIds), [frozenIds])
  const displayCols = useMemo(
    () => [...visible.filter((c) => frozenSet.has(c.id)), ...visible.filter((c) => !frozenSet.has(c.id))],
    [visible, frozenSet],
  )

  const rows = useMemo(
    () => (fetched ?? []).filter((r) => rowMatchesSearch(r, visible, search, lookups)),
    [fetched, visible, search, lookups],
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

  // --- lock / unlock --------------------------------------------------------------
  const requestToggleLock = () => {
    if (!unlocked) { setUnlocked(true); return }
    // Clicking the switch has already blurred any open editor, which saves a valid
    // edit. What is still pending here is an edit that cannot be saved as typed.
    if (pendingEdits.current.size > 0) { setLockPromptOpen(true); return }
    setSaveError(null)
    setUnlocked(false)
  }
  const discardAndLock = () => {
    for (const { discard } of [...pendingEdits.current.values()]) discard()
    pendingEdits.current.clear()
    setLockPromptOpen(false)
    setUnlocked(false)
  }

  // --- inline edit: optimistic, with rollback + inline error -------------------
  const commitCell = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    const errorKey = `${row.id}:${col.id}`
    // Of the editable opportunity attributes only City is nullable; clearing the others stores ''.
    const opportunityValue = value === null && col.id !== 'city' ? '' : value
    setCellErrors((e) => { const { [errorKey]: _drop, ...rest } = e; return rest })
    const snapshot = qc.getQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] })
    const patchRow = (r: BidGridRow): BidGridRow => {
      if (col.custom) {
        const customValues = { ...r.customValues }
        if (value === null) delete customValues[col.custom.key]
        else customValues[col.custom.key] = value as CustomValue
        return { ...r, customValues }
      }
      return { ...r, [col.id]: opportunityValue } as BidGridRow
    }
    qc.setQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] }, (old) => old?.map((r) => (r.id === row.id ? patchRow(r) : r)))
    try {
      if (col.custom) await setCustomValue.mutateAsync({ bidId: row.id, fieldId: col.custom.id, value })
      else if (col.editable === 'owner') {
        // Picking a person records a new ownership assignment from today (the history is kept).
        const person = lookups.persons.find((p) => p.email === value)
        if (!person) throw new Error('Choose a person from the Sales Team.')
        await assign.mutateAsync({ entityType: 'bid', entityId: row.id, salesPersonId: person.value, startDate: new Date().toISOString().slice(0, 10) })
      } else if (col.editable === 'bid') {
        // Stage, Decision and Tender Link go through the bid's own update (its stage / Go / protected-value rules apply).
        await updateBid.mutateAsync({ id: row.id, patch: { [col.id]: value } as { stageKey?: string; decision?: 'pending' | 'go' | 'no_go'; tenderLink?: string | null } })
      } else await updateOpportunity.mutateAsync({ id: row.opportunityId, patch: { [col.id]: opportunityValue } })
    } catch (e) {
      for (const [key, data] of snapshot) qc.setQueryData(key, data)
      const message = e instanceof Error ? e.message : 'Could not save.'
      setCellErrors((errs) => ({ ...errs, [errorKey]: message }))
      // Locked since the edit began: the cell can no longer show the problem, so say it here.
      if (!unlockedRef.current) setSaveError(`${col.header} on ${row.bidCode} was not saved: ${message}`)
    }
  }

  // --- filters ---------------------------------------------------------------
  const addRule = (fieldId?: string) => {
    const col = (fieldId ? filterable.find((c) => c.id === fieldId) : undefined) ?? filterable[0]
    if (!col?.type) return
    const root = toRoot(rules)
    const items: FilterNode[] = [...root.items, { field: col.id, operator: OPERATORS_BY_TYPE[col.type][0], value: '' }]
    setRules(fromRoot({ ...root, items }))
    setEditingRule(String(items.length - 1))
  }

  // --- column layout: drag a header to reorder. Every other column action (move,
  // hide, rename, archive) lives in the Columns panel only. ------------------------
  const orderedIds = visible.map((c) => c.id)
  const dropColumn = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const from = orderedIds.indexOf(fromId)
    const to = orderedIds.indexOf(toId)
    if (from < 0 || to < 0) return
    const next = orderedIds.filter((i) => i !== fromId)
    next.splice(from < to ? next.indexOf(toId) + 1 : next.indexOf(toId), 0, fromId)
    setVisibleIds(next)
  }

  // --- freeze ---------------------------------------------------------------------
  const toggleFreeze = (id: string) => {
    setFrozenIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      saveFrozen(props.sheet ?? 'bidTracker', next)
      return next
    })
  }

  // --- cells ----------------------------------------------------------------------
  /** `links: false` while a cell is editable-and-unlocked: a link would swallow the click that should start the edit. */
  const renderCell = (row: BidGridRow, col: GridColumnMeta, links = true): ReactNode => {
    const v = cellValue(row, col)
    const dash = <span className="text-muted">—</span>
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
    if (col.id === 'opportunityId') {
      // The only way into a bid's details: clicking its Opportunity ID. Every other cell is for editing.
      return (
        <button
          type="button" title="Open details" aria-label={`Open ${String(v)}`}
          onClick={(e) => { e.stopPropagation(); navigate(`/bid-tracker/bid/${row.id}`) }}
          className="max-w-full truncate rounded px-0.5 text-left font-medium text-goms-navy underline decoration-goms-sky/70 underline-offset-2 hover:bg-goms-sky/[0.14] focus-visible:focus-ring"
        >
          {String(v)}
        </button>
      )
    }
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
      if (!links && row.tenderLink) return row.tenderLink
      return row.tenderLink
        ? <a href={row.tenderLink} target="_blank" rel="noreferrer" className="text-goms-navy underline decoration-goms-sky underline-offset-2" onClick={stop}>Link</a>
        : dash
    }
    const tones = STATUS_BADGE[col.id]
    if (tones && !isEmptyCell(v)) {
      const label = col.options?.find((o) => o.value === v)?.label ?? String(v)
      return <Badge tone={tones[String(v)] ?? 'gray'}>{label}</Badge>
    }
    if (col.id === 'updatedAt' && typeof v === 'string') return <span className="tabular-nums">{v.slice(0, 16).replace('T', ' ')}</span>
    if (col.id === 'decision') return <span className="capitalize">{String(v).replace('_', ' ')}</span>
    if (isEmptyCell(v)) return dash
    switch (col.type) {
      case 'boolean': return v ? <Icon name="Check" size={14} className="text-emerald-600" /> : <span className="text-muted">No</span>
      case 'select': {
        const label = col.options?.find((o) => o.value === v)?.label
        return label ?? (col.group === 'custom' ? `${String(v)} (removed)` : String(v))
      }
      case 'number': return <span className="tabular-nums">{String(v)}</span>
      case 'currency': return <span className="tabular-nums">{Number.isFinite(Number(v)) ? formatCurrency(Number(v)) : String(v)}</span>
      case 'url':
        if (!links) return shortUrl(String(v))
        return (
          <a
            href={String(v)} target="_blank" rel="noreferrer" onClick={stop} title={String(v)}
            className="text-goms-navy underline decoration-goms-sky underline-offset-2"
          >
            {shortUrl(String(v))}
          </a>
        )
      case 'email':
        if (!links) return String(v)
        return <a href={`mailto:${String(v)}`} onClick={stop} className="text-goms-navy underline decoration-goms-sky underline-offset-2">{String(v)}</a>
      case 'phone':
        if (!links) return String(v)
        return <a href={`tel:${String(v)}`} onClick={stop} className="tabular-nums text-goms-navy underline decoration-goms-sky underline-offset-2">{String(v)}</a>
      case 'person': case 'department': case 'state': return formatValueText(col, v, lookups)
      case 'multiselect': {
        const labels = parseMultiValue(v)
        return (
          <span className="flex items-center gap-1" title={labels.join(', ')}>
            {labels.slice(0, 2).map((l) => <span key={l} className="truncate rounded bg-goms-sky/[0.18] px-1.5 text-[11.5px] text-goms-navy">{l}</span>)}
            {labels.length > 2 && <span className="text-[11.5px] text-muted">+{labels.length - 2}</span>}
          </span>
        )
      }
      default:
        if (col.id === 'opportunityName') return <span className="font-medium text-goms-navy">{String(v)}</span>
        return String(v)
    }
  }

  const columns = useMemo<ColumnDef<BidGridRow, unknown>[]>(
    () => displayCols.map((meta) => helper.accessor((r) => sortKeyOf(r, meta, lookups), {
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
    [displayCols, lookups],
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

  // Frozen panes: the selection column always, plus every column the user froze,
  // stacked left to right in display order.
  const frozen = useMemo(() => {
    const left = new Map<string, number>()
    let offset = SELECT_COL_WIDTH
    for (const c of displayCols) {
      if (!frozenSet.has(c.id)) continue
      left.set(c.id, offset)
      offset += columnWidth(c)
    }
    return { left, lastId: [...left.keys()].pop(), width: offset }
  }, [displayCols, frozenSet])
  const tableWidth = SELECT_COL_WIDTH + displayCols.reduce((sum, c) => sum + columnWidth(c), 0)

  // Group header cells: consecutive visible columns of the same group merge
  // into one colSpan cell. Reordering — or freezing — can split a group into
  // several runs; frozen and scrolling columns never share a run.
  const groupRuns = useMemo(() => {
    const runs: { group: string; label: string; span: number; frozen: boolean; left?: number }[] = []
    for (const c of displayCols) {
      const isFrozen = frozen.left.has(c.id)
      const last = runs[runs.length - 1]
      if (last && last.group === c.group && last.frozen === isFrozen) { last.span += 1; continue }
      const label = c.group === 'custom' ? CUSTOM_GROUP.label : GRID_GROUPS.find((g) => g.id === c.group)!.label
      runs.push({ group: c.group, label, span: 1, frozen: isFrozen, left: frozen.left.get(c.id) })
    }
    return runs
  }, [displayCols, frozen])

  const rulesByField = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of flattenRules(appliedRules)) m.set(r.field, (m.get(r.field) ?? 0) + 1)
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
  const scrollerWidth = parentRef.current?.clientWidth || 1200 // 0 = not laid out yet
  const freezeBlockedReason = (meta: GridColumnMeta) =>
    !frozen.left.has(meta.id) && frozen.width + columnWidth(meta) > scrollerWidth * MAX_FROZEN_SHARE
      ? 'No room to freeze more — unfreeze another column first.'
      : null
  // Editable only while unlocked; locked, every cell is read/navigate-only.
  const canEditCell = (meta: GridColumnMeta) => unlocked && !!meta.editable
  const cellBg = (meta: GridColumnMeta) => (!unlocked || meta.editable ? EDITABLE_BG : READONLY_BG)

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
        <ToolbarPopover label="Filters" icon="SlidersHorizontal" badge={flattenRules(appliedRules).length}>
          <FilterBuilder columns={filterable} rules={rules} onChange={setRules} lookups={lookups} />
        </ToolbarPopover>
        <Button variant="secondary" size="sm" className="h-7 px-2.5" onClick={() => setAddColumnOpen(true)}><Icon name="Plus" size={14} /> Add column</Button>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-goms-sky/[0.16] px-2 py-0.5 text-[13px] text-goms-navy" data-testid="bulk-toolbar">
            <span className="font-medium">{selectedIds.length} selected</span>
            <Button variant="secondary" size="sm" className="h-6 px-2" onClick={archiveSelected}>Archive Selected</Button>
            <Button variant="secondary" size="sm" className="h-6 px-2" onClick={() => setReassignOpen(true)}>Reassign Owner</Button>
          </div>
        )}
        {bulkError && <span role="alert" className="text-[12px] text-crimson-600">{bulkError}</span>}
        {saveError && (
          <span role="alert" className="flex items-center gap-1 text-[12px] text-crimson-600">
            {saveError}
            <button type="button" aria-label="Dismiss" className="rounded p-0.5 hover:bg-crimson-100" onClick={() => setSaveError(null)}><Icon name="X" size={12} /></button>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <LockSwitch
            unlocked={unlocked} onToggle={requestToggleLock}
            lockedLabel="Master grid editing locked — tap to unlock"
            unlockedLabel="Master grid editing unlocked — tap to lock"
          />
          <ToolbarPopover
            label="Manage columns" icon="List" open={columnsOpen} align="end"
            onOpenChange={(open) => { setColumnsOpen(open); if (!open) setManageColumnId(null) }}
          >
            <ManageColumnsPanel all={allColumns} visible={visible} onVisibleChange={setVisibleIds} focusId={manageColumnId} />
          </ToolbarPopover>
          <Button variant="primary" size="sm" className="h-7 px-2.5" onClick={() => setCreateBidOpen(true)}>
            <Icon name="Plus" size={14} /> Create Bid
          </Button>
        </div>
      </div>

      {hasFilters && (
        <FilterBar
          rules={rules} columns={filterable} columnById={columnById} lookups={lookups} ignoredCount={ignored.length}
          editing={editingRule} onEditing={setEditingRule}
          onChange={setRules} onAdd={() => addRule()}
        />
      )}

      {/* One scroll element serves vertical virtualization AND horizontal scroll —
          a nested second scroller would desync the virtualizer's offsets. */}
      <div ref={parentRef} className="mx-3 mb-3 mt-2 min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-thin rounded-xl border border-line bg-white shadow-sm" data-testid="grid-scroller">
        <table className="border-separate border-spacing-0 text-[12.5px] text-ink" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: SELECT_COL_WIDTH }} />
            {displayCols.map((c) => <col key={c.id} style={{ width: columnWidth(c) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                scope="col" rowSpan={2} style={{ left: 0 }}
                className="sticky z-10 border-b border-line bg-[#F4F7FA] px-0 text-center"
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
                  style={run.frozen ? { left: run.left } : undefined}
                  className={cn(
                    'h-6 overflow-hidden whitespace-nowrap border-l border-line first:border-l-0 bg-[#F4F7FA] px-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-goms-navy/70',
                    run.frozen && 'sticky z-10',
                  )}
                >
                  {/* A frozen run is itself sticky; a scrolling run keeps its label
                      readable while the group slides under the frozen columns. */}
                  {run.frozen
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
                  const shadows = [
                    sorted && 'inset 0 -3px 0 #4CA7DD',
                    flashId === meta.id && 'inset 0 -3px 0 #74C05C',
                    dragOverId === meta.id && 'inset 3px 0 0 #4CA7DD',
                    frozen.lastId === meta.id && FROZEN_SHADOW,
                  ].filter(Boolean).join(', ')
                  return (
                    <th
                      key={h.id} scope="col" data-col-id={meta.id}
                      style={{ ...frozenStyle(meta.id), ...(shadows ? { boxShadow: shadows } : {}) }}
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      draggable title="Drag to reorder"
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', meta.id); setDragId(meta.id) }}
                      onDragOver={(e) => { if (dragId && dragId !== meta.id) { e.preventDefault(); setDragOverId(meta.id) } }}
                      onDragLeave={() => setDragOverId((cur) => (cur === meta.id ? null : cur))}
                      onDrop={(e) => { e.preventDefault(); if (dragId) dropColumn(dragId, meta.id); setDragId(null); setDragOverId(null) }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                      className={cn(
                        'group/th h-9 border-b border-line pl-3 pr-1 text-left transition-colors duration-700',
                        sorted ? 'bg-[#EAF4FC]' : 'bg-white',
                        flashId === meta.id && 'bg-goms-green/25',
                        isFrozen && 'sticky z-10',
                        frozen.lastId === meta.id && 'border-r-2 border-r-goms-navy/25',
                        dragId === meta.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button" disabled={!h.column.getCanSort()}
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-600',
                            h.column.getCanSort() ? 'cursor-pointer' : 'cursor-default',
                          )}
                          aria-label={h.column.getCanSort() ? `Sort by ${meta.header}` : meta.header}
                        >
                          <span className="truncate" title={meta.header}>{flexRender(h.column.columnDef.header, h.getContext())}</span>
                          {unlocked && meta.editable && <span title="Editable column" className="shrink-0 text-goms-green"><Icon name="Pencil" size={10} /></span>}
                        </button>
                        {isFrozen && <span title="Frozen column" className="inline-flex shrink-0 text-goms-navy/60"><Icon name="Pin" size={11} /><span className="sr-only">Frozen</span></span>}
                        {filteredCount > 0 && (
                          <span title="Filtered" className="inline-flex shrink-0 text-goms-sky">
                            <Icon name="SlidersHorizontal" size={12} />
                            <span className="sr-only">Filtered</span>
                          </span>
                        )}
                        {h.column.getCanSort() && (
                          sorted
                            ? <span className="shrink-0 text-goms-navy"><Icon name={sorted === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={13} /></span>
                            : <span className="shrink-0 text-muted opacity-0 group-hover/th:opacity-60"><Icon name="ChevronsUpDown" size={12} /></span>
                        )}
                        <ColumnHeaderMenu
                          header={meta.header} sorted={sorted}
                          canSort={h.column.getCanSort()}
                          onSort={(dir) => (dir ? h.column.toggleSorting(dir === 'desc', false) : h.column.clearSorting())}
                          onFilter={meta.type !== null ? () => addRule(meta.id) : null}
                          frozen={isFrozen} freezeBlockedReason={freezeBlockedReason(meta)}
                          onToggleFreeze={() => toggleFreeze(meta.id)}
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
                  className={cn('group/row transition-colors', row.original.status === 'archived' && 'opacity-60')}
                >
                  <td
                    style={{ left: 0, height: ROW_HEIGHT }}
                    className={cn('sticky z-10 border-b border-line/70 p-0 text-center', isSelected ? SELECTED_BG : READONLY_BG)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-center">
                      <Checkbox aria-label="Select row" checked={isSelected} onChange={() => toggleRow(row.original.id)} />
                    </div>
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as GridColumnMeta
                    const display = renderCell(row.original, meta, !canEditCell(meta))
                    const isFrozen = frozen.left.has(meta.id)
                    return (
                      <td
                        key={cell.id}
                        style={{
                          ...frozenStyle(meta.id), height: ROW_HEIGHT,
                          ...(frozen.lastId === meta.id ? { boxShadow: FROZEN_SHADOW } : {}),
                        }}
                        title={unlocked && !meta.editable ? meta.readOnlyReason : undefined}
                        className={cn(
                          'relative overflow-hidden whitespace-nowrap border-b border-line/70 p-0 transition-colors duration-150',
                          cellBg(meta),
                          isSelected && SELECTED_BG,
                          rightAligned(meta) && 'text-right',
                          isFrozen && 'sticky z-10',
                          frozen.lastId === meta.id && 'border-r-2 border-r-goms-navy/25',
                          flashId === meta.id && 'bg-goms-green/20',
                        )}
                      >
                        {canEditCell(meta) ? (
                          <EditableCell
                            col={meta} value={cellValue(row.original, meta)} display={display} lookups={lookups}
                            externalError={cellErrors[`${row.original.id}:${meta.id}`]}
                            pending={pendingEdits} cellKey={`${row.original.id}:${meta.id}`}
                            onCommit={(value) => commitCell(row.original, meta, value)}
                          />
                        ) : (
                          <div className={cn('flex h-[35px] items-center px-3', rightAligned(meta) && 'justify-end')}>
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
      <Dialog
        open={lockPromptOpen} onClose={() => setLockPromptOpen(false)} title="You have an unsaved edit"
        description="A cell is still being edited and its value cannot be saved as it stands. Fix it to save, or discard it before locking."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLockPromptOpen(false)}>Keep editing</Button>
            <Button variant="primary" onClick={discardAndLock}>Discard edit and lock</Button>
          </div>
        )}
      >
        <p className="text-[13px] text-muted">Nothing has been lost yet — choose Keep editing to go back to the cell.</p>
      </Dialog>
    </div>
  )
}
