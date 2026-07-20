import { motion } from 'framer-motion'
import {
  useAllEmployees, useBreadcrumb, useChildren, useEmployeesUnder, useNode, useNodeMutations,
} from '@/lib/api'
import { NODE_TYPE_MAP, childTypesOf } from '@/lib/node-types'
import { useWorkspace } from '@/features/workspace/context'
import { fieldsForType } from '@/features/nodes/metadata-fields'
import { DepartmentSection } from './DepartmentSection'
import { Button } from '@/components/ui/Button'
import { Menu, MenuItem, MenuDivider } from '@/components/ui/Menu'
import { Icon } from '@/components/ui/Icon'
import { Badge, CodeChip } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

const EMPLOYEE_ADDERS = new Set(['office', 'unit'])

const FIELD_ICON: Record<string, string> = {
  phone: 'Phone', email: 'Mail', url: 'Globe', text: 'FileText', string: 'Type',
}

export function NodeDetails({ nodeId }: { nodeId: string }) {
  const ws = useWorkspace()
  const toast = useToast()
  const { setStatus } = useNodeMutations()
  const { data: node } = useNode(nodeId)
  const { data: trail = [] } = useBreadcrumb(nodeId)
  const { data: children = [] } = useChildren(nodeId)
  const { data: allEmployees = [] } = useAllEmployees()
  const isOrgLeaf = !!node && node.domain === 'org' && EMPLOYEE_ADDERS.has(node.typeKey)
  const { data: employees = [] } = useEmployeesUnder(node && node.domain === 'org' ? nodeId : null)

  if (!node) return null
  const type = NODE_TYPE_MAP[node.typeKey]
  const childType = childTypesOf(node.typeKey)[0]
  const fields = fieldsForType(node.typeKey, node.domain).filter((f) => node.metadata[f.key])
  const archived = node.status === 'archived'
  const isDepartment = node.typeKey === 'department'
  const vacant = employees.filter((e) => e.vacant).length
  const occupied = employees.length - vacant

  return (
    <motion.div
      key={nodeId}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col"
    >
      <div className="border-b border-line px-6 py-5">
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-[12px] text-muted">
          {trail.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1">
              {i > 0 && <Icon name="ChevronRight" size={12} className="text-line" />}
              <button
                onClick={() => ws.select('node', t.id)}
                className={cn('rounded px-1 hover:text-ink', t.id === node.id && 'font-medium text-ink-900')}
              >
                {t.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-start gap-3">
          <span className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            node.domain === 'geo' ? 'bg-teal-100 text-teal-600' : 'bg-ink-900 text-paper',
          )}>
            <Icon name={type?.icon ?? 'Hash'} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            {(!isDepartment || archived) && (
              <div className="flex items-center gap-2">
                {!isDepartment && <span className="eyebrow truncate">{type?.label}</span>}
                {archived && <Badge tone="crimson">Archived</Badge>}
              </div>
            )}
            <h2 className="mt-0.5 truncate font-display text-2xl font-bold text-ink-900">
              {isDepartment ? `Department of ${node.name}` : node.name}
            </h2>
            {!isDepartment && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <CodeChip code={node.code} />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {childType && (
            <Button variant="primary" size="sm" onClick={() => (isOrgLeaf ? ws.addEmployee(node) : ws.createChild(node))}>
              <Icon name={isOrgLeaf ? 'User' : 'Plus'} size={14} />
              {isOrgLeaf ? 'Add employee' : `Add ${childType.label.toLowerCase()}`}
            </Button>
          )}
          <Button size="sm" onClick={() => ws.editNode(node)}><Icon name="Pencil" size={14} /> Edit</Button>

          {/* Destructive / structural actions tucked into an overflow menu so they can't be hit by accident */}
          <Menu
            align="end"
            trigger={({ open, toggle }) => (
              <Button
                size="icon"
                variant="ghost"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                className={cn(open && 'bg-ink-900/[0.05] text-ink')}
              >
                <Icon name="MoreHorizontal" size={16} />
              </Button>
            )}
          >
            {(close) => (
              <>
                {node.parentId !== undefined && (
                  <MenuItem icon={<Icon name="MoveRight" size={15} />} onClick={() => { close(); ws.moveNode(node) }}>
                    Move
                  </MenuItem>
                )}
                <MenuItem
                  icon={<Icon name={archived ? 'ArchiveRestore' : 'Archive'} size={15} />}
                  onClick={async () => {
                    close()
                    await setStatus.mutateAsync({ id: node.id, status: archived ? 'active' : 'archived' })
                    toast(archived ? 'Restored' : 'Archived')
                  }}
                >
                  {archived ? 'Restore' : 'Archive'}
                </MenuItem>
                <MenuDivider />
                <MenuItem icon={<Icon name="Trash2" size={15} />} danger onClick={() => { close(); ws.deleteNode(node) }}>
                  Delete
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scrollbar-thin px-6 py-5">
        {fields.length > 0 && (
          <Section title="Details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="flex min-w-0 items-start gap-2.5 rounded-lg border border-line bg-white px-3 py-2.5">
                  <Icon name={FIELD_ICON[f.type] ?? 'FileText'} size={15} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wide text-muted">{f.label}</span>
                    {f.type === 'url' ? (
                      <a
                        href={node.metadata[f.key]}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 break-words text-sm text-teal-600 hover:underline"
                      >
                        <span className="break-all">{node.metadata[f.key]}</span> <Icon name="ExternalLink" size={12} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="mt-0.5 block break-words text-sm text-ink-900">{node.metadata[f.key]}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {node.typeKey === 'department' && <DepartmentSection node={node} employees={allEmployees} />}

        {node.domain === 'org' && employees.length > 0 && (
          <Section title={`Positions · ${occupied} occupied${vacant > 0 ? ` · ${vacant} vacant` : ''}`}>
            <div className="space-y-1">
              {employees.slice(0, 40).map((e) => (
                <button
                  key={e.id}
                  onClick={() => ws.select('employee', e.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-900/[0.04]"
                >
                  <span className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg font-mono text-[11px] font-semibold',
                    e.vacant ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600',
                  )}>
                    {e.vacant ? <Icon name="UserX" size={14} /> : e.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium', e.vacant ? 'text-amber-600' : 'text-ink-900')}>
                      {e.vacant ? 'Vacant position' : e.name}
                    </span>
                    <span className="block truncate text-xs text-muted">{e.designation}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title={`${childType?.label ?? 'Children'} · ${children.length}`}>
          {children.length === 0 ? (
            <p className="text-sm text-muted">Nothing here yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => ws.select('node', c.id)}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left transition-colors hover:border-ink-600"
                >
                  <Icon name={NODE_TYPE_MAP[c.typeKey]?.icon ?? 'Hash'} size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </motion.div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[13px] font-semibold text-ink-800">{title}</h3>
      {children}
    </section>
  )
}
