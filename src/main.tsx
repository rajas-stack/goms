// MUST stay the first import: strips a one-time `?auth_code=` before ./app/router creates the browser router (OAuth provider only).
import './lib/auth/earlyHandoff'
import { StrictMode } from 'react'
import { MotionConfig } from 'framer-motion'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './app/router'
import { bootstrapRepository } from './data/repository'
import { notifyOtherTabs, onOtherTabChange } from './data/crossTabSync'
import { watchServerChanges } from './data/remote/liveUpdates'
import { AuthPromptDialog } from './components/AuthPromptDialog'
import { authApi } from './lib/auth'
import { installStaleChunkRecovery } from './lib/staleChunkRecovery'
import { ProfileImagesProvider } from './features/dms/ProfileImagesProvider'
import './index.css'

const remoteMode = Boolean(import.meta.env.VITE_API_BASE_URL)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
  // Server mode: the write is already in Postgres, so this browser's other tabs
  // just refetch. Browser-only mode notifies from persist.ts instead, once the
  // snapshot is on disk — a tab told any earlier would re-read its stale copy.
  mutationCache: new MutationCache({ onSuccess: () => { if (remoteMode) notifyOtherTabs() } }),
})
const refreshEveryScreen = () => void queryClient.invalidateQueries()

installStaleChunkRecovery()

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Animations follow the OS 'reduce motion' setting everywhere (Apple HIG). */}
        <ProfileImagesProvider><MotionConfig reducedMotion="user"><RouterProvider router={router} /></MotionConfig></ProfileImagesProvider>
        <AuthPromptDialog />
      </QueryClientProvider>
    </StrictMode>,
  )
}

// Auth bootstrap (a no-op for the Firebase provider). A one-time `?auth_code=` was
// already stripped (and stashed for this call) by ./lib/auth/earlyHandoff, before
// the router existed; not awaited, because token reads wait for the in-flight
// redeem themselves.
void authApi.bootstrap()

// Restore the locally persisted store BEFORE the first render: every read hits
// the in-memory data directly, so hydrating afterwards would race the first
// queries and show seed data that then silently swaps underneath the user.
// `bootstrapRepository` never rejects — if IndexedDB is unavailable it resolves
// having changed nothing, and the app runs on seed data as it always did.
//
// Skipped entirely when VITE_API_BASE_URL is set (opt-in remote mode, via an
// untracked .env.local — see repository.ts): `RemoteRepository` has no local
// cache to hydrate, so bootstrapping the in-memory store would just be a
// wasted IndexedDB open/read on every load. See the 2026-08-26 cutover
// readiness report §2.
if (remoteMode) {
  onOtherTabChange(refreshEveryScreen)
  // Other people's saves (and this browser's other tabs', again) arrive from the API.
  watchServerChanges(refreshEveryScreen)
  render()
} else {
  void bootstrapRepository(refreshEveryScreen).then(render)
}
