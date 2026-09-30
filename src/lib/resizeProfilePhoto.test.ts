import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitWithin, MAX_DIMENSION, MAX_PHOTO_URL_LENGTH, resizeProfilePhoto } from './resizeProfilePhoto'

afterEach(() => vi.unstubAllGlobals())

function stubFileReader(result: string) {
  class FakeFileReader {
    result: string | null = null
    error: Error | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL() {
      this.result = result
      this.onload?.()
    }
  }
  vi.stubGlobal('FileReader', FakeFileReader)
}

describe('fitWithin', () => {
  it('leaves images already inside the limit untouched (never upscales)', () => {
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(MAX_DIMENSION, MAX_DIMENSION)).toEqual({ width: 512, height: 512 })
  })

  it('caps the longest side at 512 and preserves aspect ratio for landscape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 512, height: 384 })
  })

  it('caps the longest side at 512 and preserves aspect ratio for portrait', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 384, height: 512 })
  })

  it('never collapses a very thin image to a zero dimension', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 512, height: 1 })
  })
})

describe('resizeProfilePhoto — when the browser cannot decode', () => {
  it('keeps the original if it is within the server cap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    stubFileReader('data:image/png;base64,SMALL==')
    await expect(resizeProfilePhoto(new Blob(['x']))).resolves.toBe('data:image/png;base64,SMALL==')
  })

  it('keeps the original if createImageBitmap rejects (e.g. HEIC) and it fits the cap', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('unsupported')))
    stubFileReader('data:image/heic;base64,SMALL==')
    await expect(resizeProfilePhoto(new Blob(['x']))).resolves.toBe('data:image/heic;base64,SMALL==')
  })

  it('rejects rather than passing through an original the API would refuse', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    stubFileReader('data:image/jpeg;base64,' + 'A'.repeat(MAX_PHOTO_URL_LENGTH))
    await expect(resizeProfilePhoto(new Blob(['x']))).rejects.toThrow(/too large/)
  })
})
