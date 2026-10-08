import { copyFile, createFolder, FOLDER_MIME, getDriveSession, listFiles, renameFile, trashFile, type DriveFile } from './googleDrive'
import { loadConnections, saveConnection, type DmsConnection } from './connections'

export interface MasterSyncResult { copied: number; skipped: number; errors: string[] }
const running = new Map<string, Promise<MasterSyncResult>>()

async function targetFolder(source: DmsConnection, sourceFolder: DriveFile, parentId: string, master: DmsConnection): Promise<DriveFile> {
  const children = await listFiles(parentId, master.id)
  let target = children.find((file) => file.mimeType === FOLDER_MIME && file.appProperties?.gomsSourceDms === source.id && file.appProperties?.gomsSourceFile === sourceFolder.id)
  if (!target) {
    target = await createFolder(sourceFolder.name, parentId, master.id, { gomsSourceDms: source.id, gomsSourceFile: sourceFolder.id })
  } else if (target.name !== sourceFolder.name) {
    target = await renameFile(target.id, sourceFolder.name, master.id)
  }
  return target
}

async function copyDocument(source: DmsConnection, file: DriveFile, targetId: string, master: DmsConnection): Promise<boolean> {
  const children = await listFiles(targetId, master.id)
  const previous = children.find((item) => item.appProperties?.gomsSourceDms === source.id && item.appProperties?.gomsSourceFile === file.id)
  if (previous && file.modifiedTime && previous.appProperties?.gomsSourceModified === file.modifiedTime && previous.name === file.name) return false
  // Create a valid replacement before retiring an older master copy.
  await copyFile(file, targetId, master.id, {
    gomsSourceDms: source.id, gomsSourceFile: file.id, gomsSourceModified: file.modifiedTime ?? '',
  })
  if (previous) await trashFile(previous.id, master.id)
  return true
}

export async function mirrorUpload(connectionId: string, file: DriveFile, path: DriveFile[]): Promise<void> {
  const all = loadConnections()
  const source = all.find((item) => item.id === connectionId && !item.isMaster)
  const master = all.find((item) => item.isMaster)
  if (!source || !master || !master.settings.rootFolderId) return
  if (!getDriveSession(master.id)) throw new Error('Connect the master DMS to collect these documents.')
  let parentId = master.settings.rootFolderId
  for (let index = 0; index < path.length; index++) {
    const folder = await targetFolder(source, index === 0 ? { ...path[index], name: source.name } : path[index], parentId, master)
    parentId = folder.id
  }
  await copyDocument(source, file, parentId, master)
}

export function syncMaster(master: DmsConnection): Promise<MasterSyncResult> {
  const pending = running.get(master.id)
  if (pending) return pending
  const promise = collect(master).finally(() => running.delete(master.id))
  running.set(master.id, promise)
  return promise
}

async function collect(master: DmsConnection): Promise<MasterSyncResult> {
  if (!getDriveSession(master.id)) throw new Error('Connect the master Google Drive before collecting documents.')
  if (!master.settings.rootFolderId) throw new Error('Choose a root folder for the master DMS.')
  const result: MasterSyncResult = { copied: 0, skipped: 0, errors: [] }
  const sources = loadConnections().filter((item) => !item.isMaster && item.settings.provider === 'google-drive' && item.settings.rootFolderId)
  for (const source of sources) {
    try {
      if (source.settings.rootFolderId === master.settings.rootFolderId) throw new Error('Source and master must use different root folders.')
      const root = await targetFolder(source, { id: source.settings.rootFolderId, name: source.name, mimeType: FOLDER_MIME }, master.settings.rootFolderId, master)
      const visited = new Set<string>()
      async function visit(sourceId: string, targetId: string): Promise<void> {
        if (visited.has(sourceId)) return
        visited.add(sourceId)
        // The master account lists and copies; source folders must be shared with it.
        const files = await listFiles(sourceId, master.id)
        for (const file of files) {
          if (file.id === master.settings.rootFolderId || file.appProperties?.gomsSourceDms) continue
          if (file.mimeType === FOLDER_MIME) {
            const child = await targetFolder(source, file, targetId, master)
            await visit(file.id, child.id)
          } else if (file.mimeType !== 'application/vnd.google-apps.shortcut') {
            if (await copyDocument(source, file, targetId, master)) result.copied++
            else result.skipped++
          }
        }
      }
      await visit(source.settings.rootFolderId, root.id)
    } catch (error) {
      result.errors.push(`${source.name}: ${error instanceof Error ? error.message : 'Copy failed.'}`)
    }
  }
  if (!result.errors.length) saveConnection({ ...master, lastSyncedAt: new Date().toISOString() })
  return result
}
