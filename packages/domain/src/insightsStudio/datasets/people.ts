import { SALES_TIERS } from '../../sales.js'
import { ageDays, boolDim, breakdown, dateDim, dim, enumDim, num, options, tagged } from '../fields.js'
import type { DatasetDef } from '../types.js'
import { COUNT_FIELD } from '../types.js'

/** People: AMNEX's own employees (org structure), the sales roster, and the government contacts mapped in Account
 *  Mapping. Each is a separate source — a "department" on an AMNEX employee is never a customer department. */

const LEVELS = options([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [`L${n}`, `L${n}`] as const))
const count = (datasetId: string, field: string, chart: 'bar' | 'donut' | 'column') =>
  ({ chart, query: { datasetId, dimensions: [{ field }], measures: [{ field: COUNT_FIELD, agg: 'count' as const }], filters: [] } })

export const EMPLOYEES: DatasetDef = {
  id: 'employees',
  label: 'Employees',
  module: 'Teams › Company Org Structure',
  description: 'AMNEX employees from the company org structure: department, team, level, designation and reporting line.',
  rbacModules: ['team.org'],
  rowNoun: 'employee',
  timeField: 'createdAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Name'),
    dim('designation', 'Designation', breakdown),
    enumDim('level', 'Level', LEVELS, breakdown),
    dim('department', 'Department', { ...tagged('team'), breakdown: true, description: 'Primary department (first listed)' }),
    dim('team', 'Team', { ...tagged('team'), breakdown: true, description: 'Delivery team (Pre-Sales / Bid / Legal) or the primary department' }),
    num('departmentCount', 'Departments'),
    dim('reportsTo', 'Reports to'),
    num('directReports', 'Direct reports'),
    enumDim('status', 'Status', options([['active', 'Active'], ['inactive', 'Inactive']]), breakdown),
    dateDim('createdAt', 'Added'),
  ],
  suggestions: [
    { name: 'Employees by team', description: 'Headcount per team', spec: count('employees', 'team', 'bar') },
    { name: 'Employees by level', description: 'Headcount per level', spec: count('employees', 'level', 'column') },
    { name: 'Employees by department', description: 'Headcount per department', spec: count('employees', 'department', 'donut') },
  ],
}

export const SALES_PERSONS: DatasetDef = {
  id: 'salesPersons',
  label: 'Sales team',
  module: 'Teams › Sales',
  description: 'The sales roster with each person’s current tier, designation, office and reporting managers.',
  rbacModules: ['team.sales'],
  rowNoun: 'sales person',
  timeField: 'joinedOn',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Name', tagged('owner')),
    enumDim('status', 'Status', options([['active', 'Active'], ['onLeave', 'On leave'], ['resigned', 'Resigned'], ['inactive', 'Inactive']]), breakdown),
    enumDim('tier', 'Tier', SALES_TIERS.map((t) => ({ value: t.key, label: t.label })), breakdown),
    dim('designation', 'Designation', breakdown),
    dim('office', 'Office', breakdown),
    dim('reportingManager', 'Reporting manager (RM)', { ...tagged('team'), breakdown: true }),
    dateDim('joinedOn', 'Joined'),
    ageDays('tenureDays', 'Tenure (days)', 'joinedOn'),
  ],
  suggestions: [
    { name: 'Sales team by tier', description: 'Roster per tier', spec: count('salesPersons', 'tier', 'bar') },
    { name: 'Sales team by manager', description: 'Team size under each reporting manager', spec: count('salesPersons', 'reportingManager', 'bar') },
  ],
}

export const CONTACTS: DatasetDef = {
  id: 'contacts',
  label: 'Customer contacts',
  module: 'Account Mapping › People & Contacts',
  description: 'Government officials and contacts mapped under customer departments, with relationship health.',
  rbacModules: ['am.contacts'],
  rowNoun: 'contact',
  timeField: 'lastInteractionAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Name'),
    dim('designation', 'Designation', breakdown),
    dim('department', 'Customer department', breakdown),
    enumDim('relationshipStatus', 'Relationship status', options([['engaged', 'Engaged'], ['developing', 'Developing'], ['dormant', 'Dormant'], ['new', 'New']]), breakdown),
    enumDim('relationshipQuality', 'Relationship quality', options([['excellent', 'Excellent'], ['good', 'Good'], ['neutral', 'Neutral'], ['weak', 'Weak'], ['poor', 'Poor']]), breakdown),
    boolDim('importantContact', 'VIP contact'),
    boolDim('connected', 'Tracked relationship'),
    boolDim('vacant', 'Vacant seat'),
    dateDim('lastInteractionAt', 'Last interaction'),
    ageDays('daysSinceInteraction', 'Days since interaction', 'lastInteractionAt'),
  ],
  suggestions: [
    { name: 'Relationship health', description: 'Contacts by relationship status', spec: count('contacts', 'relationshipStatus', 'donut') },
  ],
}
