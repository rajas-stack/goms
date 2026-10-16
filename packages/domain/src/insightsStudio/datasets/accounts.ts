import { ageDays, boolDim, breakdown, dateDim, daysUntil, dim, enumDim, num, options, overdue, tagged } from '../fields.js'
import type { DatasetDef } from '../types.js'
import { COUNT_FIELD } from '../types.js'

/** Account Mapping sources: customer departments, customers, geography, meetings and follow-ups. */

export const DEPARTMENTS: DatasetDef = {
  id: 'departments',
  label: 'Customer departments',
  module: 'Account Mapping › Departments & Offices',
  description: 'Government departments being mapped, by state and status.',
  rbacModules: ['am.departments'],
  rowNoun: 'department',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Department'),
    dim('code', 'Code'),
    dim('state', 'State', { ...tagged('state'), breakdown: true }),
    enumDim('status', 'Status', options([['active', 'Active'], ['archived', 'Archived']]), breakdown),
  ],
  suggestions: [
    { name: 'Departments by state', description: 'Coverage of mapped departments per state', spec: { chart: 'bar', query: { datasetId: 'departments', dimensions: [{ field: 'state' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [], sort: { by: 'count', dir: 'desc' }, limit: 12 } } },
  ],
}

export const CUSTOMERS: DatasetDef = {
  id: 'customers',
  label: 'Customers',
  module: 'Account Mapping › Customers',
  description: 'Commercial customer accounts.',
  rbacModules: ['am.customers'],
  rowNoun: 'customer',
  timeField: 'createdAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('name', 'Customer'),
    dim('organization', 'Organization', breakdown),
    boolDim('hasGst', 'Has GST', breakdown),
    boolDim('hasContact', 'Has contact', breakdown),
    dateDim('createdAt', 'Created'),
  ],
}

export const GEOGRAPHY: DatasetDef = {
  id: 'geography',
  label: 'Geography (states)',
  module: 'Account Mapping › Geography',
  description: 'Each state with the number of mapped departments, offices and contacts.',
  rbacModules: ['am.geography'],
  rowNoun: 'state',
  defaultMeasure: 'departments',
  fields: [
    dim('state', 'State', { ...tagged('state'), breakdown: true }),
    num('departments', 'Departments'),
    num('offices', 'Offices'),
    num('contacts', 'Contacts'),
  ],
  suggestions: [
    { name: 'Coverage by state', description: 'Departments mapped per state', spec: { chart: 'bar', query: { datasetId: 'geography', dimensions: [{ field: 'state' }], measures: [{ field: 'departments', agg: 'sum' }], filters: [], sort: { by: 'sum_departments', dir: 'desc' }, limit: 12 } } },
  ],
}

const INTERACTIONS = options([['meeting', 'Meeting'], ['inPerson', 'In person'], ['call', 'Call'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['followup', 'Follow-up'], ['note', 'Note'], ['document', 'Document'], ['custom', 'Custom']])

export const MEETINGS: DatasetDef = {
  id: 'meetings',
  label: 'Meetings & interactions',
  module: 'Account Mapping › Meetings',
  description: 'Meetings, calls and other interactions logged against customer contacts.',
  rbacModules: ['am.meetings'],
  rowNoun: 'interaction',
  timeField: 'date',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('title', 'Title'),
    enumDim('type', 'Interaction type', INTERACTIONS, breakdown),
    dim('contact', 'Contact'),
    enumDim('attendance', 'Attendance', options([['attended', 'Attended'], ['missed', 'Did not happen'], ['unmarked', 'Not marked']]), breakdown),
    num('attendeeCount', 'AMNEX attendees'),
    enumDim('source', 'Source', options([['manual', 'Manual'], ['system', 'System']])),
    dateDim('date', 'Date'),
  ],
  suggestions: [
    { name: 'Meetings per month', description: 'Customer interactions over time', spec: { chart: 'column', query: { datasetId: 'meetings', dimensions: [{ field: 'date', grain: 'month' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [] } } },
  ],
}

export const FOLLOW_UPS: DatasetDef = {
  id: 'followUps',
  label: 'Open follow-ups',
  module: 'Account Mapping › Follow-ups & Action Queue',
  description: 'Open follow-up work, who it is assigned to and when it is due.',
  rbacModules: ['am.followUps'],
  rowNoun: 'follow-up',
  timeField: 'dueDate',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('entityType', 'About', breakdown),
    dim('assignee', 'Assignee', { ...tagged('owner'), breakdown: true }),
    enumDim('status', 'Status', options([['open', 'Open'], ['done', 'Done'], ['cancelled', 'Cancelled']])),
    dateDim('dueDate', 'Due'),
    dateDim('createdAt', 'Created'),
    daysUntil('daysToDue', 'Days to due', 'dueDate'),
    ageDays('ageDays', 'Age (days)', 'createdAt'),
    overdue('isOverdue', 'Is overdue', 'dueDate', (row) => row.status === 'open'),
  ],
}
