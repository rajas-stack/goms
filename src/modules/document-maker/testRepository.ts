// In-test stand-in for `@/data/repository`'s Document maker methods, built on the same local logic the in-memory
// store uses, so component tests exercise real validation without the full seeded store.
import { vi } from 'vitest'
import type { MakerDocumentKind } from '@goms/domain'
import {
  createLocal, duplicateLocal, LOCAL_OWNER, renameLocal, requireLocal, toPublic, uploadLocal, type LocalMakerDocument, type MakerOwner,
} from '@/data/in-memory/makerDocuments'

export function makeMakerRepository() {
  let docs: LocalMakerDocument[] = []
  const put = (doc: LocalMakerDocument) => { docs = [doc, ...docs.filter((d) => d.id !== doc.id)]; return toPublic(doc) }
  return {
    reset: () => { docs = [] },
    listMakerDocuments: vi.fn(async () => docs.map(toPublic)),
    createMakerDocument: vi.fn(async (input: { kind: MakerDocumentKind; title: string; owner?: MakerOwner }) => put(createLocal(input.kind, input.title, input.owner ?? LOCAL_OWNER))),
    uploadMakerDocument: vi.fn(async (input: { name: string; data: string; owner?: MakerOwner }) => put(uploadLocal(input.name, input.data, input.owner ?? LOCAL_OWNER))),
    renameMakerDocument: vi.fn(async (id: string, title: string) => put(renameLocal(requireLocal(docs, id), title))),
    duplicateMakerDocument: vi.fn(async (id: string) => put(duplicateLocal(requireLocal(docs, id)))),
    deleteMakerDocument: vi.fn(async (id: string) => { requireLocal(docs, id); docs = docs.filter((d) => d.id !== id) }),
    getMakerDownload: vi.fn(async (id: string) => ({ url: `blob:${id}`, name: `${requireLocal(docs, id).title}.docx` })),
  }
}
