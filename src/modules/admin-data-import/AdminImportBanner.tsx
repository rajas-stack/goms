export function AdminImportBanner() {
  return (
    <div role="alert" className="rounded border border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      ⚠ Admin only — access control not yet enforced. Anyone who can reach this page can import
      data. Do not enable this in production before authentication ships.
    </div>
  )
}
