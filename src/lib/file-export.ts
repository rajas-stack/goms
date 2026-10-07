import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/** Saves `content` as `fileName`, on whichever platform this is running on.
 *  Extracted from csv.ts so other export formats can reuse the exact same
 *  platform branching instead of a second copy of it.
 *
 *  Two entirely different mechanisms depending on platform: a browser tab
 *  has no filesystem access, so the classic `blob:` URL + synthetic
 *  `<a download>` click is the only way to hand the user a file, and it
 *  works well there. Android's WebView is the opposite problem — it has
 *  real filesystem access via `@capacitor/filesystem`, but has no download
 *  manager wired to `blob:` URLs at all, so that same click silently does
 *  nothing (no error, no file, nothing) instead of failing loudly.
 *
 *  On Android this writes to `Directory.External` (the app's own sandboxed
 *  folder under external storage), not `Directory.Documents` (the shared
 *  public Documents folder) — this app's `targetSdkVersion` (36) makes
 *  Android ignore `requestLegacyExternalStorage` outright, so a raw file
 *  write to the public folder fails with `EACCES` regardless of any granted
 *  permission; that's scoped storage, not a permission bug. `Directory.External`
 *  isn't subject to that on any Android version and needs no runtime
 *  permission at all — the trade-off is it's not casually browsable from a
 *  stock file manager, which is exactly why the Share step below matters
 *  here, not just as a convenience. */
export async function downloadFile(fileName: string, content: string, mimeType: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: content, directory: Directory.External, encoding: Encoding.UTF8 })
    // The file is already saved at this point regardless of what happens
    // next — a user backing out of the chooser (or no app registered to
    // handle it) isn't treated as a failure.
    try {
      await Share.share({ files: [uri], dialogTitle: 'Open exported file' })
    } catch {
      // no-op — dismissed, unsupported, or no target app
    }
    return
  }
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
