import { beforeEach, describe, expect, it, vi } from 'vitest'

// End to end through the REAL native.ts deep-link handling, the REAL bootstrapNativeAuth and the REAL authPrompt: only the Capacitor
// plugins are faked. Proves R19 - a warm error link / failed redeem reaches an already-mounted (subscribed) dialog.
const { cap } = vi.hoisted(() => ({
  cap: { listener: null as null | ((e: { url: string }) => void), launchUrl: null as null | { url: string } },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(), close: vi.fn(async () => {}) } }))
vi.mock('@capacitor/app', () => ({
  App: { addListener: async (_e: string, cb: (e: { url: string }) => void) => { cap.listener = cb; return { remove: async () => {} } }, getLaunchUrl: async () => cap.launchUrl },
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }))
vi.mock('@/lib/nativeShell', () => ({ hasCapability: () => true }))

const SCHEME = 'com.gorms.app'
const CODE = 'R'.repeat(43)
const link = (q: string) => `${SCHEME}://auth?${q}`

async function setup(over: Record<string, unknown> = {}) {
  vi.resetModules()
  const prompt = await import('@/lib/authPrompt')
  const { bootstrapNativeAuth } = await import('./bootstrap')
  const session = { redeem: vi.fn(async () => {}), init: vi.fn(async () => {}), trackHandoff: vi.fn(), isSignedIn: vi.fn(() => false), ...over }
  return { prompt, bootstrapNativeAuth, session }
}
/** Lets the async deep-link handler (Browser.close -> handler -> redeem) run to completion. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(() => { cap.listener = null; cap.launchUrl = null })

describe('warm path: a deep link delivered to an already-mounted (subscribed) dialog', () => {
  it.each([['domain', 'forbidden'], ['unverified', 'forbidden'], ['state', 'unauthorized'], ['google', 'unauthorized'], ['denied', 'unauthorized']] as const)(
    '?error=%s raises %s to the subscriber immediately',
    async (error, reason) => {
      const { prompt, bootstrapNativeAuth, session } = await setup()
      await bootstrapNativeAuth(session, SCHEME)
      const listener = vi.fn()
      prompt.subscribeAuthRequired(listener)
      cap.listener!({ url: link(`error=${error}`) })
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(reason))
      expect(listener).toHaveBeenCalledTimes(1)
    },
  )
  it('with NO subscriber the reason is stored pending and delivered once to the next subscriber', async () => {
    const { prompt, bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    cap.listener!({ url: link('error=domain') })
    await flush()
    const first = vi.fn(); const second = vi.fn()
    prompt.subscribeAuthRequired(first)
    await flush()
    prompt.subscribeAuthRequired(second)
    await flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith('forbidden')
    expect(second).not.toHaveBeenCalled()
  })
  it('an identical ?error link delivered twice surfaces twice (only codes are deduped)', async () => {
    const { prompt, bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn()
    prompt.subscribeAuthRequired(listener)
    cap.listener!({ url: link('error=state') })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    cap.listener!({ url: link('error=state') })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
  })
  it('an identical code link delivered twice is redeemed once', async () => {
    const { bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    cap.listener!({ url: link(`code=${CODE}`) })
    cap.listener!({ url: link(`code=${CODE}`) })
    await flush()
    expect(session.redeem).toHaveBeenCalledTimes(1)
    expect(session.redeem).toHaveBeenCalledWith(CODE, 'app')
  })
  it('a rejected redeem (expired/used code, network, keystore) raises "unauthorized" to the subscriber', async () => {
    const { prompt, bootstrapNativeAuth, session } = await setup({ redeem: vi.fn(async () => { throw new Error('expired') }) })
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn()
    prompt.subscribeAuthRequired(listener)
    cap.listener!({ url: link(`code=${CODE}`) })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('unauthorized'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('a successful redeem raises nothing', async () => {
    const { prompt, bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn()
    prompt.subscribeAuthRequired(listener)
    cap.listener!({ url: link(`code=${CODE}`) })
    await flush()
    expect(session.redeem).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('cold path: the link that launched the app', () => {
  it('a rejected redeem raises "unauthorized" (pending until the dialog mounts) and startup still restores the session', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { prompt, bootstrapNativeAuth, session } = await setup({ redeem: vi.fn(async () => { throw new Error('used') }) })
    await expect(bootstrapNativeAuth(session, SCHEME)).resolves.toBeUndefined()
    expect(session.init).toHaveBeenCalledTimes(1)
    const listener = vi.fn()
    prompt.subscribeAuthRequired(listener)
    await flush()
    expect(listener).toHaveBeenCalledWith('unauthorized')
  })
  it('a launch ?error link is stored pending for the dialog that mounts later', async () => {
    cap.launchUrl = { url: link('error=unverified') }
    const { prompt, bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn()
    prompt.subscribeAuthRequired(listener)
    await flush()
    expect(listener).toHaveBeenCalledWith('forbidden')
  })
  it('a launch link re-delivered as a warm link redeems once', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { bootstrapNativeAuth, session } = await setup()
    await bootstrapNativeAuth(session, SCHEME)
    cap.listener!({ url: link(`code=${CODE}`) })
    await flush()
    expect(session.redeem).toHaveBeenCalledTimes(1)
  })
})

describe('R15 extended to the app redeem', () => {
  it('registers the very redeem promise with trackHandoff (after the whole-startup promise, I7), and the cold-start restore waits for it', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const p = gate.then(() => {})
    const { bootstrapNativeAuth, session } = await setup({ redeem: vi.fn(() => p) })
    const boot = bootstrapNativeAuth(session, SCHEME)
    expect(session.trackHandoff).toHaveBeenCalledTimes(1) // the whole startup, registered synchronously (I7)
    await vi.waitFor(() => expect(session.trackHandoff).toHaveBeenCalledTimes(2)) // then the redeem itself (native.ts is a lazy dynamic import)
    await flush()
    expect(session.trackHandoff.mock.calls[1][0]).toBe(p)
    expect(session.init).not.toHaveBeenCalled() // parked behind the redeem
    release()
    await boot
    expect(session.init).toHaveBeenCalledTimes(1)
  })
})

describe('the exchange code is never logged', () => {
  it('neither a failed warm redeem nor a failed cold redeem puts the code in any console output', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const boom = vi.fn(async (c: string) => { throw new Error(`exchange failed for ${c}`) })
    cap.launchUrl = { url: link(`code=${'L'.repeat(43)}`) }
    const { bootstrapNativeAuth, session } = await setup({ redeem: boom })
    await bootstrapNativeAuth(session, SCHEME)
    cap.listener!({ url: link(`code=${CODE}`) })
    await flush()
    expect(boom).toHaveBeenCalledTimes(2) // both failures really happened
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((c) => c.map(String))))
    expect(logged).not.toContain(CODE)
    expect(logged).not.toContain('L'.repeat(43))
    expect(logged).not.toContain('exchange failed')
    spies.forEach((s) => s.mockRestore())
  })
})
