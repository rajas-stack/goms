import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { editedLabel } from './kinds'

const RESULT_MESSAGES: Record<string, [string, 'error' | undefined]> = {
  connected: ['Google Drive connected. Your files are being uploaded to "GOMS Documents".', undefined],
  cancelled: ['Google Drive was not connected.', 'error'],
  wrong_account_or_permission: ['Connect with your own @amnex.com Google account and allow Drive access.', 'error'],
  failed: ['Could not connect Google Drive. Try again.', 'error'],
}

/** Whether the employee's own files are copied to their Google Drive after every save. */
export function DriveStrip() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['makerDriveStatus'], queryFn: () => repository.getMakerDriveStatus(), refetchOnWindowFocus: true, refetchInterval: 60_000 })
  const connect = useMutation({ mutationFn: () => repository.connectMakerDrive(), onSuccess: ({ url }) => { window.location.href = url } })
  const disconnect = useMutation({ mutationFn: () => repository.disconnectMakerDrive(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['makerDriveStatus'] }) })

  // The OAuth callback lands back here with ?drive_connection=<result>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('drive_connection')
    if (!result) return
    const [text, tone] = RESULT_MESSAGES[result] ?? RESULT_MESSAGES.failed
    toast(text, undefined, tone)
    params.delete('drive_connection')
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
  }, [toast])

  const fail = (error: unknown) => toast(error instanceof Error ? error.message : 'Something went wrong.', undefined, 'error')
  const s = status.data
  if (!s?.configured) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-white px-4 py-3 text-[13px]">
      <Icon name="Cloud" size={16} className={s.connected && !s.lastError ? 'text-emerald-600' : 'text-muted'} />
      <span className="mr-auto min-w-0">
        {!s.connected && 'Copy every saved version of your files to your own Google Drive.'}
        {s.connected && !s.lastError && <>Saving to your Google Drive{s.lastSyncAt ? ` · last upload ${editedLabel(s.lastSyncAt).toLowerCase()}` : ''}</>}
        {s.connected && s.lastError && <span role="alert" className="text-crimson">{s.lastError}</span>}
      </span>
      {s.connected && s.folderUrl && (
        <a href={s.folderUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 hover:underline focus-visible:focus-ring">Open folder</a>
      )}
      {s.connected
        ? <Button size="sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onError: fail })}>Disconnect</Button>
        : <Button size="sm" variant="primary" disabled={connect.isPending} onClick={() => connect.mutate(undefined, { onError: fail })}>Connect Google Drive</Button>}
      {s.connected && s.lastError && <Button size="sm" variant="primary" disabled={connect.isPending} onClick={() => connect.mutate(undefined, { onError: fail })}>Reconnect</Button>}
    </div>
  )
}
