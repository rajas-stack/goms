import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMeetingDraft } from './useMeetingDraft'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('writes immediately without waiting for a debounce and preserves the latest input on pagehide', () => {
  const { result, rerender } = renderHook(({ text }) => useMeetingDraft('local:test', { text }, true), { initialProps: { text: '' } })
  act(() => { result.current.take({ text: '' }) })
  rerender({ text: 'Last keystroke' })
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(JSON.parse(localStorage.getItem('gorms:meeting-draft:local:test')!).value.text).toBe('Last keystroke')
})

it('removes successfully saved drafts without recreating them during unmount', () => {
  const { result, rerender, unmount } = renderHook(({ text }) => useMeetingDraft('local:test', { text }, true), { initialProps: { text: '' } })
  act(() => { result.current.take({ text: '' }) })
  rerender({ text: 'Saved meeting' })
  act(() => result.current.clear())
  unmount()
  expect(localStorage.getItem('gorms:meeting-draft:local:test')).toBeNull()
})

it('rejects corrupted or expired drafts safely', () => {
  const { result } = renderHook(() => useMeetingDraft('local:test', { text: '' }, true))
  for (const raw of ['{broken', JSON.stringify({ savedAt: Date.now(), value: { text: 123 } }), JSON.stringify({ savedAt: 0, value: { text: 'Expired' } })]) {
    localStorage.setItem('gorms:meeting-draft:local:test', raw)
    act(() => { expect(result.current.take({ text: '' })).toBeNull() })
  }
})

it('reports storage failures instead of claiming the draft is saved', () => {
  const { result, rerender } = renderHook(({ text }) => useMeetingDraft('local:test', { text }, true), { initialProps: { text: '' } })
  act(() => { result.current.take({ text: '' }) })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  rerender({ text: 'Keep me' })
  expect(result.current.error).toBe(true)
})

it('does not copy one account draft into another account when the key changes', () => {
  const { result, rerender } = renderHook(({ key, text }) => useMeetingDraft(key, { text }, true), { initialProps: { key: 'account-a:new', text: '' } })
  act(() => { result.current.take({ text: '' }) })
  rerender({ key: 'account-a:new', text: 'Private account A meeting' })
  rerender({ key: 'account-b:new', text: 'Private account A meeting' })
  expect(localStorage.getItem('gorms:meeting-draft:account-b:new')).toBeNull()
  expect(JSON.parse(localStorage.getItem('gorms:meeting-draft:account-a:new')!).value.text).toBe('Private account A meeting')
})
