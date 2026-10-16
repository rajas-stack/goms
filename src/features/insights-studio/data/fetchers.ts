import { OPPORTUNITY_SHEET_OF, type DataRow } from '@goms/domain'
import type { Repository } from '@/data/repository'
import { corrigendumRows, milestoneRows, opportunityRows, type PeopleNames } from './opportunityRows'
import {
  boqRows, competitorRows, contactRows, customerRows, departmentRows, employeeRows, followUpRows, geographyRows, makerRows,
  meetingRows, salesPersonRows, skuRows, tenderWebsiteRows,
} from './otherRows'

/** The ONE adapter between the data catalog and the platform: dataset id → its rows, read through the existing
 *  repository (so it works the same in local mode and against the API, where each read is gated by its own policy).
 *  Lookups used only to turn ids into names (states, people) degrade to blanks when the reader cannot see them; the
 *  source's own records never do. */

type Fetcher = (repo: Repository) => Promise<DataRow[]>

const lookup = async <T,>(read: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await read() } catch { return fallback }
}

async function stateNames(repo: Repository): Promise<Map<number, string>> {
  const states = await lookup(() => repo.listStates(), [])
  return new Map(states.map((s) => [s.code, s.name]))
}

async function people(repo: Repository): Promise<PeopleNames> {
  const [sales, delivery] = await Promise.all([lookup(() => repo.listSalesPersons(), []), lookup(() => repo.listDeliveryTeamMembers(), [])])
  const names = new Map<string, string>([...sales, ...delivery].map((p) => [p.id, p.name]))
  return { get: (id) => (id ? names.get(id) : undefined) }
}

const opportunities = (sheet: (typeof OPPORTUNITY_SHEET_OF)[string]): Fetcher => async (repo) => {
  const [grid, opps, states, names] = await Promise.all([repo.listBidsForGrid(), repo.listOpportunities(), stateNames(repo), people(repo)])
  return opportunityRows(grid, opps, states, names, sheet)
}

export const DATASET_FETCHERS: Readonly<Record<string, Fetcher>> = {
  ...Object.fromEntries(Object.entries(OPPORTUNITY_SHEET_OF).map(([id, sheet]) => [id, opportunities(sheet)])),
  bidMilestones: async (repo) => milestoneRows(await repo.listAllBidMilestones()),
  bidCorrigenda: async (repo) => corrigendumRows(await repo.listInsightCorrigenda()),
  competitors: async (repo) => competitorRows(await repo.listCompetitors()),
  commercialBoqs: async (repo) => { const [boqs, names] = await Promise.all([repo.listBoqs(), people(repo)]); return boqRows(boqs, names) },
  commercialSkus: async (repo) => skuRows(await repo.listSkus()),
  employees: async (repo) => employeeRows(await repo.listOrgPeople()),
  salesPersons: async (repo) => { const [persons, postings] = await Promise.all([repo.listSalesPersons(), repo.currentPostings()]); return salesPersonRows(persons, postings) },
  contacts: async (repo) => { const [employees, depts] = await Promise.all([repo.listAllEmployees(), lookup(() => repo.listEmployeeDepartments(), {})]); return contactRows(employees, depts) },
  departments: async (repo) => { const [nodes, states] = await Promise.all([repo.listDepartments(), stateNames(repo)]); return departmentRows(nodes, states) },
  customers: async (repo) => customerRows(await repo.listCustomers()),
  geography: async (repo) => geographyRows(await repo.listStates()),
  meetings: async (repo) => { const [events, contacts] = await Promise.all([repo.listAllTimelineEvents(), lookup(() => repo.listAllEmployees(), [])]); return meetingRows(events, contacts) },
  followUps: async (repo) => { const [items, names] = await Promise.all([repo.listOpenFollowUps(), people(repo)]); return followUpRows(items, names) },
  makerDocuments: async (repo) => makerRows(await repo.listMakerDocuments()),
  tenderWebsites: async (repo) => { const [tender, verification] = await Promise.all([repo.listTenderWebsites('tender'), repo.listTenderWebsites('verification')]); return tenderWebsiteRows([...tender, ...verification]) },
}
