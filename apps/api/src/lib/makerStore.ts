// SQL for Document maker files. Bytes live in `maker_documents.content` (bytea) — see the migration for why not GCS.
// Every user-facing query is scoped by owner_email; the Document Server routes address a row by id only, after
// their own JWT checks.
import { randomUUID } from 'node:crypto'
import { makerDocumentKey, type MakerDocument, type MakerDocumentKind, type MakerFileType } from '@goms/domain'
import { pool } from '../db.js'
import { writeAuditLog } from './auditLog.js'

/** Every column except the bytes — lists never load file content. */
export const META_COLUMNS = 'id, kind, title, file_type, size_bytes, version, document_key, owner_email, owner_name, created_at, updated_at'

export function toMakerDocument(row: any): MakerDocument {
  return {
    id: row.id, kind: row.kind, title: row.title, fileType: row.file_type, size: Number(row.size_bytes),
    version: Number(row.version), documentKey: row.document_key, ownerEmail: row.owner_email, ownerName: row.owner_name ?? '',
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export interface Owner { email: string; name: string }

export async function listOwned(ownerEmail: string): Promise<MakerDocument[]> {
  const { rows } = await pool.query(`SELECT ${META_COLUMNS} FROM maker_documents WHERE owner_email=$1 ORDER BY updated_at DESC, insert_seq DESC LIMIT 1000`, [ownerEmail])
  return rows.map(toMakerDocument)
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
    const current = await client.query('SELECT version FROM maker_documents WHERE id=$1 FOR UPDATE', [id])
    if (!current.rows.length) { await client.query('ROLLBACK'); return null }
    const version = Number(current.rows[0].version) + 1
    const { rows } = await client.query(
      `UPDATE maker_documents SET content=$2, size_bytes=$3, version=$4, document_key=$5, updated_at=now() WHERE id=$1 RETURNING ${META_COLUMNS}`,
      [id, Buffer.from(bytes), bytes.length, version, makerDocumentKey(id, version)],
    )
    await writeAuditLog(client, { entityType: 'maker_document', entityId: id, field: 'version', oldValue: String(version - 1), newValue: String(version), reason, action: 'maker_document_saved', changedBy })
    await client.query('COMMIT')
    return toMakerDocument(rows[0])
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
