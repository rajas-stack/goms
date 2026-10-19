import type { PolicyModuleKey } from '@goms/domain'

/** The single list of every master (reference list) in GOMS.
 *
 *  RULE: a master is maintained ONLY under Settings > Masters > <title>, and every feature that
 *  uses its values reads them from the master (see ./useMasterOptions) — never a hard-coded list,
 *  never a per-feature "add option" store. Adding a master = one entry here plus its page in
 *  ./mastersRegistry; the Settings menu, route `/settings/masters/<kind>` and permission node
 *  `settings.masters.<kind>` all derive from this list. */
export interface MasterPageMeta {
  kind: string
  title: string
  hint: string
  /** Permission modules that may open it (any one at Read or above). Empty = open to everyone signed in. */
  modules: readonly PolicyModuleKey[]
  /** Full-width work surface (tables / trees) rather than a centred column. */
  wide?: boolean
}

export const MASTER_PAGE_LIST: readonly MasterPageMeta[] = [
  { kind: 'email-contacts', title: 'Email Contacts', hint: 'Reviewed OEM, external and client department email participants.', modules: ['am.contacts'], wide: true },
  { kind: 'employees', title: 'Employee Master', hint: 'Amnex departments employees belong to.', modules: [] },
  { kind: 'sales-photos', title: 'Sales Team Photos', hint: 'Match profile photos from a Google Drive folder to sales people by name.', modules: ['team.sales'], wide: true },
  { kind: 'bid-tracker', title: 'Bid Tracker', hint: 'Bid Tracker dropdowns: priority, payment modes, EMD instruments, RTM, zones, tender statuses, BU owners.', modules: ['com.masters'], wide: true },
  { kind: 'verticals', title: 'Verticals', hint: 'Verticals used by opportunities, bids, SKUs and imports.', modules: ['com.masters'], wide: true },
  { kind: 'product-hierarchy', title: 'Product Hierarchy', hint: 'Vertical → Product → Module → Feature.', modules: ['com.masters'], wide: true },
  { kind: 'sku-catalog', title: 'SKU Catalog', hint: 'Sellable SKUs and their bills of material.', modules: ['com.skus'], wide: true },
  { kind: 'sku-categories', title: 'SKU Categories', hint: 'Categories SKUs are grouped under.', modules: ['com.masters'], wide: true },
  { kind: 'units-of-measure', title: 'Units of Measure', hint: 'Units SKUs are quoted in.', modules: ['com.masters'], wide: true },
  { kind: 'product-editions', title: 'Product Editions', hint: 'Editions and the features each includes.', modules: ['com.masters'], wide: true },
  { kind: 'billing-types', title: 'Billing Types', hint: 'How SKUs are billed.', modules: ['com.masters'], wide: true },
  { kind: 'tax-classes', title: 'Tax Classes', hint: 'Tax rates applied to SKUs.', modules: ['com.masters'], wide: true },
  { kind: 'approval-matrix', title: 'Approval Matrix', hint: 'Discount bands and who approves them.', modules: ['com.approvalMatrix'], wide: true },
  { kind: 'currencies', title: 'Currencies', hint: 'Currencies and exchange rates.', modules: ['com.masters'], wide: true },
  { kind: 'pre-sales', title: 'Pre-Sales', hint: 'Pre-sales reference entries for the Commercial Calculator.', modules: ['com.masters'], wide: true },
]
