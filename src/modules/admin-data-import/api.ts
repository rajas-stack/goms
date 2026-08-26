// A dedicated tRPC client for this module, not routed through
// `Repository`/`RemoteRepository` — Admin Data Import is orthogonal to the
// app's core domain abstraction (it manages bulk loads across many domains
// at once, not one entity type), matching how `commercial-calculator` is
// its own self-contained module rather than folded into `Repository`.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'

export const adminImportClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc` })],
}).adminImport
