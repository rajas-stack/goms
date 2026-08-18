// src/data/repository.ts
//
// Public entry point — unchanged import path (`@/data/repository`) for every
// existing call site. The interface and in-memory implementation now live in
// `./in-memory/repository`; `repository-select.ts` composes the exported
// `repository` singleton from it plus any migrated domain's Supabase
// implementation. See architecture spec §6.

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

export { repository } from './repository-select'
