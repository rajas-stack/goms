import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// main.tsx's bootstrap-vs-render-immediately branch is a module-level side
// effect that runs the instant the module is imported — so this test
// intercepts the two things that branch drives (`bootstrapRepository` and
// `createRoot(...).render`) rather than rendering the full app, and mocks
// `./app/router` so importing main.tsx doesn't pull in every route's real
// component tree just to assert which of the two functions ran.
const bootstrapRepository = vi.fn(() => Promise.resolve())
const rootRender = vi.fn()
const createRoot = vi.fn(() => ({ render: rootRender }))

vi.mock('./data/repository', () => ({ bootstrapRepository }))
vi.mock('react-dom/client', () => ({ createRoot }))
vi.mock('./app/router', () => ({ router: {} }))

async function importMain() {
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main')
}

describe('main.tsx remote-mode bootstrap gating', () => {
  beforeEach(() => {
    vi.resetModules()
    bootstrapRepository.mockClear()
    createRoot.mockClear()
    rootRender.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips local IndexedDB bootstrap and renders immediately when VITE_API_BASE_URL is set', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms-api.example.com')
    await importMain()

    expect(bootstrapRepository).not.toHaveBeenCalled()
    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(rootRender).toHaveBeenCalledTimes(1)
  })

  it('bootstraps local IndexedDB before rendering when VITE_API_BASE_URL is unset (default local mode)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    await importMain()
    // main.tsx's local-mode branch is `bootstrapRepository().then(render)` —
    // give that promise chain a tick to resolve before asserting on it.
    await Promise.resolve()
    await Promise.resolve()

    expect(bootstrapRepository).toHaveBeenCalledTimes(1)
    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(rootRender).toHaveBeenCalledTimes(1)
  })
})
