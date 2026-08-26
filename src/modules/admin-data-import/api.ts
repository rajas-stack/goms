// A dedicated tRPC client for this module, not routed through
// `Repository`/`RemoteRepository` — Admin Data Import is orthogonal to the
// app's core domain abstraction (it manages bulk loads across many domains
// at once, not one entity type), matching how `commercial-calculator` is
// its own self-contained module rather than folded into `Repository`.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppRouter } from '../../../apps/api/src/index'
import type { ImportDomainKey, ImportRowResult, ImportSummary } from '../../../apps/api/src/import/types'

const adminImportClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc` })],
}).adminImport

// tRPC's vanilla client is a Proxy whose `.query`/`.mutate` terminals only
// exist via a `get` trap — `Object.getOwnPropertyDescriptor` (what
// `vi.spyOn` needs) returns undefined for them, so tests can't spy on
// `adminImportClient.listDomains.query` directly. Wrapping every call in a
// plain object of real, own-property functions makes this module testable
// with ordinary `vi.spyOn(adminImportApi, 'listDomains')`.
export const adminImportApi = {
  listDomains: () => adminImportClient.listDomains.query(),
  validate: (input: { domain: SpreadsheetDomainKey; rows: ImportRows }) => adminImportClient.validate.mutate(input),
  commit: (input: { domain: SpreadsheetDomainKey; commitToken: string; rows: ImportRows }) => adminImportClient.commit.mutate(input),
  previewGeographyLoad: () => adminImportClient.previewGeographyLoad.mutate(),
  commitGeographyLoad: (input: { commitToken: string }) => adminImportClient.commitGeographyLoad.mutate(input),
}

export type { ImportDomainKey, ImportRowResult, ImportSummary }

/** Every domain that goes through the generic spreadsheet validate/commit
 *  pair. Geography is excluded by design — it has no uploaded rows at all
 *  and uses its own previewGeographyLoad/commitGeographyLoad procedures. */
export type SpreadsheetDomainKey = Exclude<ImportDomainKey, 'geography'>

export type DependencyStatus = 'ready' | { blockedOn: ImportDomainKey[] }

export interface DomainListEntry {
  domain: ImportDomainKey
  label: string
  currentRowCount: number
  dependencyStatus: DependencyStatus
}

// Most domains submit/receive a flat row array; the 3 multi-sheet domains
// (commercialMastersFlat, commercialMastersCatalog, salesRoster) submit a
// { sheetKey: rows[] } dictionary instead — matches
// apps/api/src/routers/adminImport.ts's ADAPTERS map exactly.
export type ImportRow = Record<string, unknown>
export type ImportRows = ImportRow[] | Record<string, ImportRow[]>
export type ImportPreview = ImportRowResult[] | Record<string, ImportRowResult[]>

/** Flattens either preview shape into one row list for display, tagging
 *  each row with its sheet name (if not already tagged by the domain
 *  module itself, e.g. Sales Roster/Catalog already set `.sheet`). */
export function flattenPreview(preview: ImportPreview): ImportRowResult[] {
  if (Array.isArray(preview)) return preview
  return Object.entries(preview).flatMap(([sheet, rows]) => rows.map((r) => ({ sheet: r.sheet ?? sheet, ...r })))
}

const qk = {
  domains: ['adminImport', 'domains'] as const,
}

export const useAdminImportDomains = () =>
  useQuery({ queryKey: qk.domains, queryFn: () => adminImportApi.listDomains() as Promise<DomainListEntry[]> })

export function useValidateImport() {
  return useMutation({
    mutationFn: (input: { domain: SpreadsheetDomainKey; rows: ImportRows }) =>
      adminImportApi.validate(input) as Promise<{ preview: ImportPreview; summary: ImportSummary; commitToken: string }>,
  })
}

export function useCommitImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { domain: SpreadsheetDomainKey; commitToken: string; rows: ImportRows }) =>
      adminImportApi.commit(input) as Promise<{ summary: ImportSummary }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  })
}

export function usePreviewGeographyLoad() {
  return useMutation({
    mutationFn: () =>
      adminImportApi.previewGeographyLoad() as Promise<{
        summary: ImportSummary
        reconciliation: { sourceRowCount: number; classifiedRowCount: number; matches: boolean }
        commitToken: string
      }>,
  })
}

export function useCommitGeographyLoad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commitToken: string }) =>
      adminImportApi.commitGeographyLoad(input) as Promise<{ summary: ImportSummary }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  })
}
