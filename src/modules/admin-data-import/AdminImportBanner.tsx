import { Icon } from '@/components/ui/Icon'

export function AdminImportBanner() {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber/30 bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-600">
      <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
      <p>
        <span className="font-medium">Admin only.</span> Restricted to an explicit allow-list of authorized Google
        accounts, enforced server-side. Contact an administrator if you need access.
      </p>
    </div>
  )
}
