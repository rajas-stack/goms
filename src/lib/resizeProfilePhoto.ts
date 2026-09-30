/** Profile photos are stored inline as data URLs and returned in full by every
 *  roster/directory list query, so their size is paid on every page load.
 *  Uploaded/pasted images are therefore normalised here before they reach the
 *  form: aspect ratio preserved (never cropped, never upscaled), longest side
 *  capped at MAX_DIMENSION, re-encoded as JPEG. 512px keeps faces and detail
 *  clearly identifiable — the point is bounding the payload, not shrinking it
 *  as far as possible. */
export const MAX_DIMENSION = 512
const START_QUALITY = 0.85
const MIN_QUALITY = 0.7
const QUALITY_STEP = 0.05
/** Soft target: quality is only lowered (never dimensions) if the first
 *  encode is larger than this. In data-URL characters, ≈ 300 KB of JPEG. */
const TARGET_DATA_URL_LENGTH = 400_000
/** Hard limit for the no-decode fallback below. Mirrors
 *  apps/api/src/photoUrl.ts's MAX_PHOTO_URL_LENGTH — the server rejects
 *  anything longer. */
export const MAX_PHOTO_URL_LENGTH = 700_000

export function fitWithin(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image file.'))
    reader.readAsDataURL(file)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/jpeg', quality)
  })
}

/** Resolves to a JPEG data URL no larger than MAX_DIMENSION on its longest
 *  side. If the browser can't decode the file (no createImageBitmap, or a
 *  format like HEIC it doesn't support), the original is kept only when it is
 *  already within the server's size cap; otherwise this rejects so the caller
 *  can tell the user, instead of uploading something the API will refuse. */
export async function resizeProfilePhoto(file: Blob): Promise<string> {
  let bitmap: ImageBitmap | null = null
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies EXIF rotation, so phone photos aren't sideways.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = null
    }
  }

  if (!bitmap) {
    const original = await readAsDataUrl(file)
    if (original.length > MAX_PHOTO_URL_LENGTH) {
      throw new Error('This image format can’t be resized in your browser and the file is too large. Try a JPEG or PNG.')
    }
    return original
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process the image.')
    // JPEG has no alpha: without this, transparent PNG regions turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    let quality = START_QUALITY
    let dataUrl = await readAsDataUrl(await canvasToBlob(canvas, quality))
    while (dataUrl.length > TARGET_DATA_URL_LENGTH && quality - QUALITY_STEP >= MIN_QUALITY - 1e-9) {
      quality -= QUALITY_STEP
      dataUrl = await readAsDataUrl(await canvasToBlob(canvas, quality))
    }
    return dataUrl
  } finally {
    bitmap.close()
  }
}
