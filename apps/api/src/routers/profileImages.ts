import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { profileActor, profileScopes } from '../profileImages/access.js'
import { beginProfileConnection } from '../profileImages/oauth.js'
import { profileFolderId } from '../profileImages/mapping.js'
import { driveJson, profileFolder, profileStatus, profileToken, readProfileIndex, readProfileState, syncError, syncProfileImages, withProfileLock, writeProfileState } from '../profileImages/service.js'

const folderInput = z.object({ folder: z.string().max(2048) }).strict()
function folderId(folder: string) {
  try { return profileFolderId(folder) } catch (error) { throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message }) }
}
export const profileImagesRouter = router({
  status: protectedReadProcedure.query(async ({ ctx }) => { await profileActor(ctx, true); return profileStatus(await readProfileState()) }),
  connect: protectedProcedure.mutation(async ({ ctx }) => beginProfileConnection(await profileActor(ctx, true, true), ctx.setCookie)),
  folders: protectedReadProcedure.input(z.object({ parentId: z.string().min(1).max(200).regex(/^[\w-]+$/).default('root'), pageToken: z.string().max(2048).optional() }).strict()).query(async ({ ctx, input }) => {
    await profileActor(ctx, true)
    return withProfileLock(async (state, db) => {
      try {
        const token = await profileToken(state)
        const result = await driveJson<{ files: { id: string; name: string }[]; nextPageToken?: string }>(token, 'files', { q: `'${input.parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, pageSize: '100', fields: 'nextPageToken,files(id,name)', orderBy: 'name', spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(input.pageToken ? { pageToken: input.pageToken } : {}) })
        await writeProfileState(db, state); return result
      } catch (error) { throw new TRPCError({ code: 'BAD_REQUEST', message: syncError(error) }) }
    })
  }),
  test: protectedProcedure.input(folderInput).mutation(async ({ ctx, input }) => {
    await profileActor(ctx, true, true)
    const id = folderId(input.folder)
    if (!id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a Profile Images folder first.' })
    return withProfileLock(async (state, db) => {
      try { const folder = await profileFolder(await profileToken(state), id); await writeProfileState(db, state); return { id: folder.id, name: folder.name } }
      catch (error) { throw new TRPCError({ code: 'BAD_REQUEST', message: syncError(error) }) }
    })
  }),
  save: protectedProcedure.input(folderInput).mutation(async ({ ctx, input }) => { await profileActor(ctx, true, true); return syncProfileImages(folderId(input.folder)) }),
  sync: protectedProcedure.mutation(async ({ ctx }) => { await profileActor(ctx, true, true); return syncProfileImages() }),
  // Anyone who can see People photos may pull Drive changes (renames, new photos). Incremental and throttled.
  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    await profileActor(ctx)
    const { folderId, folderName, lastSyncAt, imageCount, matchedCount, waiting, warnings, error } = await syncProfileImages(undefined, 10_000)
    return { configured: !!folderId, folderName, lastSyncAt, imageCount, matchedCount, waiting, warnings, error }
  }),
  index: protectedReadProcedure.query(async ({ ctx }) => {
    const scopes = await profileScopes(await profileActor(ctx))
    const state = await readProfileIndex()
    const visible = Object.entries(state.error ? {} : state.mappings).filter(([, mapping]) => scopes.has(mapping.scope ?? 'contacts'))
    // `names` lets id-less avatars (name-only screens) resolve a photo. Mapped names are already unique.
    return { configured: !!state.folderId, revision: state.revision,
      versions: Object.fromEntries(visible.map(([id, mapping]) => [id, mapping.version])),
      names: Object.fromEntries(visible.filter(([, mapping]) => mapping.nameKey).map(([id, mapping]) => [mapping.nameKey!, id])) }
  }),
})
