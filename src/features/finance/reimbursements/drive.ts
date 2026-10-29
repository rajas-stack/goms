import { loadConnections, type DmsConnection } from '@/features/dms/connections'
import {
  connectDrive, createFolder, downloadFile, FOLDER_MIME, getDriveSession, listFiles, loadGoogleIdentity, renameFile, uploadFile,
} from '@/features/dms/googleDrive'
import { attachmentFileName, type Attachment } from './model'

/** Bills go to the DMS assigned to Finance (Settings → DMS): the signed-in user's own Google Drive, under
 *  `<root>/Reimbursements/<yyyy-mm>/`. Files are named with their attachment code. */
export function financeDrive(): DmsConnection | null {
  return loadConnections().find((c) => !c.isMaster && c.modules.includes('finance') && c.settings.provider === 'google-drive'
    && c.settings.clientId && c.settings.rootFolderId) ?? null
}

export const isDriveConnected = (drive: DmsConnection | null) => !!drive && !!getDriveSession(drive.id)

export async function connectFinanceDrive(drive: DmsConnection): Promise<void> {
  if (getDriveSession(drive.id)) return
  await loadGoogleIdentity()
  await connectDrive(drive.settings.clientId, drive.id)
}

// shortcut: bytes of not-yet-uploaded bills live only in this tab's memory; they are lost on reload unless saved to Drive.
const pendingFiles = new Map<string, File>()
export const keepPendingFile = (id: string, file: File) => pendingFiles.set(id, file)
export const pendingFile = (id: string) => pendingFiles.get(id)
export const forgetPendingFile = (id: string) => pendingFiles.delete(id)

async function childFolder(parentId: string, name: string, connectionId: string): Promise<string> {
  const existing = (await listFiles(parentId, connectionId)).find((f) => f.mimeType === FOLDER_MIME && f.name === name)
  return existing?.id ?? (await createFolder(name, parentId, connectionId)).id
}

const monthFolders = new Map<string, Promise<string>>()
function monthFolder(drive: DmsConnection, month: string): Promise<string> {
  const key = `${drive.id}:${month}`
  let folder = monthFolders.get(key)
  if (!folder) {
    folder = childFolder(drive.settings.rootFolderId, 'Reimbursements', drive.id).then((id) => childFolder(id, month, drive.id))
    folder.catch(() => monthFolders.delete(key))
    monthFolders.set(key, folder)
  }
  return folder
}

/** Uploads a pending bill under its code; returns the saved attachment (or the error, keeping the file pending). */
export async function saveAttachment(drive: DmsConnection, month: string, attachment: Attachment): Promise<Attachment> {
  const file = pendingFiles.get(attachment.id)
  if (!file) return { ...attachment, state: 'error', error: 'The file is no longer in this tab. Attach it again.' }
  try {
    const parent = await monthFolder(drive, month)
    const named = new File([file], attachmentFileName(attachment.code, file.name), { type: file.type })
    const saved = await uploadFile(named, parent, 'reimbursement-bill', undefined, drive.id)
    pendingFiles.delete(attachment.id)
    return { ...attachment, state: 'saved', driveId: saved.id, webViewLink: saved.webViewLink, error: undefined }
  } catch (error) {
    return { ...attachment, state: 'error', error: error instanceof Error ? error.message : 'Upload failed.' }
  }
}

/** Renames a saved bill whose code changed (its row moved). */
export function renameAttachment(drive: DmsConnection, attachment: Attachment): Promise<unknown> {
  if (!attachment.driveId) return Promise.resolve()
  return renameFile(attachment.driveId, attachmentFileName(attachment.code, attachment.originalName), drive.id)
}

/** The bill's bytes: from this tab when not yet uploaded, otherwise from Drive. */
export async function attachmentBlob(attachment: Attachment, drive: DmsConnection | null): Promise<Blob> {
  const local = pendingFiles.get(attachment.id)
  if (local) return local
  if (!attachment.driveId || !drive) throw new Error(`${attachment.code}: connect the Finance DMS to read this bill.`)
  await connectFinanceDrive(drive)
  return downloadFile(attachment.driveId, drive.id)
}
