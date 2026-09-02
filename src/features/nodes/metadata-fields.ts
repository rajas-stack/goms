import type { Domain, FieldDef } from '@/lib/types'

/** Per-type metadata field definitions. In production these come from
 *  node_type_versions.field_schema; here they seed the schema-driven form. */
const FIELDS: Record<string, FieldDef[]> = {
  department: [
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'website', label: 'Website', type: 'url' },
    // The old single `contact` phone field is replaced by DepartmentFields'
    // richer State/District/City + multi-number contact block (metadata
    // keys contactStateNodeId/contactDistrictNodeId/contactNumbers) —
    // rendered directly in DepartmentFields.tsx, not through this
    // generic schema-driven list.
    { key: 'departmentEmail', label: 'Department email', type: 'email' },
    { key: 'officeAddress', label: 'Office address', type: 'text' },
  ],
  branch: [{ key: 'location', label: 'Location', type: 'string' }, { key: 'notes', label: 'Notes', type: 'text' }],
  division: [{ key: 'location', label: 'Location', type: 'string' }, { key: 'notes', label: 'Notes', type: 'text' }],
  office: [{ key: 'location', label: 'Location', type: 'string' }, { key: 'contact', label: 'Contact number', type: 'phone' }],
  unit: [{ key: 'notes', label: 'Notes', type: 'text' }],
}

const GEO_FIELDS: FieldDef[] = [{ key: 'notes', label: 'Notes', type: 'text' }]

export function fieldsForType(typeKey: string, domain: Domain): FieldDef[] {
  if (domain === 'geo') return GEO_FIELDS
  return FIELDS[typeKey] ?? [{ key: 'notes', label: 'Notes', type: 'text' }]
}
