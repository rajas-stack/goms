import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), headers: vi.fn(), subscribers: new Set<(user: any) => void>(), visible: null as any, url: vi.fn(), revoke: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authApi: { fetch: mock.fetch, subscribe: (fn: any) => { mock.subscribers.add(fn); fn({ email: 'admin@amnex.com' }); return () => mock.subscribers.delete(fn) } } }))
vi.mock('@/data/remote/authHeaders', () => ({ getAuthHeaders: mock.headers }))
import { useProfileImage } from './useProfileImage'

beforeEach(() => {
  mock.fetch.mockReset().mockResolvedValue({ ok: true, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) })
  mock.headers.mockReset().mockResolvedValue({ Authorization: 'Bearer app-session' })
  mock.url.mockReset().mockImplementation(() => `blob:photo-${mock.url.mock.calls.length}`); mock.revoke.mockReset()
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: any) { mock.visible = callback } observe() {} disconnect() {} })
  vi.stubGlobal('URL', class extends URL { static createObjectURL = mock.url; static revokeObjectURL = mock.revoke })
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8088')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); mock.subscribers.clear() })
function mount(version = 'v1') {
  return renderHook(({ current }) => {
    const photo = useProfileImage({ userId: 'user-1', version: current })
    // renderHook has no element to observe; supply a visible DOM target before its effect.
    Object.defineProperty(photo.ref, 'current', { value: document.createElement('span'), writable: true })
    return photo
  }, { initialProps: { current: version } })
}
describe('lazy private profile images', () => {
  it('waits for visibility, sends app authorization only to the backend and uses browser caching', async () => {
    const photo = mount(); expect(mock.fetch).not.toHaveBeenCalled()
    act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(photo.result.current.url).toBe('blob:photo-1'))
    expect(mock.fetch).toHaveBeenCalledWith('http://localhost:8088/api/profile-images/user-1?v=v1', expect.objectContaining({ headers: { Authorization: 'Bearer app-session' }, cache: 'no-cache' }))
    photo.unmount(); expect(mock.revoke).toHaveBeenCalledWith('blob:photo-1')
  })
  it('immediately removes the previous URL on a version/folder change and loads the new photo', async () => {
    const photo = mount(); act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(photo.result.current.url).toBe('blob:photo-1'))
    photo.rerender({ current: 'new-folder-version' }); expect(photo.result.current.url).toBeNull()
    expect(mock.revoke).toHaveBeenCalledWith('blob:photo-1')
    act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(photo.result.current.url).toBe('blob:photo-2'))
  })
  it('clears private photos on account changes and keeps initials after authentication failures', async () => {
    const photo = mount(); act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(photo.result.current.url).toBe('blob:photo-1'))
    act(() => { for (const fn of mock.subscribers) fn(null) })
    expect(photo.result.current.url).toBeNull(); expect(mock.revoke).toHaveBeenCalledWith('blob:photo-1')
    photo.unmount(); mock.fetch.mockResolvedValue({ ok: false, status: 403 })
    const denied = mount(); act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2)); expect(denied.result.current.url).toBeNull()
  })
  it('makes no image request without a matching image or signed-in authorization', async () => {
    renderHook(() => useProfileImage()); expect(mock.fetch).not.toHaveBeenCalled()
    mock.headers.mockResolvedValue({}); mount(); act(() => mock.visible([{ isIntersecting: true }]))
    await waitFor(() => expect(mock.headers).toHaveBeenCalled()); expect(mock.fetch).not.toHaveBeenCalled()
  })
})
