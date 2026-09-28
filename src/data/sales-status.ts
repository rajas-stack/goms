import type { SalesPerson } from '@/lib/types'

export const STATUS_STYLE: Record<SalesPerson['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700',
  onLeave: 'bg-amber-50 text-amber-700',
  resigned: 'bg-ink-900/[0.06] text-ink-600',
  inactive: 'bg-ink-900/[0.06] text-ink-600',
}

export const STATUS_LABEL: Record<SalesPerson['status'], string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

export const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'onLeave', label: 'On leave' },
  { key: 'resigned', label: 'Resigned' },
  { key: 'inactive', label: 'Inactive' },
] as const
