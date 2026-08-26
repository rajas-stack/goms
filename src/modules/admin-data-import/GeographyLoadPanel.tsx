import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminImportBanner } from './AdminImportBanner'
import { useCommitGeographyLoad, usePreviewGeographyLoad, type ImportSummary } from './api'

export function GeographyLoadPanel() {
  const [result, setResult] = useState<ImportSummary | null>(null)
  const preview = usePreviewGeographyLoad()
  const commit = useCommitGeographyLoad()

  const data = preview.data
  const reconciliation = data?.reconciliation

  return (
    <div className="space-y-4 p-6">
      <AdminImportBanner />
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Geography</h1>
        <Link to="/admin/data-import" className="text-sky-700 underline">
          Back to Data Import
        </Link>
      </div>

      <p className="text-sm text-slate-600">
        Geography has no template and no upload — the official LGD dataset ships with the API. This compares that dataset
        against the current geography tree and shows what would change. Safe to run repeatedly.
      </p>

      <button
        type="button"
        onClick={() => {
          setResult(null)
          preview.mutate()
        }}
        disabled={preview.isPending}
        className="rounded bg-sky-700 px-3 py-1 text-white disabled:bg-slate-300"
      >
        Load/Update Official Geography Dataset
      </button>

      {preview.isPending && <p>Comparing against the current geography tree…</p>}
      {preview.isError && (
        <p role="alert" className="text-rose-700">
          Could not read the bundled dataset: {(preview.error as Error).message}
        </p>
      )}

      {data && !result && (
        <>
          {/* Counts only, no per-row grid: 7,000+ rows is not a reviewable
              spreadsheet, so the reconciliation check below is what stands in
              for row-by-row review. */}
          <div className="flex gap-4 text-sm">
            <span>{data.summary.toCreate} to create</span>
            <span>{data.summary.toUpdate} to update</span>
            <span>{data.summary.unchanged} unchanged</span>
          </div>

          {reconciliation!.matches ? (
            <p className="text-emerald-700">
              Reconciliation OK — all {reconciliation!.sourceRowCount} source rows accounted for.
            </p>
          ) : (
            <p role="alert" className="text-rose-700">
              Reconciliation mismatch — {reconciliation!.sourceRowCount} source rows but only{' '}
              {reconciliation!.classifiedRowCount} were classified. Commit is blocked.
            </p>
          )}

          <button
            type="button"
            disabled={!reconciliation!.matches || commit.isPending}
            onClick={() =>
              commit.mutate({ commitToken: data.commitToken }, { onSuccess: (r) => setResult(r.summary) })
            }
            className="rounded bg-sky-700 px-3 py-1 text-white disabled:bg-slate-300"
          >
            Confirm Commit
          </button>
        </>
      )}

      {commit.isError && (
        <p role="alert" className="text-rose-700">
          Nothing was written — the load was rolled back. {(commit.error as Error).message}
        </p>
      )}

      {result && (
        <div className="rounded border border-emerald-500 bg-emerald-50 p-4">
          <h2 className="font-semibold">Geography load complete</h2>
          <p>
            {result.toCreate} created, {result.toUpdate} updated, {result.unchanged} unchanged.
          </p>
        </div>
      )}
    </div>
  )
}
