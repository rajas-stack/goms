import { useState } from 'react'
import type { EmailEntityRef } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useNodeAccess } from '@/lib/rbacTree/access'
import { EmailWorkspace } from './EmailWorkspace'

export function EmailQuickPanel({ entity, title }: { entity: EmailEntityRef; title?: string }) {
  const [open, setOpen] = useState(false); const visible = useNodeAccess('email', 'view')
  if (!visible) return null
  return <><Button size="sm" onClick={() => setOpen(true)}><Icon name="Mail" size={14} />Communication</Button>{open && <Dialog open onClose={() => setOpen(false)} title={title ? `Communication · ${title}` : 'Record communication'} size="xl"><div className="h-[75vh] min-h-80"><EmailWorkspace entity={entity} title="Communication" compact /></div></Dialog>}</>
}
