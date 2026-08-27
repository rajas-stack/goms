import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `remoteApiBaseUrl` (TopBar.tsx) is read from `import.meta.env.VITE_API_BASE_URL`
// at module-load time, so switching modes needs a fresh module graph — see
// the same pattern in SettingsDialog.test.tsx.
async function renderTopBar() {
  const { TopBar } = await import('./TopBar')
  return render(
    <MemoryRouter>
      <TopBar onOpenDrawer={() => {}} />
    </MemoryRouter>,
  )
}

describe('TopBar remote-mode indicator', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows the "Connected to goms-dev" badge when VITE_API_BASE_URL is set', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-api.example.com')
    await renderTopBar()

    expect(screen.getByText(/connected to goms-dev/i)).toBeInTheDocument()
  })

  it('shows no remote-mode badge when VITE_API_BASE_URL is unset (default local mode)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    await renderTopBar()

    expect(screen.queryByText(/connected to goms-dev/i)).not.toBeInTheDocument()
  })
})
