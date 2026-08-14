import { describe, expect, it } from 'vitest'
import { nextRetryDelay } from './persist'

describe('nextRetryDelay', () => {
  it('returns an increasing backoff for the first three attempts', () => {
    expect(nextRetryDelay(0)).toBe(1000)
    expect(nextRetryDelay(1)).toBe(3000)
    expect(nextRetryDelay(2)).toBe(8000)
  })

  it('returns null once the retry bound is reached, so callers stop retrying', () => {
    expect(nextRetryDelay(3)).toBeNull()
    expect(nextRetryDelay(10)).toBeNull()
  })
})
