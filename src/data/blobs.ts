import { BLOB_STORE, openGormsDb } from './persist'

/** Binary storage for attachments, kept in its own IndexedDB object store.
 *
 *  Deliberately NOT part of the `GormsData` snapshot: that snapshot is
 *  rewritten in full on every mutation (debounced), so a single 10 MB
 *  proposal PDF held inline would make every keystroke-triggered save
 *  rewrite 10 MB. Blobs are written once, read on demand, and referenced
 *  from `Attachment.blobId`.
 *
 *  Every function resolves rather than rejects when storage is
 *  unavailable — same contract as `persist.ts`. Attachments are an
 *  enhancement; the app keeps working without them. */

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  const db = await openGormsDb()
  if (!db) return fallback
  try {
    return await new Promise<T>((resolve) => {
      const tx = db.transaction(BLOB_STORE, mode)
      const req = fn(tx.objectStore(BLOB_STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(fallback)
      tx.onabort = () => resolve(fallback)
    })
  } catch {
    return fallback
  } finally {
    db.close()
  }
}

export async function putBlob(id: string, blob: Blob): Promise<boolean> {
  const db = await openGormsDb()
  if (!db) return false
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite')
      tx.objectStore(BLOB_STORE).put(blob, id)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    // Quota exceeded, or the store vanished.
    return false
  } finally {
    db.close()
  }
}

export async function getBlob(id: string): Promise<Blob | null> {
  const result = await withStore<Blob | undefined>('readonly', (s) => s.get(id), undefined)
  return result ?? null
}

export async function deleteBlob(id: string): Promise<void> {
  revokeBlobObjectUrl(id)
  await withStore<undefined>('readwrite', (s) => s.delete(id), undefined)
}

/** Object URLs are cached per blob id because the common consumer is an
 *  avatar in a scrolling list, which would otherwise allocate a new URL on
 *  every render and leak every one of them. Callers must NOT call
 *  `URL.revokeObjectURL` themselves — use `revokeBlobObjectUrl`. */
const urlCache = new Map<string, string>()

export async function getBlobObjectUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getBlob(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export function revokeBlobObjectUrl(id: string): void {
  const url = urlCache.get(id)
  if (!url) return
  URL.revokeObjectURL(url)
  urlCache.delete(id)
}
