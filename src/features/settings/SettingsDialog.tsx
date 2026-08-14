import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { getFullSnapshot, restoreFromBackup } from '@/data/repository'
import { downloadBackup, parseBackupFile } from '@/data/backup'
import type { GormsData } from '@/data/seed'

/** Whole-app JSON backup/restore — separate from `ExportDialog`/`ImportDialog`,
 *  which only handle Account Mapping's CSV datasets. This covers every
 *  collection in `GormsData`, including Sales and the Commercial Calculator
 *  module. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ data: GormsData; exportedAt: string } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      await downloadBackup(getFullSnapshot())
      toast('Backup downloaded.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create backup.')
    } finally {
      setExporting(false)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setRestoreError(null)
    f.text().then((text) => {
      const result = parseBackupFile(text)
      if (!result.ok) {
        setRestoreError(result.error)
        return
      }
      setPendingRestore({ data: result.data, exportedAt: result.exportedAt })
    })
  }

  async function confirmRestore() {
    if (!pendingRestore) return
    setRestoring(true)
    try {
      restoreFromBackup(pendingRestore.data)
      await qc.invalidateQueries()
      toast('Backup restored.')
      setPendingRestore(null)
      onClose()
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Could not restore this backup.')
    } finally {
      setRestoring(false)
    }
  }

  function handleClose() {
    setPendingRestore(null)
    setRestoreError(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Settings"
      description="Back up every record in GOMS to a file, or restore from one taken earlier."
      size="lg"
      footer={<Button onClick={handleClose}>Close</Button>}
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Export full backup</h3>
          <p className="text-[13px] text-muted">Downloads every record — hierarchy, people, sales, and Commercial Calculator data — as one JSON file.</p>
          <Button variant="primary" onClick={handleExport} disabled={exporting}>
            <Icon name="Download" size={14} />
            {exporting ? 'Preparing…' : 'Export full backup (JSON)'}
          </Button>
        </section>

        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Restore from backup</h3>
          <p className="text-[13px] text-muted">Replaces all data currently on this device. This can't be undone.</p>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
          <Button onClick={() => fileInputRef.current?.click()}>
            <Icon name="Upload" size={14} />
            Choose backup file…
          </Button>
          {restoreError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{restoreError}</p>
          )}
          {pendingRestore && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-[13px] text-amber-800">
                <Icon name="TriangleAlert" size={14} />
                Restore the backup from {pendingRestore.exportedAt ? new Date(pendingRestore.exportedAt).toLocaleString() : 'an unknown date'}? All current data on this device will be overwritten.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setPendingRestore(null)} disabled={restoring}>Cancel</Button>
                <Button variant="danger" onClick={confirmRestore} disabled={restoring}>
                  {restoring ? 'Restoring…' : 'Restore and overwrite'}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  )
}
