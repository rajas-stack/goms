import type { SynopsisNode } from '@goms/domain'
import { parseFriendlyValue } from '@/lib/friendlyDate'

/** How a General field is edited. Values are always stored as plain text so the
 *  section stays a regular two-column synopsis table (Excel export, audit). */
export type GeneralFieldKind = 'text' | 'textarea' | 'date' | 'datetime' | 'url' | 'select' | 'department' | 'websites' | 'address'

export interface GeneralField {
  key: string
  label: string
  kind: GeneralFieldKind
  options?: readonly string[]
  placeholder?: string
  /** A free-text field that usually holds a date (shown on the RFP Timeline when one can be read). */
  timeline?: boolean
}

export interface GeneralGroup { title: string; fields: readonly GeneralField[] }

const YES_NO_ALLOWED = ['allowed', 'not allowed'] as const
const COMPLIANCE = ['complied', 'partially complied', 'not complied'] as const

export const GENERAL_GROUPS: readonly GeneralGroup[] = [
  {
    title: 'Tender', fields: [
      { key: 'referenceNo', label: 'Reference/Bid No.', kind: 'text', placeholder: 'e.g. PPAC/IT/DIP/2026/001' },
      { key: 'tenderId', label: 'Tender ID', kind: 'text', placeholder: 'e.g. 2026_PPAC_927042_1' },
      { key: 'assignmentName', label: 'Name of Assignment', kind: 'textarea' },
      { key: 'scopeOfWork', label: 'Scope of Work', kind: 'text', placeholder: 'e.g. as per Scope of Work tab' },
      { key: 'submissionMode', label: 'Mode of Bid Submission (Online or Offline)', kind: 'select', options: ['online', 'offline'] },
      { key: 'procuringAuthority', label: 'Procuring Authority', kind: 'department' },
      { key: 'tenderWebsite', label: "Websites for downloading Bidding Document, Corrigendum's, Addendums etc.", kind: 'websites' },
    ],
  },
  {
    title: 'Key dates', fields: [
      { key: 'publishingDate', label: 'Tender Publishing Date', kind: 'date' },
      { key: 'receivingDate', label: 'Tender Receiving Date', kind: 'date' },
      { key: 'queriesDeadline', label: 'Last Date & Time of Submission of Queries', kind: 'datetime' },
      { key: 'preBidMeeting', label: 'Pre-Bid Meeting Date & Time', kind: 'datetime', timeline: true },
      { key: 'preBidMeetingAddress', label: 'Pre-Bid Meeting Address', kind: 'address', placeholder: 'Meeting venue and full address' },
      { key: 'preBidMeetingNotes', label: 'Pre-Bid Meeting Notes', kind: 'textarea', placeholder: 'e.g. Maximum 3 persons allowed' },
      { key: 'bidDeadline', label: 'Last Date & Time of Submission of Bid', kind: 'datetime' },
      { key: 'technicalOpening', label: 'Date & Time of Opening of Pre-qualification/Technical Bid', kind: 'datetime' },
    ],
  },
  {
    title: 'Contact & evaluation', fields: [
      { key: 'projectOfficer', label: 'Name & Address of the Project Officer In-charge (POIC)', kind: 'textarea' },
      { key: 'evaluationCriteria', label: 'Bid Evaluation Criteria (Selection Method)', kind: 'textarea' },
      { key: 'contractDuration', label: 'Contract Duration', kind: 'text' },
      { key: 'bidValidity', label: 'Bid Validity', kind: 'text', placeholder: 'e.g. 180 days' },
    ],
  },
  {
    title: 'Commercial', fields: [
      { key: 'estimatedCost', label: 'Estimated Procurement Cost', kind: 'text' },
      { key: 'tenderFee', label: 'Cost of Document (Tender Fee) & mode of submission', kind: 'textarea' },
      { key: 'emd', label: 'Bid Security/Earnest Money Deposit (EMD) & mode of submission', kind: 'textarea' },
      { key: 'pbg', label: 'PBG', kind: 'textarea' },
      { key: 'capexOpexRatio', label: 'Capex Opex Ratio', kind: 'text' },
    ],
  },
  {
    title: 'Partners & incumbency', fields: [
      { key: 'consortium', label: 'Consortium allowed', kind: 'select', options: YES_NO_ALLOWED },
      { key: 'subContracting', label: 'Sub-Contracting', kind: 'textarea' },
      { key: 'incumbent', label: 'Incumbent SI and OEM', kind: 'text' },
      { key: 'currentContractEnd', label: 'End of current contract duration', kind: 'text', timeline: true },
    ],
  },
  {
    title: 'Compliance', fields: [
      { key: 'pqCompliance', label: 'PQ Compliance', kind: 'select', options: COMPLIANCE },
      { key: 'tqCompliance', label: 'TQ Compliance', kind: 'select', options: COMPLIANCE },
    ],
  },
]

export const GENERAL_FIELDS: readonly GeneralField[] = GENERAL_GROUPS.flatMap(group => group.fields)

export type GeneralValues = Readonly<Record<string, string>>

function paragraph(text: string): SynopsisNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

function cell(type: 'tableHeader' | 'tableCell', text: string): SynopsisNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return { type, attrs: { colspan: 1, rowspan: 1, colwidth: null, wrap: true }, content: lines.map(paragraph) }
}

function cellText(node: SynopsisNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const parts = (node.content ?? []).map(cellText)
  return ['paragraph', 'heading'].includes(node.type) ? parts.join('') : parts.join('\n')
}

/** Serialize values as a Field | Value table, one row per General field. */
export function generalToDocument(values: GeneralValues): SynopsisNode {
  const rows = GENERAL_FIELDS.map(field => ({
    type: 'tableRow', content: [cell('tableCell', field.label), cell('tableCell', (values[field.key] ?? '').trim())],
  }))
  return {
    type: 'doc', content: [
      { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Field'), cell('tableHeader', 'Value')] }, ...rows] },
      paragraph(''),
    ],
  }
}

/** Read values back by matching each row's first cell to a field label, so row
 *  order and unknown extra rows do not matter. */
export function documentToGeneral(document: SynopsisNode | null | undefined): Record<string, string> {
  const byLabel = new Map(GENERAL_FIELDS.map(field => [field.label.toLowerCase(), field.key]))
  const values: Record<string, string> = {}
  let legacyMeeting: string | undefined
  for (const block of document?.content ?? []) {
    if (block.type !== 'table') continue
    for (const row of block.content ?? []) {
      const [label, value] = row.content ?? []
      const labelText = cellText(label).trim().toLowerCase()
      if (labelText === 'pre-bid meeting date & time & address') legacyMeeting = cellText(value).trim()
      const key = byLabel.get(labelText)
      if (key && !(key in values)) values[key] = cellText(value).trim()
    }
  }
  if (legacyMeeting !== undefined) {
    const [date = '', address = '', ...notes] = legacyMeeting.replace(/\r\n?/g, '\n').split('\n')
    values.preBidMeeting ??= parseFriendlyValue(date, 'datetime-local') || date
    values.preBidMeetingAddress ??= address
    values.preBidMeetingNotes ??= notes.join('\n')
  }
  return values
}
