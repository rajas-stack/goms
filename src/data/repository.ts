// src/data/repository.ts
//
// Public entry point — unchanged import path (`@/data/repository`) for every
// existing call site. The interface and default implementation live in
// `./in-memory/repository` (in-memory/IndexedDB-backed; the Supabase-backed
// data layer was reverted). When `VITE_API_BASE_URL` is set, `repository`
// instead points at `RemoteRepository` (./remote/repository) — additive and
// currently covering only the customer methods; every other call site is
// unaffected since the env var is unset in every build/test today.

import type { Repository } from './in-memory/repository'
import { repository as inMemoryRepository } from './in-memory/repository'
import { RemoteRepository } from './remote/repository'

export type {
  Repository, StateSummary, InteractionSummary, RelationshipAnalytics,
  CreateNodeInput, CreateEmployeeInput, AddTimelineInput, ImportChildRow, ImportEmployeeRow,
  MergeableField, MergeEmployeesInput, TransferInput, CreateOpportunityInput,
  CreateSalesPersonInput, TransferSalesPersonInput, TransferBookOfBusinessInput,
  AssignOwnerInput, CreateFollowUpInput, CreateCustomerInput, CreateDeliveryTeamMemberInput,
  UpdateDeliveryTeamMemberPatch, CreateOrgPersonInput, UpdateOrgPersonPatch, SetRoleOverrideInput,
} from './in-memory/repository'

export {
  MERGEABLE_FIELDS, bootstrapRepository, resetLocalData, getFullSnapshot, restoreFromBackup, isoToday,
} from './in-memory/repository'

export const repository: Repository = import.meta.env.VITE_API_BASE_URL
  ? (new RemoteRepository() as unknown as Repository)
  : inMemoryRepository
