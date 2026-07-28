import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './app/router'
import { bootstrapRepository } from './data/repository'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
})

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

// Restore the locally persisted store BEFORE the first render: every read hits
// the in-memory data directly, so hydrating afterwards would race the first
// queries and show seed data that then silently swaps underneath the user.
// `bootstrapRepository` never rejects — if IndexedDB is unavailable it resolves
// having changed nothing, and the app runs on seed data as it always did.
void bootstrapRepository().then(render)
