export function AdminImportBanner() {
  return (
    <div role="alert" className="rounded border border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      ⚠ Admin only — restricted to an explicit allow-list of authorized Google accounts, enforced
      server-side. Contact an administrator if you need access.
    </div>
  )
}
