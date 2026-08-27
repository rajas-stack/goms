import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// `isRemoteMode` (SettingsDialog.tsx) and `repository` (data/repository.ts,
// imported transitively) both read `import.meta.env.VITE_API_BASE_URL` at
// module-load time, not inside a component — so each mode under test needs
// a fresh module graph via `vi.resetModules()` + a dynamic `import()` after
// `vi.stubEnv`, not just a re-render with a different env value.
async function renderSettingsDialog() {
  const { SettingsDialog } = await import('./SettingsDialog')
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <SettingsDialog open onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('SettingsDialog remote-mode gating', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides local Backup/Restore controls and explains server-side backups when VITE_API_BASE_URL is set', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-api.example.com')
    await renderSettingsDialog()

    expect(screen.queryByText(/export full backup/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/restore from backup/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export full backup/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /choose backup file/i })).not.toBeInTheDocument()
    expect(
      screen.getByText(/aren't available while connected to a remote backend/i),
    ).toBeInTheDocument()
  })

  it('keeps local Backup/Restore fully available when VITE_API_BASE_URL is unset', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    await renderSettingsDialog()

    expect(screen.getByRole('button', { name: /export full backup/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose backup file/i })).toBeInTheDocument()
    expect(
      screen.queryByText(/aren't available while connected to a remote backend/i),
    ).not.toBeInTheDocument()
  })
})
