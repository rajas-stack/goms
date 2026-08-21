// src/data/repository.ts
//
// Public entry point — unchanged import path (`@/data/repository`) for every
// existing call site. The interface and implementation both live in
// `./in-memory/repository` (in-memory/IndexedDB-backed; the Supabase-backed
// data layer was reverted).

export type {
  Repository, StateSummary, InteractionSummary, RelationshipAnalytics,
  CreateNodeInput, CreateEmployeeInput, AddTimelineInput, ImportChildRow, ImportEmployeeRow,
  MergeableField, MergeEmployeesInput, TransferInput, CreateOpportunityInput,
  CreateSalesPersonInput, TransferSalesPersonInput, TransferBookOfBusinessInput,
  AssignOwnerInput, CreateFollowUpInput, CreateCustomerInput,
} from './in-memory/repository'

export {
  MERGEABLE_FIELDS, bootstrapRepository, resetLocalData, getFullSnapshot, restoreFromBackup, isoToday,
} from './in-memory/repository'

export { repository } from './in-memory/repository'
