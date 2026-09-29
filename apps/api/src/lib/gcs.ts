// Thin wrapper over @google-cloud/storage, scoped to exactly what Bid
// Tracker's documents need (spec §14). Reuses the already-provisioned
// `${project_id}-attachments` bucket (infra/dev|prod/storage.tf) — no new
// bucket. In Cloud Run, the client authenticates via the runtime service
// account's Application Default Credentials automatically; locally, it needs
// GOOGLE_APPLICATION_CREDENTIALS pointed at a service-account key with
// access to a real bucket, or this module's calls are skipped by tests that
// don't exercise real GCS (see documents.test.ts's note on that).
import { Storage } from '@google-cloud/storage'

const storage = new Storage()

function bucket() {
  const name = process.env.ATTACHMENTS_BUCKET
  if (!name) throw new Error('ATTACHMENTS_BUCKET is not set')
  return storage.bucket(name)
}

export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024

export async function getSignedUploadUrl(objectPath: string, contentType: string): Promise<string> {
  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000, contentType,
  })
  return url
}

export async function getSignedDownloadUrl(objectPath: string): Promise<string> {
  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
  })
  return url
}

/** Reads what GCS itself recorded for the object — the authoritative source
 *  for confirmUpload's verification (spec §14), never the client's original
 *  request claim. Returns null if the object doesn't exist (e.g. the upload
 *  never actually happened). */
export async function getObjectMetadata(objectPath: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const [metadata] = await bucket().file(objectPath).getMetadata()
    return { size: Number(metadata.size), contentType: String(metadata.contentType) }
  } catch (e: any) {
    if (e?.code === 404) return null
    throw e
  }
}

export async function moveObject(from: string, to: string): Promise<void> {
  await bucket().file(from).move(to)
}

export async function deleteObject(objectPath: string): Promise<void> {
  await bucket().file(objectPath).delete({ ignoreNotFound: true })
}
