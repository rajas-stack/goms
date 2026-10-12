// A dedicated tRPC client for this module, not routed through
// `Repository`/`RemoteRepository` — Admin Data Import is orthogonal to the
// app's core domain abstraction (it manages bulk loads across many domains
// at once, not one entity type), matching how `commercial-calculator` is
// its own self-contained module rather than folded into `Repository`.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/auth'
import type { AppRouter } from '../../../apps/api/src/index'
import type { ImportAction, ImportDomainKey, ImportRowResult, ImportSummary } from '../../../apps/api/src/import/types'

const adminImportClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc`,
      // Reads the *current* ID token on every request rather than caching
      // one at module-load time — getIdToken() transparently refreshes an
      // expired token, and there is no signed-in user at all until
      // AdminImportAuthGate's onAuthStateChanged fires.
      headers: () => authApi.getAuthorizationHeaders(),
      fetch: authApi.fetch,
    }),
  ],
}).adminImport

export type SpreadsheetDomainKey = Exclude<ImportDomainKey, 'geography'>
export type ImportRow = Record<string, unknown>
export type ImportRows = ImportRow[] | Record<string, ImportRow[]>
export type ImportPreview = ImportRowResult[] | Record<string, ImportRowResult[]>

export interface SessionDomainPreview {
  domain: SpreadsheetDomainKey
  preview: ImportPreview
}

export interface SessionValidateOutput {
  domainOrder: SpreadsheetDomainKey[]
  previews: SessionDomainPreview[]
  summary: ImportSummary
  sessionCommitToken: string
}

export interface ExcludedRow {
  domain: SpreadsheetDomainKey
  rowNumber: number
  /** Human-readable sheet label, kept for display only. */
  sheet?: string
  /** The multi-sheet domain's internal key ('persons', 'verticals', ...) —
   *  what the server (Task 7's `runSessionCommit`/`applyExclusions`) actually
   *  matches on to find and remove the row. Undefined for a single-array
   *  domain. Sent to the backend as-is; its own `ExcludedRow` (Task 6)
   *  carries the identical field for the identical reason. */
  sheetKey?: string
  businessKey: string
  reason: string
}

export interface SessionCommitOutput {
  sessionId: string
  summary: ImportSummary
}

export const adminImportApi = {
  listDomains: () => adminImportClient.listDomains.query(),
  validateSession: (input: { domains: Partial<Record<SpreadsheetDomainKey, ImportRows>> }) =>
    adminImportClient.session.validate.mutate(input),
  commitSession: (input: { domains: Partial<Record<SpreadsheetDomainKey, ImportRows>>; sessionCommitToken: string; excludedRows: ExcludedRow[] }) =>
    adminImportClient.session.commit.mutate(input),
  sessionHistory: (sessionId: string) => adminImportClient.session.history.query({ sessionId }),
  previewGeographyLoad: () => adminImportClient.previewGeographyLoad.mutate(),
  commitGeographyLoad: (input: { commitToken: string }) => adminImportClient.commitGeographyLoad.mutate(input),
}

export type { ImportAction, ImportDomainKey, ImportRowResult, ImportSummary }

export type DependencyStatus = 'ready' | { blockedOn: ImportDomainKey[] }

export interface DomainListEntry {
  domain: ImportDomainKey
  label: string
  currentRowCount: number
  dependencyStatus: DependencyStatus
}

/** Flattens one domain's own preview shape (flat array, or a `{sheetKey:
 *  rows[]}` dict for a multi-sheet domain) into one row list. `sheet` is
 *  kept human-readable for display exactly like the old single-domain
 *  wizard did (falling back to the raw internal key only when an adapter
 *  didn't set its own `.sheet` label, e.g. commercialMastersCatalog/Flat).
 *  `sheetKey` is a SEPARATE field carrying the raw internal key
 *  unconditionally (never the human label) — Task 22's exclusion flow needs
 *  an unambiguous key to route a "remove this row" instruction back to the
 *  right array, and `sheet` alone isn't reliably that (salesRoster sets a
 *  human title on `.sheet`; catalog/flat don't set it at all). */
function flattenPreview(preview: ImportPreview): (ImportRowResult & { sheetKey?: string })[] {
  if (Array.isArray(preview)) return preview
  return Object.entries(preview).flatMap(([sheetKey, rows]) => rows.map((r) => ({ ...r, sheet: r.sheet ?? sheetKey, sheetKey })))
}

/** Flattens every domain's preview in a session into one combined row list,
 *  additionally tagging each row with which domain it belongs to — a
 *  session covers several domains at once, unlike the old per-domain
 *  wizard's flattenPreview, which only ever needed to distinguish sheets
 *  within one domain. */
export function flattenSessionPreview(previews: SessionDomainPreview[]): (ImportRowResult & { domain: SpreadsheetDomainKey; sheetKey?: string })[] {
  return previews.flatMap(({ domain, preview }) => flattenPreview(preview).map((r) => ({ ...r, domain })))
}

const qk = {
  domains: ['adminImport', 'domains'] as const,
}

export const useAdminImportDomains = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: qk.domains,
    queryFn: () => adminImportApi.listDomains() as Promise<DomainListEntry[]>,
    enabled: options?.enabled,
  })

export function useValidateSession() {
  return useMutation({
    mutationFn: (input: { domains: Partial<Record<SpreadsheetDomainKey, ImportRows>> }) =>
      adminImportApi.validateSession(input) as Promise<SessionValidateOutput>,
  })
}

export function useCommitSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { domains: Partial<Record<SpreadsheetDomainKey, ImportRows>>; sessionCommitToken: string; excludedRows: ExcludedRow[] }) =>
      adminImportApi.commitSession(input) as Promise<SessionCommitOutput>,
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
