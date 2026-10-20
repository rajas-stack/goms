import type { ReactElement } from 'react'
import { EmailContactsMaster } from '@/features/communication/EmailContactsMaster'
import { AmnexDepartmentsSection } from '@/features/departments/AmnexDepartmentsSection'
import { MasterCrudScreen } from '@/modules/commercial-calculator/components/MasterCrudScreen'
import { HierarchyView } from '@/modules/commercial-calculator/pages/HierarchyView'
import { SkuCatalog } from '@/modules/commercial-calculator/pages/SkuCatalog'
import { BidTrackerMasters } from './BidTrackerMasters'
import { SalesPhotosFromDrive } from '@/features/employees/SalesPhotosFromDrive'

/** The page of each master in ./mastersList (keyed by `kind`). Every entry there needs one here. */
export const MASTER_RENDERERS: Readonly<Record<string, () => ReactElement>> = {
  'email-contacts': () => <EmailContactsMaster />,
  employees: () => <AmnexDepartmentsSection />,
  'bid-tracker': () => <BidTrackerMasters />,
  'sales-photos': () => <SalesPhotosFromDrive />,
  verticals: () => <MasterCrudScreen masterKey="verticals" />,
  'product-hierarchy': () => <HierarchyView />,
  'sku-catalog': () => <SkuCatalog />,
  'sku-categories': () => <MasterCrudScreen masterKey="skuCategories" />,
  'units-of-measure': () => <MasterCrudScreen masterKey="unitsOfMeasure" />,
  'product-editions': () => <MasterCrudScreen masterKey="productEditions" />,
  'billing-types': () => <MasterCrudScreen masterKey="billingTypes" />,
  'tax-classes': () => <MasterCrudScreen masterKey="taxClasses" />,
  'approval-matrix': () => <MasterCrudScreen masterKey="approvalMatrix" />,
  currencies: () => <MasterCrudScreen masterKey="currencies" />,
  'pre-sales': () => <MasterCrudScreen masterKey="preSales" />,
}
