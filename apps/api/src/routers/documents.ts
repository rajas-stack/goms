import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'node:crypto'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { ALLOWED_DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_SIZE_BYTES, getSignedUploadUrl, getSignedDownloadUrl, getObjectMetadata, moveObject, deleteObject } from '../lib/gcs.js'

export function toDocument(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, filename: row.filename,
    storagePath: row.storage_path, version: row.version, contentType: row.content_type,
    sizeBytes: Number(row.size_bytes), uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at,
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// In-memory map of uploadId -> pending upload metadata, populated by
// requestUploadUrl and consumed by confirmUpload (Task 17). Fine for this
// app's scale (spec §2) and this feature's short-lived (10-minute signed
// URL) window — an uploadId that's never confirmed simply expires here on
// process restart, same lifetime class as the signed URL itself.
export const pendingUploads = new Map<string, { entityType: string; entityId: string; filename: string; version: string; pendingPath: string; canonicalPath: string }>()

export const documentsRouter = router({
  requestUploadUrl: protectedProcedure
    .input(z.object({
      entityType: z.string(), entityId: z.string().uuid(), filename: z.string().min(1),
      contentType: z.string(), sizeBytes: z.number().int().positive(), version: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unsupported file type: ${input.contentType}` })
      }
      if (input.sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds the 50 MB limit.' })
      }
      const uploadId = randomUUID()
      const documentId = randomUUID()
      const safeFilename = sanitizeFilename(input.filename)
      const version = input.version ?? 'v1.0'
      const pendingPath = `bid-tracker/_pending/${uploadId}/${safeFilename}`
      const canonicalPath = `bid-tracker/${input.entityType}/${input.entityId}/${documentId}/${safeFilename}`
      pendingUploads.set(uploadId, { entityType: input.entityType, entityId: input.entityId, filename: safeFilename, version, pendingPath, canonicalPath })
      const uploadUrl = await getSignedUploadUrl(pendingPath, input.contentType)
      return { uploadId, uploadUrl }
    }),
})
