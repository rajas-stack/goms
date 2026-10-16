import type { PolicyModuleKey } from '../rbac/policy.js'
import { CONTACTS, EMPLOYEES, SALES_PERSONS } from './datasets/people.js'
import { CUSTOMERS, DEPARTMENTS, FOLLOW_UPS, GEOGRAPHY, MEETINGS } from './datasets/accounts.js'
import { BID_CORRIGENDA, BID_MILESTONES } from './datasets/bidWork.js'
import { OPPORTUNITY_DATASETS } from './datasets/opportunities.js'
import { COMMERCIAL_BOQS, COMMERCIAL_SKUS, COMPETITORS, MAKER_DOCUMENTS, TENDER_WEBSITES } from './datasets/workspace.js'
import { COUNT_FIELD, type DatasetDef, type FieldDef, type FieldSemantic } from './types.js'

/** The semantic data catalog: every data source Insights Studio can read, in the order the source picker shows them.
 *  Field keys are unique within a source only — a visual is always bound to exactly one source (lineage). */
export const DATASETS: readonly DatasetDef[] = [
  ...OPPORTUNITY_DATASETS,
  BID_MILESTONES, BID_CORRIGENDA,
  COMPETITORS, COMMERCIAL_BOQS, COMMERCIAL_SKUS,
  EMPLOYEES, SALES_PERSONS,
  CONTACTS, DEPARTMENTS, CUSTOMERS, GEOGRAPHY, MEETINGS, FOLLOW_UPS,
  MAKER_DOCUMENTS, TENDER_WEBSITES,
]

const BY_ID = new Map(DATASETS.map((d) => [d.id, d]))

export const getDataset = (id: string): DatasetDef | undefined => BY_ID.get(id)

/** The pseudo-field that counts rows. */
export const COUNT_FIELD_DEF: FieldDef = { key: COUNT_FIELD, label: 'Number of records', type: 'number', role: 'measure' }

export function getField(dataset: DatasetDef, key: string): FieldDef | undefined {
  return key === COUNT_FIELD ? COUNT_FIELD_DEF : dataset.fields.find((f) => f.key === key)
}

export function fieldLabel(dataset: DatasetDef, key: string): string {
  return getField(dataset, key)?.label ?? key
}

/** Sources a reader with these read levels may use. `canRead` answers for one policy module. */
export function readableDatasets(canRead: (module: PolicyModuleKey) => boolean): DatasetDef[] {
  return DATASETS.filter((d) => d.rbacModules.some(canRead))
}

/** The first field of a source with this cross-source meaning (report-level filters use it). */
export function fieldsWithSemantic(dataset: DatasetDef, ...semantics: FieldSemantic[]): FieldDef[] {
  return dataset.fields.filter((f) => f.semantic && semantics.includes(f.semantic))
}

/** Sources grouped by top-level module, for the picker. */
export function datasetsByModule(datasets: readonly DatasetDef[]): { module: string; datasets: DatasetDef[] }[] {
  const groups = new Map<string, DatasetDef[]>()
  for (const d of datasets) {
    const top = d.module.split(' › ')[0]
    groups.set(top, [...(groups.get(top) ?? []), d])
  }
  return [...groups.entries()].map(([module, list]) => ({ module, datasets: list }))
}
