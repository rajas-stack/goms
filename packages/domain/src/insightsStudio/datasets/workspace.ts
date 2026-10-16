import { COMPETITOR_RELATIONSHIP_LABEL, COMPETITOR_RELATIONSHIPS } from '../../competitors.js'
import { MAKER_DOCUMENT_KINDS } from '../../makerDocuments.js'
import { TENDER_WEBSITE_KINDS } from '../../tenderWebsites.js'
import { ageDays, boolDim, breakdown, dateDim, dim, enumDim, money, num, options, tagged } from '../fields.js'
import type { DatasetDef } from '../types.js'
import { COUNT_FIELD } from '../types.js'

/** Pre-sales, commercial and workspace sources. Tender websites expose counts and flags only — never URLs or
 *  credentials. */

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const COMPETITORS: DatasetDef = {
  id: 'competitors',
  label: 'Competitors',
  module: 'Settings › Pre-sales › Competitors',
  description: 'Tracked rival and partner companies with their positioning.',
  rbacModules: ['opp.bidTracker', 'opp.pipeline', 'opp.campaign'],
  rowNoun: 'competitor',
  timeField: 'createdAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Company'),
    enumDim('relationship', 'Relationship', COMPETITOR_RELATIONSHIPS.map((value) => ({ value, label: COMPETITOR_RELATIONSHIP_LABEL[value] })), breakdown),
    dim('category', 'Category', breakdown),
    dim('primaryVertical', 'Primary vertical', { ...tagged('vertical'), breakdown: true }),
    num('verticalCount', 'Verticals'),
    num('offeringCount', 'Offerings'),
    num('certificationCount', 'Certifications'),
    dateDim('createdAt', 'Added'),
  ],
}

const BOQ_STATUS = options([['draft', 'Draft'], ['submitted', 'Submitted'], ['under_review', 'Under review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['archived', 'Archived']])

export const COMMERCIAL_BOQS: DatasetDef = {
  id: 'commercialBoqs',
  label: 'BOQs & proposals',
  module: 'Commercial Calculator › BOQs',
  description: 'Bills of quantities with their approval status, version and grand total.',
  rbacModules: ['com.boqs'],
  rowNoun: 'BOQ',
  timeField: 'createdAt',
  defaultMeasure: 'grandTotalCr',
  fields: [
    dim('boqNumber', 'BOQ number'),
    dim('opportunityName', 'Opportunity'),
    dim('customerName', 'Customer', breakdown),
    enumDim('status', 'Status', BOQ_STATUS, breakdown),
    dim('currency', 'Currency'),
    dim('salesPerson', 'Sales person', { ...tagged('owner'), breakdown: true }),
    num('boqVersion', 'Version'),
    num('revisionNumber', 'Revision'),
    money('grandTotalCr', 'Grand total (INR Cr)', {
      ...tagged('value'),
      derive: (row) => (row.currency === 'INR' && typeof row.grandTotal === 'number' ? row.grandTotal / 1e7 : null),
      description: 'INR grand totals in crore; other currencies are left out',
    }),
    dateDim('createdAt', 'Created'),
    dateDim('lastModifiedAt', 'Last modified'),
    ageDays('ageDays', 'Age (days)', 'createdAt'),
  ],
  suggestions: [
    { name: 'BOQs by status', description: 'Where proposals are in approval', spec: { chart: 'funnel', query: { datasetId: 'commercialBoqs', dimensions: [{ field: 'status' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [] } } },
  ],
}

export const COMMERCIAL_SKUS: DatasetDef = {
  id: 'commercialSkus',
  label: 'SKU catalog',
  module: 'Commercial Calculator › SKU catalog',
  description: 'Sellable SKUs with lifecycle status and price levels (cost fields stay masked by role).',
  rbacModules: ['com.skus'],
  rowNoun: 'SKU',
  timeField: 'activeFrom',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('skuCode', 'SKU code'),
    dim('name', 'SKU'),
    enumDim('lifecycleStatus', 'Lifecycle', options([['draft', 'Draft'], ['active', 'Active'], ['inactive', 'Inactive'], ['retired', 'Retired']]), breakdown),
    boolDim('isSellable', 'Sellable', breakdown),
    num('listPrice', 'List price'),
    num('governmentPrice', 'Government price'),
    num('partnerPrice', 'Partner price'),
    dateDim('activeFrom', 'Active from'),
  ],
}

export const MAKER_DOCUMENTS: DatasetDef = {
  id: 'makerDocuments',
  label: 'Document maker files',
  module: 'Document maker',
  description: 'Your own documents, spreadsheets and presentations.',
  rbacModules: ['an.operational'],
  rowNoun: 'file',
  timeField: 'updatedAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('title', 'Title'),
    enumDim('kind', 'Kind', MAKER_DOCUMENT_KINDS.map((value) => ({ value, label: titleCase(value) })), breakdown),
    dim('fileType', 'File type', breakdown),
    num('sizeKb', 'Size (KB)'),
    num('version', 'Versions'),
    dateDim('createdAt', 'Created'),
    dateDim('updatedAt', 'Updated'),
  ],
}

export const TENDER_WEBSITES: DatasetDef = {
  id: 'tenderWebsites',
  label: 'Tender websites',
  module: 'Settings › Bid team › Tender websites',
  description: 'Tender and verification portals — counts and flags only; addresses and credentials are never read.',
  rbacModules: ['opp.bidTracker', 'opp.pipeline', 'opp.campaign'],
  rowNoun: 'website',
  timeField: 'createdAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Portal'),
    enumDim('kind', 'Kind', TENDER_WEBSITE_KINDS.map((value) => ({ value, label: titleCase(value) })), breakdown),
    boolDim('hasCredentials', 'Has saved login', breakdown),
    boolDim('hasDscHolder', 'Has DSC holder', breakdown),
    boolDim('editingLocked', 'Editing locked'),
    dateDim('createdAt', 'Added'),
  ],
}
