import { z } from 'zod'

/** Second safety layer behind the client-side resize in
 *  src/components/ui/PhotoUploadField.tsx. Photos are stored inline as data
 *  URLs and returned in full by every list query (sales.listPersons,
 *  employees.listAll), so one unbounded upload inflates every roster load —
 *  a 33 MB sales.listPersons response was traced to exactly this.
 *
 *  The client targets ~200–300 KB of JPEG (≈270–400K base64 chars); this cap
 *  sits well above that so a legitimate resized photo never trips it, while
 *  still rejecting a raw multi-MB phone photo. Length is in characters of the
 *  data URL string, base64 included. */
export const MAX_PHOTO_URL_LENGTH = 700_000

export const photoUrlSchema = z
  .string()
  .max(MAX_PHOTO_URL_LENGTH, 'Photo is too large — upload a smaller image.')
  .nullable()
  .optional()
