import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  assertOfficeFile, blankOfficeFile, FILE_TYPE_FOR_KIND, KIND_FOR_FILE_TYPE, MAKER_DOCUMENT_KINDS, MAKER_LIMITS,
  normalizeMakerTitle, titleFromFileName, type MakerDocument,
} from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router, type Context } from '../trpc.js'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { buildEditorConfig, onlyofficeSettings, OnlyofficeNotConfigured, urlToken } from '../lib/onlyoffice.js'
import {
  deleteOwned, getOwned, insertDocument, listOwned, readContent, renameOwned, saveVersion, type Owner,
} from '../lib/makerStore.js'

/** Personal files: every procedure verifies the caller even when the staged auth flags are off, and every query is
 *  scoped to the caller's own email (registered as `self` in the RBAC registry). */
async function owner(ctx: Context): Promise<Owner> {
  const user = ctx.user ?? await verifyIdentity(ctx.authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
  const email = user.email.toLowerCase()
  return { email, name: email.split('@')[0] }
}

const id = z.string().guid('Invalid UUID')
const title = z.string().max(MAKER_LIMITS.title * 2).transform((value, zctx) => {
  try { return normalizeMakerTitle(value) } catch (error) {
    zctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); return z.NEVER
  }
})
/** base64 of at most MAKER_LIMITS.uploadBytes. */
const base64 = z.string().max(Math.ceil(MAKER_LIMITS.uploadBytes / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/)

function found(doc: MakerDocument | null): MakerDocument {
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found.' })
  return doc
}

function settingsOrThrow() {
  try { return onlyofficeSettings() } catch (error) {
    if (error instanceof OnlyofficeNotConfigured) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `The document editor is not set up: ${error.message}` })
    throw error
  }
}

function officeBytes(name: string, data: string) {
  const bytes = new Uint8Array(Buffer.from(data, 'base64'))
  try { return { fileType: assertOfficeFile(name, bytes, MAKER_LIMITS.uploadBytes), bytes } } catch (error) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message })
  }
}

export const makerDocumentsRouter = router({
  list: protectedReadProcedure.query(async ({ ctx }) => listOwned((await owner(ctx)).email)),
  create: protectedProcedure.input(z.object({ kind: z.enum(MAKER_DOCUMENT_KINDS), title }).strict()).mutation(async ({ input, ctx }) => {
    const fileType = FILE_TYPE_FOR_KIND[input.kind]
    return insertDocument({ kind: input.kind, fileType, title: input.title, bytes: blankOfficeFile(fileType), owner: await owner(ctx), action: 'maker_document_created' })
  }),
  upload: protectedProcedure.input(z.object({ name: z.string().min(1).max(260), data: base64 }).strict()).mutation(async ({ input, ctx }) => {
    const { fileType, bytes } = officeBytes(input.name, input.data)
    const name = normalizeMakerTitle(titleFromFileName(input.name).slice(0, MAKER_LIMITS.title))
    return insertDocument({ kind: KIND_FOR_FILE_TYPE[fileType], fileType, title: name, bytes, owner: await owner(ctx), action: 'maker_document_uploaded' })
  }),
  /** Replaces a file's content with an uploaded file of the same type (a new version). */
  replace: protectedProcedure.input(z.object({ id, name: z.string().min(1).max(260), data: base64 }).strict()).mutation(async ({ input, ctx }) => {
    const me = await owner(ctx)
    const doc = found(await getOwned(input.id, me.email))
    const { fileType, bytes } = officeBytes(input.name, input.data)
    if (fileType !== doc.fileType) throw new TRPCError({ code: 'BAD_REQUEST', message: `Choose a .${doc.fileType} file.` })
    return found(await saveVersion(doc.id, bytes, me.email, 'Replaced by upload'))
  }),
  rename: protectedProcedure.input(z.object({ id, title }).strict()).mutation(async ({ input, ctx }) =>
    found(await renameOwned(input.id, (await owner(ctx)).email, input.title))),
  duplicate: protectedProcedure.input(z.object({ id }).strict()).mutation(async ({ input, ctx }) => {
    const me = await owner(ctx)
    const source = await readContent(input.id, me.email)
    if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found.' })
    const copyTitle = `Copy of ${source.doc.title}`.slice(0, MAKER_LIMITS.title)
    return insertDocument({ kind: source.doc.kind, fileType: source.doc.fileType, title: copyTitle, bytes: new Uint8Array(source.bytes), owner: me, action: 'maker_document_duplicated' })
  }),
  delete: protectedProcedure.input(z.object({ id }).strict()).mutation(async ({ input, ctx }) => {
    if (!await deleteOwned(input.id, (await owner(ctx)).email)) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found.' })
  }),
  /** Signed DocsAPI config for the current version. */
  editorConfig: protectedReadProcedure.input(z.object({ id, theme: z.enum(['light', 'dark']) }).strict()).query(async ({ input, ctx }) => {
    const settings = settingsOrThrow()
    const me = await owner(ctx)
    const doc = found(await getOwned(input.id, me.email))
    return buildEditorConfig(doc, { id: me.email, name: me.name }, input.theme, settings)
  }),
  /** A 5-minute link (path under the API base URL) that downloads the current version. */
  downloadUrl: protectedReadProcedure.input(z.object({ id }).strict()).query(async ({ input, ctx }) => {
    const settings = settingsOrThrow()
    const doc = found(await getOwned(input.id, (await owner(ctx)).email))
    const token = await urlToken('download', { id: doc.id }, settings.secret)
    return { path: `/api/document-maker/files/${doc.id}?token=${encodeURIComponent(token)}` }
  }),
})
