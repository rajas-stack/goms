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

  it('names the production environment when built against goms-prod (BUG-001 regression)', async () => {
    // The exact base URL the 2026-08-27 hosted production build used. Before
    // this fix the badge was the literal string "Connected to goms-dev", so
    // the hosted production site told operators it was talking to dev.
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-prod.web.app')
    await renderTopBar()

    expect(screen.getByText(/connected to goms-prod/i)).toBeInTheDocument()
    expect(screen.queryByText(/goms-dev/i)).not.toBeInTheDocument()
  })

  it('names the dev environment when built against goms-dev', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-dev.web.app')
    await renderTopBar()

    expect(screen.getByText(/connected to goms-dev/i)).toBeInTheDocument()
  })

  it('falls back to the host for a direct Cloud Run backend, rather than guessing a project', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-api-ckskxj3iza-el.a.run.app')
    await renderTopBar()

    expect(screen.getByText(/connected to goms-api-ckskxj3iza-el\.a\.run\.app/i)).toBeInTheDocument()
  })

  it('uses VITE_API_ENV_LABEL when the URL carries no project name', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-api-ckskxj3iza-el.a.run.app')
    vi.stubEnv('VITE_API_ENV_LABEL', 'goms-dev')
    await renderTopBar()

    expect(screen.getByText(/connected to goms-dev/i)).toBeInTheDocument()
  })

  it('shows no remote-mode badge when VITE_API_BASE_URL is unset (default local mode)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    await renderTopBar()

    expect(screen.queryByText(/connected to/i)).not.toBeInTheDocument()
  })
})
