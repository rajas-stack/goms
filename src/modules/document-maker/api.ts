import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MakerDocument, MakerDocumentKind } from '@goms/domain'
import { repository } from '@/data/repository'
import type { MakerOwner } from '@/data/in-memory/makerDocuments'

const LIST_KEY = ['makerDocuments'] as const

export function useMakerDocuments() {
  return useQuery({ queryKey: LIST_KEY, queryFn: () => repository.listMakerDocuments() })
}

/** Every file mutation refreshes the list (and the one file's cached copy). */
function useListMutation<Input, Output>(fn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export const useCreateMakerDocument = () =>
  useListMutation((input: { kind: MakerDocumentKind; title: string; owner?: MakerOwner }) => repository.createMakerDocument(input))
export const useUploadMakerDocument = () =>
  useListMutation((input: { name: string; data: string; owner?: MakerOwner }) => repository.uploadMakerDocument(input))
export const useRenameMakerDocument = () =>
  useListMutation((input: { id: string; title: string }) => repository.renameMakerDocument(input.id, input.title))
export const useDuplicateMakerDocument = () => useListMutation((id: string) => repository.duplicateMakerDocument(id))
export const useDeleteMakerDocument = () => useListMutation((id: string) => repository.deleteMakerDocument(id))

/** Reads a picked file as base64 (without the data: prefix). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

/** Starts a browser download of the current version. */
export async function downloadMakerDocument(doc: MakerDocument): Promise<void> {
  const { url, name } = await repository.getMakerDownload(doc.id)
  const link = document.createElement('a')
  link.href = url
  link.download = name || `${doc.title}.${doc.fileType}`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
