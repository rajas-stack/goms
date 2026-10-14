import { COMPETITOR_LIMITS, COMPETITOR_LOGO_TYPES, logoDataUrlBytes } from '@goms/domain'
import { fitLogoImage } from './fitLogoImage'

export const LOGO_ACCEPT = COMPETITOR_LOGO_TYPES.join(',')
/** Raw uploads may be big (a photo or a print-quality logo); they are shrunk before saving. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that image.')))
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

/** Reads an uploaded logo into a data: URL. Raster images are trimmed and resized
 *  automatically (see fitLogoImage); SVGs scale on their own and are kept as-is. */
export async function readLogoFile(file: File): Promise<string> {
  if (!(COMPETITOR_LOGO_TYPES as readonly string[]).includes(file.type)) throw new Error('Upload the logo as a PNG, JPG, SVG or WebP image.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 10 MB. Upload a smaller copy of the logo.')
  const raw = await readAsDataUrl(file)
  const fitted = file.type === 'image/svg+xml' ? raw : await fitLogoImage(raw)
  if ((logoDataUrlBytes(fitted) ?? file.size) > COMPETITOR_LIMITS.logoBytes) {
    throw new Error(file.type === 'image/svg+xml' ? 'Keep the SVG logo under 256 KB.' : 'Could not shrink that logo under 256 KB. Try a simpler image.')
  }
  return fitted
}
