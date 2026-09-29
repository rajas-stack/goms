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

  confirmUpload: protectedProcedure
    .input(z.object({ uploadId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const pending = pendingUploads.get(input.uploadId)
      if (!pending) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown or expired upload.' })

      const metadata = await getObjectMetadata(pending.pendingPath)
      if (!metadata) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The file was never uploaded.' })

      // Verify the ACTUAL object, not the original request (spec §14) —
      // defense in depth against a client that lied about what it's uploading.
      if (metadata.size > MAX_DOCUMENT_SIZE_BYTES || !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(metadata.contentType)) {
        await deleteObject(pending.pendingPath)
        pendingUploads.delete(input.uploadId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The uploaded file does not match an allowed type/size.' })
      }

      await moveObject(pending.pendingPath, pending.canonicalPath)
      pendingUploads.delete(input.uploadId)

      let row: any
      try {
        row = (await pool.query(
          `INSERT INTO documents (entity_type, entity_id, filename, storage_path, version, content_type, size_bytes, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [pending.entityType, pending.entityId, pending.filename, pending.canonicalPath, pending.version, metadata.contentType, metadata.size, ctx.user?.email ?? null],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) {
          // Lost the race to a concurrent confirm for the same
          // (entityType, entityId, filename, version) — the object we just
          // moved to the canonical path must not be left there.
          await deleteObject(pending.canonicalPath)
          throw new TRPCError({ code: 'CONFLICT', message: 'This exact file and version was already uploaded.' })
        }
        throw e
      }
      return toDocument(row)
    }),
})
