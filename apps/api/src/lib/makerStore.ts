// SQL for Document maker files. Bytes live in `maker_documents.content` (bytea) — see the migration for why not GCS.
// Every user-facing query is scoped by owner_email; the Document Server routes address a row by id only, after
// their own JWT checks.
import { randomUUID } from 'node:crypto'
import {
  isAmnexEmail, MAKER_PERMISSIONS, makerDocumentKey, type MakerDocument, type MakerDocumentKind, type MakerFileType, type MakerPermission,
  type MakerShare, type MakerVersion,
} from '@goms/domain'
import { pool } from '../db.js'
import { writeAuditLog } from './auditLog.js'
import { queueDriveSync } from './makerDrive.js'

/** Every column except the bytes — lists never load file content. */
export const META_COLUMNS = 'id, kind, title, file_type, size_bytes, version, document_key, owner_email, owner_name, created_at, updated_at'

function sharePermissions(row: any): MakerPermission[] {
  return MAKER_PERMISSIONS.filter((p) => row[`can_${p}`])
}

export function toMakerDocument(row: any): MakerDocument {
  return {
    id: row.id, kind: row.kind, title: row.title, fileType: row.file_type, size: Number(row.size_bytes),
    version: Number(row.version), documentKey: row.document_key, ownerEmail: row.owner_email, ownerName: row.owner_name ?? '',
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.shared ? { permissions: sharePermissions(row) } : {}),
  }
}

export interface Owner { email: string; name: string }

/** Metadata plus the caller's share flags (`shared` is false on their own files). */
const ACCESS_SELECT = `SELECT ${META_COLUMNS.split(', ').map((c) => `d.${c}`).join(', ')},
  (d.owner_email<>$1) AS shared, s.can_read, s.can_comment, s.can_write
  FROM maker_documents d LEFT JOIN maker_document_shares s ON s.document_id=d.id AND s.grantee_email=$1`
const ACCESS_WHERE = '(d.owner_email=$1 OR s.grantee_email IS NOT NULL)'

export async function listOwned(ownerEmail: string): Promise<MakerDocument[]> {
  const { rows } = await pool.query(`SELECT ${META_COLUMNS} FROM maker_documents WHERE owner_email=$1 ORDER BY updated_at DESC, insert_seq DESC LIMIT 1000`, [ownerEmail])
  return rows.map(toMakerDocument)
}

/** The caller's own files and files shared with them. */
export async function listAccessible(email: string): Promise<MakerDocument[]> {
  const { rows } = await pool.query(`${ACCESS_SELECT} WHERE ${ACCESS_WHERE} ORDER BY d.updated_at DESC, d.insert_seq DESC LIMIT 1000`, [email])
  return rows.map(toMakerDocument)
}

/** One file the caller owns or was shared, with their rights; null otherwise. */
export async function getAccessible(id: string, email: string): Promise<MakerDocument | null> {
  const { rows } = await pool.query(`${ACCESS_SELECT} WHERE d.id=$2 AND ${ACCESS_WHERE}`, [email, id])
  return rows[0] ? toMakerDocument(rows[0]) : null
}

export async function listShares(id: string): Promise<MakerShare[]> {
  const { rows } = await pool.query('SELECT * FROM maker_document_shares WHERE document_id=$1 ORDER BY grantee_name, grantee_email', [id])
  return rows.map((row) => ({ email: row.grantee_email, name: row.grantee_name, permissions: sharePermissions(row), sharedBy: row.shared_by, updatedAt: new Date(row.updated_at).toISOString() }))
}

/** Adds or replaces one share; the caller has already checked ownership and the grantee. */
export async function upsertShare(id: string, grantee: Owner, permissions: MakerPermission[], sharedBy: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO maker_document_shares (document_id, grantee_email, grantee_name, can_read, can_comment, can_write, shared_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (document_id, grantee_email) DO UPDATE SET grantee_name=EXCLUDED.grantee_name, can_read=EXCLUDED.can_read,
         can_comment=EXCLUDED.can_comment, can_write=EXCLUDED.can_write, shared_by=EXCLUDED.shared_by, updated_at=now()`,
      [id, grantee.email, grantee.name, permissions.includes('read'), permissions.includes('comment'), permissions.includes('write'), sharedBy],
    )
    await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'share', oldValue: '', newValue: `${grantee.email}: ${permissions.join('+')}`, reason: 'Document maker', action: 'maker_document_shared', changedBy: sharedBy })
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function deleteShare(id: string, granteeEmail: string, changedBy: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rowCount } = await client.query('DELETE FROM maker_document_shares WHERE document_id=$1 AND grantee_email=$2', [id, granteeEmail])
    if (rowCount) await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'share', oldValue: granteeEmail, newValue: '', reason: 'Document maker', action: 'maker_document_unshared', changedBy })
    await client.query('COMMIT')
    return Boolean(rowCount)
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

/** An active employee with an Amnex email, as a share grantee; null when not in the directory. */
export async function findDirectoryEmployee(email: string): Promise<Owner | null> {
  const { rows } = await pool.query(`SELECT name, lower(email) AS email FROM employees WHERE lower(email)=$1 AND status='active' LIMIT 1`, [email])
  return rows[0] && isAmnexEmail(rows[0].email) ? { email: rows[0].email, name: rows[0].name ?? '' } : null
}

export async function listVersions(id: string): Promise<MakerVersion[]> {
  const { rows } = await pool.query('SELECT version, size_bytes, saved_by, reason, created_at FROM maker_document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 200', [id])
  return rows.map((row) => ({ version: Number(row.version), size: Number(row.size_bytes), savedBy: row.saved_by, reason: row.reason, createdAt: new Date(row.created_at).toISOString() }))
}

export async function readVersionContent(id: string, version: number): Promise<Buffer | null> {
  const { rows } = await pool.query('SELECT content FROM maker_document_versions WHERE document_id=$1 AND version=$2', [id, version])
  return rows[0]?.content ?? null
}

export async function getOwned(id: string, ownerEmail: string): Promise<MakerDocument | null> {
  const { rows } = await pool.query(`SELECT ${META_COLUMNS} FROM maker_documents WHERE id=$1 AND owner_email=$2`, [id, ownerEmail])
  return rows[0] ? toMakerDocument(rows[0]) : null
}

export async function insertDocument(input: { kind: MakerDocumentKind; fileType: MakerFileType; title: string; bytes: Uint8Array; owner: Owner; action: string }): Promise<MakerDocument> {
  const id = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO maker_documents (id, kind, title, file_type, content, size_bytes, version, document_key, owner_email, owner_name)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9) RETURNING ${META_COLUMNS}`,
      [id, input.kind, input.title, input.fileType, Buffer.from(input.bytes), input.bytes.length, makerDocumentKey(id, 1), input.owner.email, input.owner.name],
    )
    await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'title', oldValue: '', newValue: input.title, reason: 'Document maker', action: input.action, changedBy: input.owner.email })
    await client.query('COMMIT')
    queueDriveSync(id)
    return toMakerDocument(rows[0])
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function renameOwned(id: string, ownerEmail: string, title: string): Promise<MakerDocument | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const before = await client.query('SELECT title FROM maker_documents WHERE id=$1 AND owner_email=$2 FOR UPDATE', [id, ownerEmail])
    if (!before.rows.length) { await client.query('ROLLBACK'); return null }
    const { rows } = await client.query(`UPDATE maker_documents SET title=$3, updated_at=now() WHERE id=$1 AND owner_email=$2 RETURNING ${META_COLUMNS}`, [id, ownerEmail, title])
    await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'title', oldValue: before.rows[0].title, newValue: title, reason: 'Document maker', action: 'maker_document_renamed', changedBy: ownerEmail })
    await client.query('COMMIT')
    return toMakerDocument(rows[0])
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function readContent(id: string, ownerEmail?: string): Promise<{ doc: MakerDocument; bytes: Buffer } | null> {
  const { rows } = ownerEmail
    ? await pool.query(`SELECT ${META_COLUMNS}, content FROM maker_documents WHERE id=$1 AND owner_email=$2`, [id, ownerEmail])
    : await pool.query(`SELECT ${META_COLUMNS}, content FROM maker_documents WHERE id=$1`, [id])
  return rows[0] ? { doc: toMakerDocument(rows[0]), bytes: rows[0].content as Buffer } : null
}

export async function deleteOwned(id: string, ownerEmail: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('DELETE FROM maker_documents WHERE id=$1 AND owner_email=$2 RETURNING title', [id, ownerEmail])
    if (rows.length) {
      await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'title', oldValue: rows[0].title, newValue: '', reason: 'Document maker', action: 'maker_document_deleted', changedBy: ownerEmail })
    }
    await client.query('COMMIT')
    return rows.length > 0
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

/** Stores a new version (edited in ONLYOFFICE, or re-uploaded) and issues the next document key. */
export async function saveVersion(id: string, bytes: Uint8Array, changedBy: string | null, reason: string): Promise<MakerDocument | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT version, content, size_bytes, updated_at FROM maker_documents WHERE id=$1 FOR UPDATE', [id])
    if (!current.rows.length) { await client.query('ROLLBACK'); return null }
    const version = Number(current.rows[0].version) + 1
    // Keep the bytes being replaced so the file page can list and download earlier versions.
    await client.query(
      `INSERT INTO maker_document_versions (document_id, version, content, size_bytes, saved_by, reason, created_at)
       VALUES ($1,$2,$3,$4,NULL,'',$5) ON CONFLICT DO NOTHING`,
      [id, version - 1, current.rows[0].content, current.rows[0].size_bytes, current.rows[0].updated_at],
    )
    const { rows } = await client.query(
      `UPDATE maker_documents SET content=$2, size_bytes=$3, version=$4, document_key=$5, updated_at=now() WHERE id=$1 RETURNING ${META_COLUMNS}`,
      [id, Buffer.from(bytes), bytes.length, version, makerDocumentKey(id, version)],
    )
    await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'version', oldValue: String(version - 1), newValue: String(version), reason, action: 'maker_document_saved', changedBy })
    await client.query('COMMIT')
    queueDriveSync(id)
    return toMakerDocument(rows[0])
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
