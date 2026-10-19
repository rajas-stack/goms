/** Matching sales people to photo files by name ("Ashish Desai.jpg", "ashish_desai.png", "Desai Ashish.jpeg"). */
export const IMAGE_FILE = /\.(jpe?g|png|webp|gif|heic)$/i

const tokens = (value: string) => value.replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().replace(/[^a-z\s]+/g, ' ').split(/\s+/).filter(t => t.length > 1)

/** Best file for a person: all name words present in the file name (any order), else first + last name. */
export function matchPhoto<F extends { id: string; name: string }>(personName: string, files: F[]): F | undefined {
  const want = tokens(personName)
  if (!want.length) return undefined
  const scored = files.map(file => {
    const have = new Set(tokens(file.name))
    const all = want.every(t => have.has(t))
    const ends = have.has(want[0]) && have.has(want[want.length - 1])
    return { file, score: all ? 2 : ends && want.length > 1 ? 1 : 0, extra: have.size - want.length }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.extra - b.extra)
  // Ambiguous: two equally good files — leave it for the person to choose.
  if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].extra === scored[1].extra) return undefined
  return scored[0]?.file
}

/** Folder id from a Drive folder link or a bare id. */
export function driveFolderId(input: string): string {
  const m = /\/folders\/([\w-]{10,})/.exec(input) ?? /[?&]id=([\w-]{10,})/.exec(input)
  return m ? m[1] : input.trim()
}

/** Square-cropped, 256 px WebP (PNG fallback) data URL — the photo_url convention (no asset store). */
export async function toAvatarDataUrl(blob: Blob, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, Math.max(0, (bitmap.height - side) / 3), side, side, 0, 0, size, size)
  const webp = canvas.toDataURL('image/webp', 0.88)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}
