/** uploadId -> pending upload metadata (see routers/documents.ts). Lives here so the RBAC registry can read it
 *  without importing a router (which would import trpc.ts and form a cycle). */
export const pendingUploads = new Map<string, {
  entityType: string; entityId: string; filename: string; version: string; pendingPath: string; canonicalPath: string
}>()
