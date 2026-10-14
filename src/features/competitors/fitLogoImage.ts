/** Auto-fits an uploaded raster logo so nobody has to crop or resize it by hand:
 *  trims the blank (transparent or flat-colour) margin around the mark, adds a
 *  small even padding, and scales it down to fit LOGO_MAX_EDGE. Aspect ratio is
 *  always kept, so wide wordmarks stay wide and square marks stay square. */

export const LOGO_MAX_EDGE = 512
const PADDING_RATIO = 0.04
/** Per-channel difference still counted as "background" (JPEG noise, soft edges). */
const COLOUR_TOLERANCE = 24
const TRANSPARENT_ALPHA = 12

interface Box { left: number; top: number; right: number; bottom: number }

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read that image.'))
    image.src = dataUrl
  })
}

function sameColour(data: Uint8ClampedArray, i: number, bg: readonly number[]): boolean {
  if (bg[3] < TRANSPARENT_ALPHA) return data[i + 3] < TRANSPARENT_ALPHA
  return data[i + 3] >= 255 - COLOUR_TOLERANCE
    && Math.abs(data[i] - bg[0]) <= COLOUR_TOLERANCE
    && Math.abs(data[i + 1] - bg[1]) <= COLOUR_TOLERANCE
    && Math.abs(data[i + 2] - bg[2]) <= COLOUR_TOLERANCE
}

/** The background is the top-left corner's colour when all four corners agree; otherwise there is none to trim. */
function backgroundOf(data: Uint8ClampedArray, width: number, height: number): number[] | null {
  const at = (x: number, y: number) => (y * width + x) * 4
  const first = at(0, 0)
  const bg = [data[first], data[first + 1], data[first + 2], data[first + 3]]
  const corners = [at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)]
  return corners.every(i => sameColour(data, i, bg)) ? bg : null
}

/** Exported for tests: the tight box around everything that is not background, or null for a blank image. */
export function contentBox(data: Uint8ClampedArray, width: number, height: number): Box | null {
  const bg = backgroundOf(data, width, height)
  if (!bg) return { left: 0, top: 0, right: width - 1, bottom: height - 1 }
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (sameColour(data, (y * width + x) * 4, bg)) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

/** Returns a fitted data: URL, or the original when the browser cannot draw (e.g. tests, very old engines). */
export async function fitLogoImage(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl)
  const source = document.createElement('canvas')
  source.width = image.naturalWidth
  source.height = image.naturalHeight
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })
  if (!sourceCtx || !source.width || !source.height) return dataUrl
  sourceCtx.drawImage(image, 0, 0)
  const { data } = sourceCtx.getImageData(0, 0, source.width, source.height)
  const box = contentBox(data, source.width, source.height)
  if (!box) throw new Error('That image looks blank. Upload the logo itself.')

  const cropW = box.right - box.left + 1
  const cropH = box.bottom - box.top + 1
  const pad = Math.round(Math.max(cropW, cropH) * PADDING_RATIO)
  const scale = Math.min(1, LOGO_MAX_EDGE / (Math.max(cropW, cropH) + pad * 2))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round((cropW + pad * 2) * scale))
  out.height = Math.max(1, Math.round((cropH + pad * 2) * scale))
  const ctx = out.getContext('2d')
  if (!ctx) return dataUrl
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, box.left, box.top, cropW, cropH, pad * scale, pad * scale, cropW * scale, cropH * scale)
  const webp = out.toDataURL('image/webp', 0.92)
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png')
}
