import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import { makerRights, MIME_FOR_FILE_TYPE, officeAppLinks, type MakerDocument, type MakerDocumentKind } from '@goms/domain'
import { repository } from '@/data/repository'
import { downloadBinaryFile, openFileInApp } from '@/lib/file-export'
import type { MakerOwner } from '@/data/in-memory/makerDocuments'

const LIST_KEY = ['makerDocuments'] as const

export function useMakerDocuments() {
  // Refetch on focus: coming back from a desktop app shows the version it just saved.
  return useQuery({ queryKey: LIST_KEY, queryFn: () => repository.listMakerDocuments(), refetchOnWindowFocus: true })
}

/** Every file mutation refreshes the list (and the one file's cached copy). */
function useListMutation<Input, Output>(fn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export const useCreateMakerDocument = () =>
  useListMutation((input: { kind: MakerDocumentKind; title: string; owner?: MakerOwner }) => repository.createMakerDocument(input))
export const useUploadMakerDocument = () =>
  useListMutation((input: { name: string; data: string; owner?: MakerOwner }) => repository.uploadMakerDocument(input))
export const useRenameMakerDocument = () =>
  useListMutation((input: { id: string; title: string }) => repository.renameMakerDocument(input.id, input.title))
export const useDuplicateMakerDocument = () => useListMutation((id: string) => repository.duplicateMakerDocument(id))
export const useDeleteMakerDocument = () => useListMutation((id: string) => repository.deleteMakerDocument(id))

/** Reads a picked file as base64 (without the data: prefix). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

/** In the Android app there is no in-app editor: files are kept here and edited in the phone's Word/Excel/PowerPoint app. */
export const editsInPhoneApp = () => Capacitor.isNativePlatform()

async function makerFile(doc: MakerDocument): Promise<{ name: string; bytes: Uint8Array; mimeType: string }> {
  const { url, name } = await repository.getMakerDownload(doc.id)
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Could not read the file.')
    return { name: name || `${doc.title}.${doc.fileType}`, bytes: new Uint8Array(await response.arrayBuffer()), mimeType: MIME_FOR_FILE_TYPE[doc.fileType] }
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
}

/** Android: saves the file on the phone and opens the app picker for its type. */
export async function openMakerDocumentInApp(doc: MakerDocument): Promise<void> {
  const file = await makerFile(doc)
  const uri = await openFileInApp(file.name, file.bytes, file.mimeType)
  if (makerRights(doc).write) handedToPhoneApp.set(doc.id, { uri, name: file.name, mtime: (await Filesystem.stat({ path: uri })).mtime })
}

/** Files handed to the phone's Word / Excel / PowerPoint with edit rights, and when GOMS last saw each one change.
 *  shortcut: kept in memory, so edits made after GOMS itself is closed by Android are not picked up; persist this when that matters. */
const handedToPhoneApp = new Map<string, { uri: string; name: string; mtime: number }>()

/** Android, when GOMS returns to the foreground: uploads each handed-off file the phone app has saved since, as a new
 *  version (the server checks write permission again). One file failing (access revoked, too large) does not stop the
 *  others; it is reported once and no longer watched. */
export async function collectPhoneAppEdits(): Promise<{ saved: MakerDocument[]; errors: string[] }> {
  const saved: MakerDocument[] = []
  const errors: string[] = []
  for (const [id, file] of handedToPhoneApp) {
    try {
      const stat = await Filesystem.stat({ path: file.uri }).catch(() => null)
      if (!stat) { handedToPhoneApp.delete(id); continue }
      if (stat.mtime <= file.mtime) continue
      const { data } = await Filesystem.readFile({ path: file.uri })
      saved.push(await repository.replaceMakerDocument(id, file.name, typeof data === 'string' ? data : await readFileBase64(new File([data], file.name))))
      handedToPhoneApp.set(id, { ...file, mtime: stat.mtime })
    } catch (error) {
      handedToPhoneApp.delete(id)
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'could not be saved'}`)
    }
  }
  return { saved, errors }
}

/** Starts a browser download of the current version (Android: save + share sheet, since WebView ignores <a download>). */
export async function downloadMakerDocument(doc: MakerDocument): Promise<void> {
  if (editsInPhoneApp()) {
    const file = await makerFile(doc)
    await downloadBinaryFile(file.name, file.bytes, file.mimeType)
    return
  }
  const { url, name } = await repository.getMakerDownload(doc.id)
  const link = document.createElement('a')
  link.href = url
  link.download = name || `${doc.title}.${doc.fileType}`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type DesktopApp = 'office' | 'libreOffice'

/** Hands the file to an installed Office app over WebDAV; every save there becomes a version here. */
export async function openMakerDocumentInDesktopApp(doc: MakerDocument, app: DesktopApp): Promise<void> {
  const { url, write } = await repository.openMakerDesktopSession(doc.id)
  window.location.href = officeAppLinks(doc.fileType, write, url)[app]
}
