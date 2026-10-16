import type { Competitor, DataRow, HierNode, MakerDocument, TenderWebsite } from '@goms/domain'
import type { Customer, Employee, FollowUp, SalesPerson, SalesPosting, TimelineEvent } from '@/lib/types'
import type { OrgPerson } from '@/data/org-structure'
import { TEAM_DEPARTMENT } from '@/data/org-structure'
import type { StateSummary } from '@/data/repository'
import type { CommercialBoq, CommercialSku } from '@/modules/commercial-calculator/types'
import type { PeopleNames } from './opportunityRows'

/** Pure row builders for the People, Account Mapping, Commercial and workspace sources. */

const TEAM_DEPARTMENTS: ReadonlySet<string> = new Set(Object.values(TEAM_DEPARTMENT))

export function employeeRows(people: readonly OrgPerson[]): DataRow[] {
  const names = new Map(people.map((p) => [p.id, p.name]))
  const reports = new Map<string, number>()
  for (const p of people) if (p.managerId) reports.set(p.managerId, (reports.get(p.managerId) ?? 0) + 1)
  return people.map((p) => {
    const primary = p.departments[0] ?? ''
    const team = p.departments.find((d) => TEAM_DEPARTMENTS.has(d)) ?? primary
    return {
      id: p.id, name: p.name, designation: p.designation, level: `L${p.level}`, department: primary, team,
      departmentCount: p.departments.length, reportsTo: p.managerId ? names.get(p.managerId) ?? '' : '',
      directReports: reports.get(p.id) ?? 0, status: p.status, createdAt: p.createdAt,
    }
  })
}

export function salesPersonRows(persons: readonly SalesPerson[], postings: Readonly<Record<string, SalesPosting>>): DataRow[] {
  const names = new Map(persons.map((p) => [p.id, p.name]))
  return persons.map((p) => {
    const posting = postings[p.id]
    return {
      id: p.id, name: p.name, status: p.status, tier: posting?.tierKey ?? '', designation: posting?.designation ?? '',
      office: posting?.office ?? '', reportingManager: posting?.managerId ? names.get(posting.managerId) ?? '' : '', joinedOn: p.joinedOn,
    }
  })
}

export function contactRows(employees: readonly Employee[], departments: Readonly<Record<string, { name: string }>>): DataRow[] {
  return employees.map((e) => ({
    id: e.id, name: e.name, designation: e.designation, department: departments[e.id]?.name ?? '',
    relationshipStatus: e.relationshipStatus, relationshipQuality: e.relationshipQuality, importantContact: e.importantContact,
    connected: e.connected, vacant: e.vacant, lastInteractionAt: e.lastInteractionAt,
  }))
}

export function departmentRows(nodes: readonly HierNode[], stateNames: ReadonlyMap<number, string>): DataRow[] {
  return nodes.map((n) => ({
    id: n.id, name: n.name, code: n.code ?? '', status: n.status,
    state: n.stateCode === null ? '' : stateNames.get(n.stateCode) ?? String(n.stateCode),
  }))
}

export function customerRows(customers: readonly Customer[]): DataRow[] {
  return customers.map((c) => ({
    id: c.id, name: c.name, organization: c.organization, hasGst: !!c.gst.trim(),
    hasContact: !!(c.contactName.trim() || c.contactEmail.trim() || c.contactPhone.trim()), createdAt: c.createdAt,
  }))
}

export function geographyRows(states: readonly StateSummary[]): DataRow[] {
  return states.map((s) => ({ id: String(s.code), state: s.name, departments: s.departments, offices: s.offices, contacts: s.employees }))
}

export function meetingRows(events: readonly TimelineEvent[], employees: readonly Employee[]): DataRow[] {
  const names = new Map(employees.map((e) => [e.id, e.name]))
  return events.map((e) => ({
    id: e.id, title: e.title, type: e.type, contact: names.get(e.employeeId) ?? '',
    attendance: e.attended === true ? 'attended' : e.attended === false ? 'missed' : 'unmarked',
    attendeeCount: e.attendees?.length ?? 0, source: e.source, date: e.date,
  }))
}

export function followUpRows(followUps: readonly FollowUp[], people: PeopleNames): DataRow[] {
  return followUps.map((f) => ({
    id: f.id, entityType: f.entityType, assignee: people.get(f.assigneeId) ?? '', status: f.status, dueDate: f.dueDate, createdAt: f.createdAt,
  }))
}

export function competitorRows(items: readonly Competitor[]): DataRow[] {
  return items.map((c) => ({
    id: c.id, name: c.name, relationship: c.relationship, category: c.category, primaryVertical: c.verticals[0] ?? '',
    verticalCount: c.verticals.length, offeringCount: c.offerings.length, certificationCount: c.certifications.length, createdAt: c.createdAt,
  }))
}

export function boqRows(boqs: readonly CommercialBoq[], people: PeopleNames): DataRow[] {
  return boqs.map((b) => ({
    id: b.id, boqNumber: b.boqNumber, opportunityName: b.opportunityName, customerName: b.customerName, status: b.status,
    currency: b.currency, salesPerson: people.get(b.salesPersonId) ?? '', boqVersion: b.boqVersion, revisionNumber: b.revisionNumber,
    grandTotal: b.grandTotal, createdAt: b.createdAt, lastModifiedAt: b.lastModifiedAt,
  }))
}

export function skuRows(skus: readonly CommercialSku[]): DataRow[] {
  return skus.map((s) => ({
    id: s.id, skuCode: s.skuCode, name: s.name, lifecycleStatus: s.lifecycleStatus, isSellable: s.isSellable,
    listPrice: s.listPrice, governmentPrice: s.governmentPrice, partnerPrice: s.partnerPrice, activeFrom: s.activeFrom,
  }))
}

export function makerRows(docs: readonly MakerDocument[]): DataRow[] {
  return docs.map((d) => ({
    id: d.id, title: d.title, kind: d.kind, fileType: d.fileType, sizeKb: Math.round(d.size / 1024), version: d.version,
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  }))
}

/** Counts and flags only: the portal address and the encrypted login never enter a row. */
export function tenderWebsiteRows(sites: readonly TenderWebsite[]): DataRow[] {
  return sites.map((s) => ({
    id: s.id, name: s.name, kind: s.kind ?? 'tender', hasCredentials: !!s.credentials, hasDscHolder: !!s.dscEmployeeId,
    editingLocked: !!s.editingLocked, createdAt: s.createdAt,
  }))
}
