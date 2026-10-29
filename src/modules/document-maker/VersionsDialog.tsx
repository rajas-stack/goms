import { useQuery } from '@tanstack/react-query'
import type { MakerDocument } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { editedLabel, formatBytes } from './kinds'

/** Every earlier version kept when a save replaced the file (editor, desktop app or upload). */
export function VersionsDialog({ doc, onClose }: { doc: MakerDocument | null; onClose: () => void }) {
  const toast = useToast()
  const versions = useQuery({ queryKey: ['makerVersions', doc?.id, doc?.version], queryFn: () => repository.listMakerVersions(doc!.id), enabled: !!doc })

  const download = async (version: number) => {
    try {
      const { url } = await repository.getMakerVersionDownload(doc!.id, version)
      const link = document.createElement('a')
      link.href = url; link.rel = 'noopener'
      document.body.appendChild(link); link.click(); link.remove()
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not download that version.', undefined, 'error') }
  }

  return (
    <Dialog open={!!doc} onClose={onClose} title="Version history" description={doc ? `"${doc.title}" is on version ${doc.version}.` : undefined}
      footer={<Button size="sm" onClick={onClose}>Close</Button>}>
      {versions.isLoading && <p className="text-[13px] text-muted">Loading…</p>}
      {versions.isError && <p role="alert" className="text-[13px] text-crimson">{versions.error instanceof Error ? versions.error.message : 'Could not load versions.'}</p>}
      {versions.isSuccess && !versions.data.length && <p className="text-[13px] text-muted">No earlier versions yet. One is kept every time the file is saved.</p>}
      <ul className="divide-y divide-line">
        {(versions.data ?? []).map((v) => (
          <li key={v.version} className="flex items-center gap-3 py-2 text-[13px]">
            <span className="w-12 font-medium tabular-nums text-ink-900">v{v.version}</span>
            <span className="mr-auto text-muted" title={new Date(v.createdAt).toLocaleString('en-IN')}>{editedLabel(v.createdAt)} · {formatBytes(v.size)}</span>
            <Button size="sm" onClick={() => void download(v.version)}>Download</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
