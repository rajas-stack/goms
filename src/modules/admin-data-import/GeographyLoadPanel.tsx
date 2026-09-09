import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminImportBanner } from './AdminImportBanner'
import { useCommitGeographyLoad, usePreviewGeographyLoad, type ImportSummary } from './api'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

export function GeographyLoadPanel() {
  const [result, setResult] = useState<ImportSummary | null>(null)
  const preview = usePreviewGeographyLoad()
  const commit = useCommitGeographyLoad()

  const data = preview.data
  const reconciliation = data?.reconciliation

  return (
    <div className="h-full space-y-4 overflow-y-auto scrollbar-thin p-6">
      <AdminImportBanner />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold text-ink-900">Geography</h1>
        <Link
          to="/admin/data-import"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-ink-900/[0.05] hover:text-ink"
        >
          <Icon name="ArrowLeft" size={14} /> Back to Data Import
        </Link>
      </div>

      <p className="text-[13px] text-muted">
        Geography has no template and no upload — the official LGD dataset ships with the API. This compares that dataset
        against the current geography tree and shows what would change. Safe to run repeatedly.
      </p>

      <Button
        variant="primary"
        onClick={() => {
          setResult(null)
          preview.mutate()
        }}
        disabled={preview.isPending}
      >
        <Icon name="MapPin" size={14} /> Load/Update Official Geography Dataset
      </Button>

      {preview.isPending && <p className="text-[13px] text-muted">Comparing against the current geography tree…</p>}
      {preview.isError && (
        <p role="alert" className="rounded-lg border border-crimson/30 bg-crimson-100 px-3.5 py-2.5 text-[13px] text-crimson">
          Could not read the bundled dataset: {(preview.error as Error).message}
        </p>
      )}

      {data && !result && (
        <>
          {/* Counts only, no per-row grid: 7,000+ rows is not a reviewable
              spreadsheet, so the reconciliation check below is what stands in
              for row-by-row review. */}
          <div className="flex flex-wrap gap-2 text-[12px]">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-600">{data.summary.toCreate} to create</span>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 font-medium text-blue-600">{data.summary.toUpdate} to update</span>
            <span className="rounded-full bg-panel px-2.5 py-1 font-medium text-muted">{data.summary.unchanged} unchanged</span>
          </div>

          {reconciliation!.matches ? (
            <p className="flex items-center gap-1.5 text-[13px] text-emerald-600">
              <Icon name="Check" size={14} /> Reconciliation OK — all {reconciliation!.sourceRowCount} source rows accounted for.
            </p>
          ) : (
            <p role="alert" className="rounded-lg border border-crimson/30 bg-crimson-100 px-3.5 py-2.5 text-[13px] text-crimson">
              Reconciliation mismatch — {reconciliation!.sourceRowCount} source rows but only{' '}
              {reconciliation!.classifiedRowCount} were classified. Commit is blocked.
            </p>
          )}

          <Button
            variant="primary"
            disabled={!reconciliation!.matches || commit.isPending}
            onClick={() =>
              commit.mutate({ commitToken: data.commitToken }, { onSuccess: (r) => setResult(r.summary) })
            }
          >
            Confirm Commit
          </Button>
        </>
      )}

      {commit.isError && (
        <p role="alert" className="rounded-lg border border-crimson/30 bg-crimson-100 px-3.5 py-2.5 text-[13px] text-crimson">
          Nothing was written — the load was rolled back. {(commit.error as Error).message}
        </p>
      )}

      {result && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald/30 bg-emerald-100 px-4 py-3 text-[13px] text-emerald-600">
          <Icon name="Check" size={16} className="mt-0.5 shrink-0" />
          <div>
            <h2 className="font-medium">Geography load complete</h2>
            <p>
              {result.toCreate} created, {result.toUpdate} updated, {result.unchanged} unchanged.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
