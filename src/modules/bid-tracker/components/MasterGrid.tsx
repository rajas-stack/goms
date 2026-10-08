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
import { PersonName } from '@/components/ui/PersonName'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import {
  useBidCustomFields, useBidMutations, useBidsForGrid, useDepartments, useFollowUpMutations, useOpportunityMutations,
  useOwnershipMutations, useSalesPersons, useSetBidCustomValue,
} from '@/lib/api'
import { repository } from '@/data/repository'
import { isoToday } from '@/lib/dates'

const dayAfter = (isoDate: string) => {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
import { cn } from '@/lib/utils'
import { useMyAccess } from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import type { BidGridRow } from '@/lib/types'
import {
  ATTENTION_OPTIONS, CUSTOM_GROUP, GRID_GROUPS, cellValue, editValue, columnIdFromOrderToken, columnWidth, compareTyped, defaultVisibleColumnIds, formatCurrency, formatValueText,
  ignoredRules, isEmptyCell, isRuleComplete, personOf, orderedColumnIds, resolveColumns, resolveVisibleColumns, rowMatchesSearch, setColumnVisibility, sortKeyOf,
  type GridColumnMeta,
} from '../gridColumns'
import { fromRoot, toRoot } from '../filterTree'
import {
  OWNED_SHEETS, OWNED_SHEET_LABELS, columnInScope, columnOwner, createLabelFor, rowInSheet,
  type MasterScope, type OwnedSheet, type SheetId,
} from '../sheets'
import { useEntityLookups } from '../useEntityLookups'
import { canEditCell as roleAllowsCell } from '../gridPermissions'
import { AddCustomColumnDialog } from './AddCustomColumnDialog'
import { ColumnHeaderMenu } from './ColumnHeaderMenu'
import { CreateBidDialog } from './CreateBidDialog'
import { FilterBar } from './FilterBar'
import { GridContextMenu, type MenuEntry } from './GridContextMenu'
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
// Cells are slightly translucent over the sheet's tinted backdrop and carry a
// bevel (light top-left edge, soft dark bottom-right edge), so the grid reads as
// raised tiles while staying see-through. Frozen cells stay opaque (FROZEN_BG)
// because scrolling content slides underneath them.
const EDITABLE_BG = 'bg-white/70 group-hover/row:bg-grid-hover/85'
const READONLY_BG = 'bg-grid-readonly/60 group-hover/row:bg-grid-hover/85'
const SELECTED_BG = 'bg-grid-selected/90'
const FROZEN_BG = 'bg-grid-frozen'
const SHEET_BG = 'bg-[image:var(--grid-sheet)]'
const CELL_BEVEL = 'var(--grid-bevel)'
const FROZEN_SHADOW = 'var(--grid-frozen-shadow)'
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

interface ColumnLocks { locked: string[]; unlocked: string[] }
const columnLocksKey = (sheet: string) => `goms:bidGrid:columnLocks:${sheet}`
const loadColumnLocks = (sheet: string): ColumnLocks => {
  try {
    const raw = JSON.parse(localStorage.getItem(columnLocksKey(sheet)) ?? '{}') as Partial<ColumnLocks>
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { locked: ids(raw.locked), unlocked: ids(raw.unlocked) }
  } catch { return { locked: [], unlocked: [] } }
}
const saveColumnLocks = (sheet: string, locks: ColumnLocks) => {
  try { localStorage.setItem(columnLocksKey(sheet), JSON.stringify(locks)) } catch { /* private mode: locks just won't persist */ }
}

const helper = createColumnHelper<BidGridRow>()

// Favourites are a personal shortlist, remembered in this browser.
const FAVOURITES_KEY = 'goms:bidGrid:favourites'
const loadFavourites = (): Set<string> => {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}
const saveFavourites = (ids: Set<string>) => {
  try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...ids])) } catch { /* private mode: not remembered */ }
}

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
  /** Master only: narrow the custom columns shown to one sheet's (default: all of them). */
  columnScope?: MasterScope
  /** Rendered first in the toolbar (the Master sheet's switcher). */
  toolbarLead?: ReactNode
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
  // What the user / saved view chose; undefined or empty = this sheet's default (see `visibleIds` below).
  const chosenVisibleIds = props.onVisibleColumnsChange ? props.visibleColumns : innerVisible
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
  // Archived bids leave every normal view; the Archived button switches to a view of only them.
  const [showArchived, setShowArchived] = useState(false)
  const [favourites, setFavourites] = useState<Set<string>>(loadFavourites)
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; groups: MenuEntry[][] } | null>(null)
  const pendingEdits: PendingEdits = useRef(new Map())
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked

  // Frozen (pinned) columns: chosen per column from its header menu, remembered in this browser.
  const [frozenIds, setFrozenIds] = useState<string[]>(() => loadFrozen(props.sheet ?? 'bidTracker'))

  // Per-column locks, per sheet, remembered in this browser. Who may edit what is decided by the user's role
  // (RBAC): with RBAC enforced a cell is editable only when the grid is unlocked, the column has a write path, the
  // role allows that field on THIS row, and the user has not locked the column themselves. While RBAC is off the
  // original browser switch still applies: editable columns start open (and can be locked), `unlockable` ones start
  // locked (and can be opened); the rest have no write path and stay locked.
  const perms = usePermissions()
  const { data: access } = useMyAccess()
  const me = { email: access?.email ?? '', salesPersonId: access?.facts?.salesPersonId ?? null }
  const [columnLocks, setColumnLocks] = useState<ColumnLocks>(() => loadColumnLocks(props.sheet ?? 'bidTracker'))
  const effectiveMeta = (meta: GridColumnMeta): GridColumnMeta => {
    if (columnLocks.locked.includes(meta.id)) return { ...meta, editable: undefined }
    if (!meta.editable && meta.unlockable && (perms.enforced || columnLocks.unlocked.includes(meta.id))) return { ...meta, editable: meta.unlockable }
    return meta
  }
  const canLockColumn = (meta: GridColumnMeta) => !!(meta.editable || (meta.unlockable && !perms.enforced))
  const isColumnOpen = (meta: GridColumnMeta) => unlocked && !!effectiveMeta(meta).editable
  const toggleColumnLock = (meta: GridColumnMeta) => {
    if (!unlocked) return
    setColumnLocks((cur) => {
      const open = !!effectiveMeta(meta).editable
      const without = (ids: string[]) => ids.filter((id) => id !== meta.id)
      const next: ColumnLocks = open
        ? { locked: meta.editable ? [...without(cur.locked), meta.id] : without(cur.locked), unlocked: without(cur.unlocked) }
        : { locked: without(cur.locked), unlocked: meta.editable ? without(cur.unlocked) : [...without(cur.unlocked), meta.id] }
      saveColumnLocks(props.sheet ?? 'bidTracker', next)
      return next
    })
  }

  // --- data -------------------------------------------------------------------
  const appliedRules = useMemo(() => pruneFilterNodes(rules, isRuleComplete), [rules])
  const { data: fetched, isLoading } = useBidsForGrid(appliedRules)
  const sheetId = (props.sheet ?? 'bidTracker') as SheetId
  const { data: allCustomFields = [] } = useBidCustomFields()
  // A sheet shows only the custom columns it owns; Master shows every sheet's (or the one picked in its switcher).
  const customFields = useMemo(
    () => allCustomFields.filter((f) => columnInScope(f.sheet, sheetId, props.columnScope)),
    [allCustomFields, sheetId, props.columnScope],
  )
  // A column added while viewing Master through one sheet's lens belongs to that sheet.
  const newColumnOwner = sheetId === 'master' && props.columnScope && props.columnScope !== 'all' ? props.columnScope : columnOwner(sheetId)
  const lookups = useEntityLookups()
  const { archive, unarchive, remove: removeBid, update: updateBid, markVerified } = useBidMutations()
  const { assign, end: endOwnership } = useOwnershipMutations()
  const { create: createFollowUp, setStatus: setFollowUpStatus } = useFollowUpMutations()
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const setCustomValue = useSetBidCustomValue()
  const { update: updateOpportunity } = useOpportunityMutations()

  const allColumns = useMemo(() => resolveColumns(customFields), [customFields])
  const visibleIds = useMemo(
    () => (chosenVisibleIds?.length ? chosenVisibleIds : defaultVisibleColumnIds(allColumns, sheetId)),
    [chosenVisibleIds, allColumns, sheetId],
  )
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

  // Every row lives in ONE sheet; a sheet shows only its own (Master shows them all).
  // Archived count, archived view, search and empty states all work within these.
  const sheetRows = useMemo(() => (fetched ?? []).filter((r) => rowInSheet(r.sheet, sheetId)), [fetched, sheetId])
  const archivedCount = useMemo(() => sheetRows.filter((r) => r.status === 'archived').length, [sheetRows])
  const modeRows = useMemo(
    () => sheetRows.filter((r) => (showArchived ? r.status === 'archived' : r.status !== 'archived')),
    [sheetRows, showArchived],
  )
  const rows = useMemo(
    () => modeRows.filter((r) => rowMatchesSearch(r, visible, search, lookups)),
    [modeRows, visible, search, lookups],
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
  // --- move between sheets: optimistic, rolled back (with an error) on failure ----
  const moveTargets = (from: OwnedSheet | null) => OWNED_SHEETS.filter((s) => s !== from)
  const moveRows = async (ids: string[], to: OwnedSheet) => {
    if (!ids.length) return
    setBulkError(null)
    const snapshot = qc.getQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] })
    const moving = new Set(ids)
    qc.setQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] }, (old) => old?.map((r) => (moving.has(r.id) ? { ...r, sheet: to } : r)))
    const failed: string[] = []
    let reason = ''
    for (const id of ids) {
      try { await updateBid.mutateAsync({ id, patch: { sheet: to } }) } catch (e) {
        failed.push(id)
        reason = e instanceof Error ? e.message : ''
      }
    }
    setSelected(new Set(failed))
    if (!failed.length) return
    // Put the cache back as it was, then let the server say where every row really is.
    for (const [key, data] of snapshot) qc.setQueryData(key, data)
    void qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    const what = ids.length === 1 ? 'The bid could not be moved' : `${failed.length} of ${ids.length} could not be moved`
    setBulkError(`${what} to ${OWNED_SHEET_LABELS[to]}${reason ? `: ${reason}` : '.'}`)
  }
  const archiveSelected = () => runBulk((id) => archive.mutateAsync(id))
  const unarchiveSelected = () => runBulk((id) => unarchive.mutateAsync(id))
  const toggleFavourite = (id: string) => setFavourites((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    saveFavourites(next)
    return next
  })
  const deleteBid = (row: BidGridRow) => {
    if (!window.confirm(`Delete ${row.bidCode} (${row.opportunityName}) permanently? The opportunity stays; the bid, its milestones and values are removed. Archive keeps everything.`)) return
    removeBid.mutate(row.id, { onError: (e) => setBulkError(e instanceof Error ? e.message : 'Could not delete the bid.') })
  }
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

  // --- inline edit: multi-step saves ----------------------------------------------
  const today = isoToday
  const personIdByEmail = (email: CellDraft) => {
    if (email === null || email === '') return null
    const person = lookups.persons.find((p) => p.email === email)
    if (!person) throw new Error('Choose a person from the Sales Team.')
    return person.value
  }

  /** Ends the open Sales/Solution Lead(s) and records the new one, so the history is kept. */
  const replaceSolutionLead = async (row: BidGridRow, email: CellDraft) => {
    const salesPersonId = personIdByEmail(email)
    const history = await repository.listOwnershipFor('bid', row.id)
    const open = history.filter((a) => a.role === 'solutionLead' && a.endDate === null)
    const asOf = today()
    for (const lead of open) {
      // An assignment must end after it starts; one made today closes tomorrow.
      const endDate = lead.startDate < asOf ? asOf : dayAfter(lead.startDate)
      await endOwnership.mutateAsync({ id: lead.id, endDate })
    }
    if (salesPersonId) {
      await assign.mutateAsync({ entityType: 'bid', entityId: row.id, salesPersonId, role: 'solutionLead', startDate: asOf, reason: 'reassignment' })
    }
  }

  /** The Next Action columns show the bid's earliest open follow-up. Editing one
   *  cancels it and opens a replacement carrying the change (follow-ups have no
   *  in-place edit), so the earlier version stays in the bid's history. */
  const replaceNextAction = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    const followUps = await repository.listFollowUps('bid', row.id)
    const current = followUps.filter((f) => f.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    const next = {
      note: current?.note ?? '',
      dueDate: current?.dueDate ?? today(),
      assigneeId: current?.assigneeId ?? null,
    }
    if (col.id === 'nextActionNote') next.note = value === null ? '' : String(value)
    else if (col.id === 'nextActionDueDate') {
      if (value === null || value === '') throw new Error('An action needs a due date.')
      next.dueDate = String(value)
    } else next.assigneeId = personIdByEmail(value)
    if (current) await setFollowUpStatus.mutateAsync({ id: current.id, status: 'cancelled' })
    await createFollowUp.mutateAsync({ entityType: 'bid', entityId: row.id, ...next })
  }

  // --- inline edit: optimistic, with rollback + inline error -------------------
  const commitCell = async (row: BidGridRow, col: GridColumnMeta, value: CellDraft) => {
    const errorKey = `${row.id}:${col.id}`
    // Of the editable opportunity attributes only City is nullable; clearing the others stores ''.
    const opportunityValue = col.type === 'state'
      ? (value === null || value === '' ? null : Number(value))
      : value === null && col.id !== 'city' ? '' : value
    setCellErrors((e) => { const { [errorKey]: _drop, ...rest } = e; return rest })
    const snapshot = qc.getQueriesData<BidGridRow[]>({ queryKey: ['bidsForGrid'] })
    const department = col.editable === 'department' ? departments.find((d) => d.id === value) : undefined
    const patchRow = (r: BidGridRow): BidGridRow => {
      if (department) return { ...r, departmentId: department.id, departmentName: department.name, stateCode: department.stateCode ?? r.stateCode }
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
      } else if (col.editable === 'department') {
        if (!department) throw new Error('Choose a department from Account Mapping.')
        await updateOpportunity.mutateAsync({ id: row.opportunityId, patch: { departmentId: department.id, stateCode: department.stateCode ?? null } })
      } else if (col.editable === 'solutionLead') {
        await replaceSolutionLead(row, value)
      } else if (col.editable === 'nextAction') {
        await replaceNextAction(row, col, value)
      } else if (col.editable === 'verify') {
        if (value !== 'verified') throw new Error('Only Verified can be set here — Needs Review comes from corrigenda and imports.')
        await markVerified.mutateAsync(row.id)
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
      const fav = favourites.has(row.id)
      const archived = row.status === 'archived'
      const icon = 'flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.07] hover:text-ink focus-visible:focus-ring'
      return (
        <span className="flex items-center gap-0.5">
          <button
            type="button" aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={fav}
            title={fav ? 'Remove from favourites' : 'Add to favourites'}
            onClick={(e) => { e.stopPropagation(); toggleFavourite(row.id) }}
            className={cn(icon, fav && 'text-amber-500 hover:text-amber-500')}
          >
            <Icon name="Star" size={14} className={fav ? 'fill-amber-400' : undefined} />
          </button>
          <button
            type="button" aria-label={archived ? 'Unarchive' : 'Archive'} title={archived ? 'Unarchive' : 'Archive'}
            onClick={(e) => { e.stopPropagation(); (archived ? unarchive : archive).mutate(row.id) }}
            className={icon}
          >
            <Icon name={archived ? 'ArchiveRestore' : 'Archive'} size={14} />
          </button>
          <button
            type="button" aria-label="Delete bid" title="Delete bid"
            onClick={(e) => { e.stopPropagation(); deleteBid(row) }}
            className={cn(icon, 'hover:bg-crimson-100 hover:text-crimson')}
          >
            <Icon name="Trash2" size={14} />
          </button>
        </span>
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
    const person = personOf(col, v, lookups)
    if (person) return <PersonName person={person} className="max-w-full" />
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

  const totalCount = modeRows.length
  const createLabel = createLabelFor(sheetId)
  const hasFilters = rules.length > 0
  const frozenStyle = (id: string) => (frozen.left.has(id) ? { left: frozen.left.get(id) } : undefined)
  const scrollerWidth = parentRef.current?.clientWidth || 1200 // 0 = not laid out yet
  const freezeBlockedReason = (meta: GridColumnMeta) =>
    !frozen.left.has(meta.id) && frozen.width + columnWidth(meta) > scrollerWidth * MAX_FROZEN_SHARE
      ? 'No room to freeze more — unfreeze another column first.'
      : null
  // Editable only while unlocked; locked, every cell is read/navigate-only. With RBAC enforced the role must also
  // allow this field on this row (the server stays the authority).
  const canEditCell = (row: BidGridRow, meta: GridColumnMeta) => unlocked && isColumnOpen(meta) && roleAllowsCell(perms, row, meta.id, me)
  // --- right-click menus ----------------------------------------------------------
  const openCellMenu = (e: React.MouseEvent, row: BidGridRow, meta: GridColumnMeta) => {
    e.preventDefault()
    const v = cellValue(row, meta)
    const text = meta.type === 'select'
      ? (meta.options?.find((o) => o.value === v)?.label ?? String(v ?? ''))
      : formatValueText(meta, v, lookups)
    const archived = row.status === 'archived'
    const editable = canEditCell(row, meta)
    const root = toRoot(rules)
    const groups: MenuEntry[][] = [
      [
        { label: 'Open details', icon: 'ExternalLink', onSelect: () => navigate(`/bid-tracker/bid/${row.id}`) },
        {
          label: editable ? 'Edit cell' : (unlocked ? (isColumnOpen(meta) ? 'Edit cell (not allowed for your role)' : 'Edit cell (read-only column)') : 'Edit cell (unlock first)'), icon: 'Pencil', disabled: !editable,
          onSelect: () => document.querySelector<HTMLElement>(`[data-cell="${row.id}:${meta.id}"] [data-editable-cell]`)?.click(),
        },
        { label: 'Copy value', icon: 'Copy', disabled: !text, onSelect: () => { void navigator.clipboard?.writeText(text) } },
      ],
      [
        {
          label: `Filter: ${meta.header} is this value`, icon: 'SlidersHorizontal', disabled: meta.type === null || isEmptyCell(v),
          onSelect: () => setRules(fromRoot({ ...root, items: [...root.items, { field: meta.id, operator: 'eq', value: String(v) }] })),
        },
      ],
      // Move to…: every sheet this row does not already live in.
      moveTargets(row.sheet ?? null).map((to) => ({
        label: `Move to ${OWNED_SHEET_LABELS[to]}`, icon: 'MoveRight', onSelect: () => { void moveRows([row.id], to) },
      })),
      [
        { label: favourites.has(row.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'Star', onSelect: () => toggleFavourite(row.id) },
        { label: archived ? 'Unarchive' : 'Archive', icon: archived ? 'ArchiveRestore' : 'Archive', onSelect: () => (archived ? unarchive : archive).mutate(row.id) },
        { label: 'Delete bid…', icon: 'Trash2', danger: true, onSelect: () => deleteBid(row) },
      ],
    ]
    setMenu({ x: e.clientX, y: e.clientY, title: `${row.opportunityName} · ${meta.header}`, groups })
  }
  const openHeaderMenu = (e: React.MouseEvent, column: { getIsSorted: () => false | 'asc' | 'desc'; getCanSort: () => boolean; toggleSorting: (desc?: boolean, multi?: boolean) => void; clearSorting: () => void }, meta: GridColumnMeta) => {
    e.preventDefault()
    const sorted = column.getIsSorted()
    const frozenNow = frozen.left.has(meta.id)
    const groups: MenuEntry[][] = [
      [
        { label: 'Sort ascending', icon: 'ArrowUp', disabled: !column.getCanSort() || sorted === 'asc', onSelect: () => column.toggleSorting(false, false) },
        { label: 'Sort descending', icon: 'ArrowDown', disabled: !column.getCanSort() || sorted === 'desc', onSelect: () => column.toggleSorting(true, false) },
        { label: 'Clear sort', icon: 'RotateCcw', disabled: !sorted, onSelect: () => column.clearSorting() },
      ],
      [
        { label: 'Filter by this column', icon: 'SlidersHorizontal', disabled: meta.type === null, onSelect: () => addRule(meta.id) },
        { label: frozenNow ? 'Unfreeze column' : 'Freeze column', icon: frozenNow ? 'PinOff' : 'Pin', disabled: !frozenNow && !!freezeBlockedReason(meta), onSelect: () => toggleFreeze(meta.id) },
        { label: 'Hide column', icon: 'EyeOff', disabled: visible.length <= 1, onSelect: () => setVisibleIds(setColumnVisibility(allColumns, visibleIds, meta.id, false)) },
      ],
    ]
    setMenu({ x: e.clientX, y: e.clientY, title: `${meta.header} column`, groups })
  }
  const cellBg = (row: BidGridRow, meta: GridColumnMeta) => (!unlocked || (isColumnOpen(meta) && roleAllowsCell(perms, row, meta.id, me)) ? EDITABLE_BG : READONLY_BG)

  // --- spreadsheet keyboard: arrows / Tab / Shift+Tab move the active cell -------
  /** Focus a cell's editor-box (or its read-only box), scrolling it into the virtual window first. */
  const focusCell = (rowIndex: number, colId: string) => {
    const rowId = tableRows[rowIndex]?.original.id
    if (!rowId) return
    const find = () => parentRef.current?.querySelector<HTMLElement>(
      `[data-cell="${CSS.escape(`${rowId}:${colId}`)}"] :is([data-editable-cell], [data-readonly-cell])`,
    )
    const el = find()
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return }
    virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
    requestAnimationFrame(() => { const later = find(); later?.focus(); later?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
  }
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!unlocked) return
    const target = e.target as HTMLElement
    // Only from a cell's resting box — an open editor owns its own keys.
    if (!target.matches('[data-editable-cell], [data-readonly-cell]')) return
    const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
    const move = step[e.key]
    if (!move) return
    const key = target.closest('td')?.getAttribute('data-cell')
    if (!key) return
    const split = key.indexOf(':')
    const rowIndex = tableRows.findIndex((r) => r.original.id === key.slice(0, split))
    const colIndex = displayCols.findIndex((c) => c.id === key.slice(split + 1))
    const nextRow = rowIndex + move[0]
    const nextCol = colIndex + move[1]
    if (nextRow < 0 || nextRow >= tableRows.length || nextCol < 0 || nextCol >= displayCols.length) return
    e.preventDefault()
    focusCell(nextRow, displayCols[nextCol].id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bid-master-grid">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-1.5">
        {props.toolbarLead}
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
            {showArchived
              ? <Button variant="secondary" size="sm" className="h-6 px-2" onClick={unarchiveSelected}>Unarchive Selected</Button>
              : <Button variant="secondary" size="sm" className="h-6 px-2" onClick={archiveSelected}>Archive Selected</Button>}
            <Button variant="secondary" size="sm" className="h-6 px-2" onClick={() => setReassignOpen(true)}>Reassign Owner</Button>
            <select
              aria-label="Move selected to" value=""
              onChange={(e) => { if (e.target.value) void moveRows(selectedIds, e.target.value as OwnedSheet) }}
              className="h-6 rounded-md border border-line bg-white px-1.5 text-[12.5px] text-goms-navy focus-visible:focus-ring"
            >
              <option value="">Move to…</option>
              {moveTargets(sheetId === 'master' ? null : sheetId).map((to) => <option key={to} value={to}>{OWNED_SHEET_LABELS[to]}</option>)}
            </select>
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
            size="toolbar" unlocked={unlocked} onToggle={requestToggleLock}
            lockedLabel="Master grid editing locked — tap to unlock"
            unlockedLabel="Master grid editing unlocked — tap to lock"
          />
          <Button
            variant="secondary" size="sm" aria-pressed={showArchived} className={cn('h-7 px-2.5', showArchived && 'border-goms-navy bg-goms-navy/[0.07]')}
            title={showArchived ? 'Back to active bids' : 'Show archived bids'}
            onClick={() => { setShowArchived((v) => !v); setSelected(new Set()) }}
          >
            <Icon name="Archive" size={14} /> {showArchived ? 'Archived' : 'Archived'}
            {archivedCount > 0 && <span className="rounded-full bg-ink-900/10 px-1.5 text-[11px]">{archivedCount}</span>}
          </Button>
          <ToolbarPopover
            label="Manage columns" icon="List" open={columnsOpen} align="end"
            onOpenChange={(open) => { setColumnsOpen(open); if (!open) setManageColumnId(null) }}
          >
            <ManageColumnsPanel all={allColumns} visible={visible} columnOrder={visibleIds} onVisibleChange={setVisibleIds} focusId={manageColumnId} inScope={(f) => columnInScope(f.sheet, sheetId, props.columnScope)} />
          </ToolbarPopover>
          <Button variant="primary" size="sm" className="h-7 px-2.5" onClick={() => setCreateBidOpen(true)}>
            <Icon name="Plus" size={14} /> {createLabel}
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
      <div ref={parentRef} onKeyDown={onGridKeyDown} className={cn('mx-3 mb-3 mt-2 min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-thin rounded-xl border border-line shadow-sm', SHEET_BG)} data-testid="grid-scroller">
        <table className="border-separate border-spacing-0 text-[12.5px] text-ink" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: SELECT_COL_WIDTH }} />
            {displayCols.map((c) => <col key={c.id} style={{ width: columnWidth(c) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                scope="col" rowSpan={2} style={{ left: 0 }}
                className="sticky z-10 border-b border-line bg-grid-head px-0 text-center"
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
                    'h-6 overflow-hidden whitespace-nowrap border-l border-line first:border-l-0 bg-grid-head px-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-goms-navy/70',
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
                      onContextMenu={(e) => openHeaderMenu(e, h.column, meta)}
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
                        sorted ? 'bg-grid-sorted' : 'bg-white',
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
                          {unlocked && isColumnOpen(meta) && <span title="Editable column" className="shrink-0 text-goms-green"><Icon name="Pencil" size={10} /></span>}
                        </button>
                        {canLockColumn(meta) ? (
                          <LockSwitch
                            size="sm" unlocked={isColumnOpen(meta)} onToggle={() => toggleColumnLock(meta)}
                            disabled={!unlocked}
                            lockedLabel={`Unlock ${meta.header} column`} unlockedLabel={`Lock ${meta.header} column`}
                          />
                        ) : meta.id !== 'manage' && (
                          <span title={`Always locked — ${meta.readOnlyReason ?? 'no write path'}`} aria-label="Always locked" role="img" className="inline-flex shrink-0 text-muted/50"><Icon name="Lock" size={11} /></span>
                        )}
                        {isFrozen && <span title="Frozen column" className="inline-flex shrink-0 text-goms-navy/60"><Icon name="Pin" size={11} /><span className="sr-only">Frozen</span></span>}
                        {filteredCount > 0 && (
                          <span title="Filtered" className="inline-flex shrink-0 text-goms-sky">
                            <Icon name="SlidersHorizontal" size={12} />
                            <span className="sr-only">Filtered</span>
                          </span>
                        )}
                        {h.column.getCanSort() && sorted && (
                          <span className="shrink-0 text-goms-navy"><Icon name={sorted === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={13} /></span>
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
                    const display = renderCell(row.original, meta, !canEditCell(row.original, meta))
                    const isFrozen = frozen.left.has(meta.id)
                    return (
                      <td
                        key={cell.id} data-cell={`${row.original.id}:${meta.id}`}
                        onContextMenu={(e) => openCellMenu(e, row.original, meta)}
                        style={{
                          ...frozenStyle(meta.id), height: ROW_HEIGHT,
                          boxShadow: frozen.lastId === meta.id ? `${CELL_BEVEL}, ${FROZEN_SHADOW}` : CELL_BEVEL,
                        }}
                        title={unlocked && !isColumnOpen(meta)
                          ? [meta.readOnlyReason ?? 'Column locked', canLockColumn(meta) && 'unlock the column from its header to edit'].filter(Boolean).join(' — ')
                          : unlocked && !canEditCell(row.original, meta) ? 'Your role cannot edit this field on this row' : undefined}
                        className={cn(
                          'relative overflow-hidden whitespace-nowrap border-b border-r border-line/70 p-0 transition-colors duration-150',
                          cellBg(row.original, meta),
                          isFrozen && FROZEN_BG,
                          isSelected && SELECTED_BG,
                          rightAligned(meta) && 'text-right',
                          isFrozen && 'sticky z-10',
                          frozen.lastId === meta.id && 'border-r-2 border-r-goms-navy/25',
                          flashId === meta.id && 'bg-goms-green/20',
                        )}
                      >
                        {canEditCell(row.original, meta) ? (
                          <EditableCell
                            col={effectiveMeta(meta)} value={editValue(row.original, meta)} display={display} lookups={lookups}
                            externalError={cellErrors[`${row.original.id}:${meta.id}`]}
                            pending={pendingEdits} cellKey={`${row.original.id}:${meta.id}`}
                            onCommit={(value) => commitCell(row.original, effectiveMeta(meta), value)}
                          />
                        ) : (
                          <div
                            // Unlocked, read-only cells still take the selection rectangle (so arrow keys can
                            // pass over them) and show a lock with the reason instead of an editor.
                            tabIndex={unlocked ? -1 : undefined}
                            data-readonly-cell={unlocked ? '' : undefined}
                            className={cn(
                              'group/cell flex h-[35px] items-center gap-1 px-3 outline-none',
                              rightAligned(meta) && 'justify-end',
                              unlocked && 'cursor-not-allowed focus:shadow-[inset_0_0_0_2px_#8A9AAD]',
                            )}
                          >
                            <span className="min-w-0 truncate">{display}</span>
                            {unlocked && meta.id !== 'manage' && meta.id !== 'opportunityId' && (
                              <Icon name="Lock" size={11} className="ml-auto shrink-0 text-muted opacity-0 group-hover/cell:opacity-70 group-focus/cell:opacity-70" />
                            )}
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
            {totalCount === 0 && !hasFilters
              ? (showArchived ? 'Nothing archived in this sheet.' : 'Nothing in this sheet yet.')
              : 'No bids match the current search and filters.'}
            {(hasFilters || search) && (
              <Button variant="ghost" size="sm" onClick={() => { setRules([]); setSearch('') }}>Clear search and filters</Button>
            )}
            {totalCount === 0 && !hasFilters && !showArchived && (
              <Button variant="primary" size="sm" onClick={() => setCreateBidOpen(true)}><Icon name="Plus" size={14} /> {createLabel}</Button>
            )}
          </div>
        )}
      </div>
      {menu && <GridContextMenu x={menu.x} y={menu.y} title={menu.title} groups={menu.groups} onClose={() => setMenu(null)} />}
      <AddCustomColumnDialog
        open={addColumnOpen} onClose={() => setAddColumnOpen(false)} sheet={newColumnOwner}
        // With an explicit column list (a saved view), absence means hidden — so a
        // brand-new column is appended to it; in the default view it shows itself.
        onCreated={(field) => {
          const id = `custom:${field.key}`
          if (chosenVisibleIds?.length) {
            const order = orderedColumnIds(allColumns, visibleIds)
              .filter((token) => columnIdFromOrderToken(token) !== id)
            setVisibleIds([...order, id])
          }
          scrollToId.current = id
          setFlashId(id)
        }}
      />
      <CreateBidDialog open={createBidOpen} onClose={() => setCreateBidOpen(false)} sheet={sheetId} />
      <Dialog
        open={reassignOpen} onClose={() => setReassignOpen(false)}
        title={`Reassign owner for ${selectedIds.length} bid${selectedIds.length === 1 ? '' : 's'}`}
      >
        <Combobox
          value="" onChange={reassignSelected} placeholder="Choose a sales person…"
          options={salesPersons.map((p) => ({ value: p.id, label: p.name, searchText: p.officialEmail, person: p }))}
        />
      </Dialog>
      <Dialog
        open={lockPromptOpen} onClose={() => setLockPromptOpen(false)} title="You have an unsaved edit"
        description="A cell is still being edited and its value cannot be saved as it stands. Fix it to save, or discard it before locking."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLockPromptOpen(false)}>Keep editing</Button>
            <LockSwitch unlocked onToggle={discardAndLock} lockedLabel="Unlock editing"
              unlockedLabel="Discard edit and lock" text="Discard edit and lock" className="lock-switch--confirmation" />
          </div>
        )}
      >
        <p className="text-[13px] text-muted">Nothing has been lost yet — choose Keep editing to go back to the cell.</p>
      </Dialog>
    </div>
  )
}
