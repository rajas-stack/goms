import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { LinkOnSignIn } from './LinkOnSignIn'
import { sessionName } from './api'

const EMAIL = 'shubham.mehra@amnex.com'
const NAME = sessionName(EMAIL)

/** A fake OpenWA behind the `/openwa` proxy, answering by method + path. */
function gateway(routes: Record<string, () => unknown>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('/openwa/api', '')}`
    calls.push(key)
    const route = routes[key]
    return route ? new Response(JSON.stringify(route()), { status: 200 }) : new Response('down', { status: 502 })
  }))
  return calls
}

const step = (onDone: () => void) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><LinkOnSignIn name={NAME} onDone={onDone} /></ToastProvider>
  </QueryClientProvider>,
)

afterEach(() => vi.unstubAllGlobals())

describe('LinkOnSignIn', () => {
  it('starts a first-time session, shows its QR, and finishes once the phone is linked', async () => {
    let session: object | undefined
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => (session ? [session] : []),
      'POST /sessions': () => (session = { id: 's1', name: NAME, status: 'created' }),
      'POST /sessions/s1/start': () => (session = { id: 's1', name: NAME, status: 'qr_ready' }),
      'GET /sessions/s1/qr': () => ({ qrCode: 'data:image/png;base64,QR', status: 'qr_ready' }),
      'GET /sessions/s1/chats?limit=100': () => [],
    })
    const onDone = vi.fn()
    step(onDone)
    expect(await screen.findByAltText('WhatsApp link code')).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(onDone).not.toHaveBeenCalled()

    session = { id: 's1', name: NAME, status: 'ready', phone: '919800000000' }
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 4_000 })
    expect(calls).toContain('GET /sessions/s1/chats?limit=100')
    expect(await screen.findByText(/WhatsApp linked \(.*\): ready to send and receive messages/)).toBeInTheDocument()
  })

  it('never blocks sign-in when the gateway is down', async () => {
    gateway({})
    const onDone = vi.fn()
    step(onDone)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('reconnects a phone linked before in the background without showing a code', async () => {
    const calls = gateway({
      [`GET /sessions?name=${NAME}`]: () => [{ id: 's1', name: NAME, status: 'disconnected', phone: '919800000000' }],
      'POST /sessions/s1/start': () => ({}),
    })
    const onDone = vi.fn()
    step(onDone)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    await waitFor(() => expect(calls).toContain('POST /sessions/s1/start'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
