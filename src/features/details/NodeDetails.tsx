import { motion } from 'framer-motion'
import {
  useAllEmployees, useBreadcrumb, useChildren, useEmployeesUnder, useNode, useNodeMutations,
} from '@/lib/api'
import { NODE_TYPE_MAP, childTypesOf } from '@/lib/node-types'
import { useWorkspace } from '@/features/workspace/context'
import { fieldsForType } from '@/features/nodes/metadata-fields'
import { abbreviateDepartmentName } from '@/features/nodes/department-meta'
import { parseContactNumbers, type ContactNumberEntry } from '@/features/nodes/contact-numbers'
import { parseOfficeLocations } from '@/features/nodes/office-locations'
import { DepartmentSection } from './DepartmentSection'
import { Button } from '@/components/ui/Button'
import { Menu, MenuItem, MenuDivider } from '@/components/ui/Menu'
import { FitText } from '@/components/ui/FitText'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, CodeChip } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

const EMPLOYEE_ADDERS = new Set(['department', 'branch', 'division', 'office', 'unit'])

const FIELD_ICON: Record<string, string> = {
  url: 'Globe', email: 'Mail', phone: 'Phone', text: 'FileText', string: 'Type',
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

  // Item 2: DepartmentFields.tsx writes each contact number's own
  // State/District/City/STD/Number to metadata.contactNumbers — resolved
  // and rendered here so it's actually visible after saving, not just
  // captured on the form. The two legacy args are an older department's
  // section-level contactStateNodeId/contactDistrictNodeId (predating
  // per-row geography), used as a fallback for any entry missing its own.
  const contactNumbers = parseContactNumbers(
    node.metadata.contactNumbers, node.metadata.contactStateNodeId, node.metadata.contactDistrictNodeId,
  ).filter((c) => c.city || c.stdCode || c.number)
  const type = NODE_TYPE_MAP[node.typeKey]
  const childType = childTypesOf(node.typeKey)[0]
  // `childTypesOf` falls back to every type in the domain once a type's own
  // `childKeys` is empty (used elsewhere so a bare leaf still offers a full
  // type picker) — that fallback would wrongly suggest a real child type here
  // for true leaves like `unit`, so this only trusts an explicitly declared one.
  const hasRealChildType = (NODE_TYPE_MAP[node.typeKey]?.childKeys.length ?? 0) > 0
  const allFields = fieldsForType(node.typeKey, node.domain).filter((f) =>
    f.key === 'officeAddress'
      ? parseOfficeLocations(node.metadata.officeAddresses, node.metadata.officeAddress).length > 0
      : !!node.metadata[f.key],
  )
  const descriptionField = allFields.find((f) => f.key === 'description')
  const fields = allFields.filter((f) => f.key !== 'description')
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
          {trail.filter((t) => !(isDepartment && t.id === node.id)).map((t, i) => (
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
            <div className="flex items-center gap-2">
              {!isDepartment && <span className="eyebrow break-words">{type?.label}</span>}
              {isDepartment && (
                <span className="eyebrow break-words">
                  {node.metadata.shortName || abbreviateDepartmentName(`Department of ${node.name}`)}
                </span>
              )}
              {archived && <Badge tone="crimson">Archived</Badge>}
            </div>
            <h2 className="mt-0.5 break-words font-display text-2xl font-bold text-ink-900">
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
          {isOrgLeaf ? (
            <Menu
              trigger={({ toggle }) => (
                <Button variant="primary" size="sm" onClick={toggle}>
                  <Icon name="Plus" size={14} /> Add employee
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<Icon name="UserPlus" size={15} />} onClick={() => { close(); ws.addEmployee(node) }}>
                    Add employee
                  </MenuItem>
                  <MenuItem icon={<Icon name="Users" size={15} />} onClick={() => { close(); ws.selectEmployee(node) }}>
                    Select employee
                  </MenuItem>
                  {hasRealChildType && (
                    <MenuItem icon={<Icon name="GitBranch" size={15} />} onClick={() => { close(); ws.createChild(node) }}>
                      Add {childType!.label.toLowerCase()}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          ) : childType && (
            <Button variant="primary" size="sm" onClick={() => ws.createChild(node)}>
              <Icon name="Plus" size={14} /> Add {childType.label.toLowerCase()}
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
        {descriptionField && (
          <Section title="Description">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-800">
              {node.metadata[descriptionField.key]}
            </p>
          </Section>
        )}

        {(fields.length > 0 || contactNumbers.length > 0) && (
          <Section title={isDepartment ? 'Department Contact' : 'Details'}>
            {fields.length > 0 && (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <DetailRow key={f.key} label={f.label} icon={FIELD_ICON[f.type]}>
                    {f.type === 'url' ? (
                      <a
                        href={node.metadata[f.key]}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 break-words text-teal-600 hover:underline"
                      >
                        <span className="break-all">{node.metadata[f.key]}</span> <Icon name="ExternalLink" size={12} className="shrink-0" />
                      </a>
                    ) : f.type === 'email' ? (
                      <a href={`mailto:${node.metadata[f.key]}`} className="break-all text-teal-600 hover:underline">
                        {node.metadata[f.key]}
                      </a>
                    ) : f.type === 'phone' ? (
                      <a href={`tel:${node.metadata[f.key]}`} className="text-teal-600 hover:underline">
                        {node.metadata[f.key]}
                      </a>
                    ) : f.key === 'officeAddress' && isDepartment ? (
                      <ul className="space-y-2">
                        {parseOfficeLocations(node.metadata.officeAddresses, node.metadata.officeAddress).map((location) => (
                          <li key={location.id} className="break-words">
                            <span className="font-medium text-ink-800">{location.label}</span>
                            <p className="whitespace-pre-wrap">{location.address}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      node.metadata[f.key]
                    )}
                  </DetailRow>
                ))}
              </dl>
            )}

            {contactNumbers.length > 0 && (
              <div className={cn(fields.length > 0 ? 'mt-4' : undefined)}>
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Contact numbers</p>
                <ul className="space-y-2">
                  {contactNumbers.map((c, i) => (
                    <ContactNumberDisplayItem key={i} entry={c} />
                  ))}
                </ul>
              </div>
            )}
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
                  <Avatar person={{ name: e.name, photoUrl: e.photoUrl, vacant: e.vacant }} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block break-words text-sm font-medium', e.vacant ? 'text-amber-600' : 'text-ink-900')}>
                      {e.vacant ? 'Vacant position' : e.name}
                    </span>
                    <span className="block break-words text-xs text-muted">{e.designation}</span>
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
                  <span className="min-w-0 flex-1 break-words text-sm text-ink-900">{c.name}</span>
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

/** One contact number's read-only row — each entry now owns its own
 *  State/District (see ContactNumberRow.tsx), so resolving names needs its
 *  own `useNode` calls per item, not one shared pair for the whole list. */
function ContactNumberDisplayItem({ entry }: { entry: ContactNumberEntry }) {
  const { data: stateNode } = useNode(entry.stateNodeId || null)
  const { data: districtNode } = useNode(entry.districtNodeId || null)
  // Landline/EPBX numbers are stored as a bare local number (STD code lives
  // in its own field, already carrying its own leading 0 — e.g. "0674" —
  // and is never concatenated with +91, see PhoneInput.tsx) — the
  // trunk-dialable `tel:` form needs the STD code back in front of it,
  // which the domestic display text also shows explicitly rather than
  // relying on the separate "STD ..." label alone.
  const isMobile = entry.type === 'mobile'
  const displayNumber = isMobile || !entry.stdCode ? entry.number : `${entry.stdCode} ${entry.number}`
  const telHref = isMobile
    ? entry.number.replace(/\s+/g, '')
    : `${entry.stdCode ?? ''}${entry.number}`.replace(/\D/g, '')

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-900">
      {stateNode && <span className="text-muted">{stateNode.name}</span>}
      {districtNode && <span className="text-muted">· {districtNode.name}</span>}
      {entry.city && <span className="font-medium">{entry.city}</span>}
      {entry.stdCode && <span className="text-muted">STD {entry.stdCode}</span>}
      {entry.number && (
        <a href={`tel:${telHref}`} className="text-teal-600 hover:underline">
          {displayNumber}
        </a>
      )}
    </li>
  )
}

function DetailRow({ label, icon, children }: { label: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        {icon && <Icon name={icon} size={12} className="shrink-0" />}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-900">
        <FitText>{children}</FitText>
      </dd>
    </div>
  )
}
