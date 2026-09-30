import { describe, expect, it } from 'vitest'
import { MAX_PHOTO_URL_LENGTH, photoUrlSchema } from './photoUrl.js'

describe('photoUrlSchema', () => {
  it('accepts undefined, null and a normal resized photo', () => {
    expect(photoUrlSchema.safeParse(undefined).success).toBe(true)
    expect(photoUrlSchema.safeParse(null).success).toBe(true)
    // ~300 KB of JPEG as base64 — the client's upper target
    expect(photoUrlSchema.safeParse('data:image/jpeg;base64,' + 'A'.repeat(400_000)).success).toBe(true)
  })

  it('accepts exactly the cap and rejects one character over', () => {
    expect(photoUrlSchema.safeParse('a'.repeat(MAX_PHOTO_URL_LENGTH)).success).toBe(true)
    expect(photoUrlSchema.safeParse('a'.repeat(MAX_PHOTO_URL_LENGTH + 1)).success).toBe(false)
  })

  it('rejects a raw multi-MB phone photo', () => {
    expect(photoUrlSchema.safeParse('data:image/jpeg;base64,' + 'A'.repeat(11_000_000)).success).toBe(false)
  })
})
