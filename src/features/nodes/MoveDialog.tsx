import { NO_PERMISSION_TITLE, useAllowed, usePermissions } from '@/lib/permissions'
import { moduleForDomain, salesPersonRow } from '@/lib/routeModules'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { CodeChip } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { useMoveTargets, useNodeMutations } from '@/lib/api'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

export function MoveDialog({ open, node, stateCode, onClose }: {
  open: boolean
  node: HierNode | null
  stateCode: number
  onClose: () => void
}) {
  const toast = useToast()
  const { move } = useNodeMutations()
  const allowed = useAllowed(moduleForDomain(node?.domain), 'update')
  const { data: targets = [] } = useMoveTargets(node?.id ?? null)
  const [pick, setPick] = useState<string | null>(null)
  // Picking a target and confirming the move are two separate steps —
  // moving a node relocates its entire subtree, so a single click that also
  // doubles as "select this row" made it too easy to move something by
  // accident. `confirming` gates a second, explicit "are you sure" step
  // (mirroring ConfirmDeleteDialog's pattern) between the picker and the
  // actual mutation; "Move here" only opens that step, it never moves
  // anything itself.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => { if (open) { setPick(null); setConfirming(false) } }, [open])

  const canTopLevel = node?.typeKey === 'department'
  const pickedLabel = pick === '__root__' ? 'Top level (department root)' : targets.find((t) => t.id === pick)?.name ?? ''

  async function submit() {
    if (!node) return
    const target = pick === '__root__' ? null : pick
    if (pick === null) return
    await move.mutateAsync({ id: node.id, newParentId: target })
    toast(`Moved ${node.name}`)
    onClose()
  }

  if (confirming) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={`Move ${node?.name ?? ''}?`}
        description="Its entire subtree moves with it."
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={move.isPending}>Back</Button>
            <Button variant="primary" onClick={submit} disabled={(move.isPending) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
              {move.isPending ? 'Moving…' : 'Move here'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Move <span className="font-medium text-ink-900">{node?.name}</span> under{' '}
          <span className="font-medium text-ink-900">{pickedLabel}</span>? Its entire subtree moves with it.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Move ${node?.name ?? ''}`}
      description="Choose a new parent. Its subtree moves with it."
      footer={
        <>
          <Button onClick={onClose} disabled={move.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => setConfirming(true)} disabled={(pick === null || move.isPending) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
            Move here
          </Button>
        </>
      }
    >
      <div className="max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
        {canTopLevel && (
          <Row
            active={pick === '__root__'}
            onClick={() => setPick('__root__')}
            icon="Building2"
            label="Top level (department root)"
            typeLabel="Root"
            code={null}
          />
        )}
        {targets.map((t) => (
          <Row
            key={t.id}
            active={pick === t.id}
            onClick={() => setPick(t.id)}
            icon={NODE_TYPE_MAP[t.typeKey]?.icon ?? 'Hash'}
            label={t.name}
            typeLabel={NODE_TYPE_MAP[t.typeKey]?.label ?? t.typeKey}
            code={t.code}
          />
        ))}
        {targets.length === 0 && !canTopLevel && (
          <p className="py-8 text-center text-sm text-muted">No valid destinations in state {stateCode}.</p>
        )}
      </div>
    </Dialog>
  )
}

function Row({ active, onClick, icon, label, typeLabel, code }: {
  active: boolean; onClick: () => void; icon: string; label: string; typeLabel: string; code: string | null
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        active ? 'border-ink-600 bg-ink-900/[0.05]' : 'border-transparent hover:bg-ink-900/[0.03]',
      )}
    >
      <Icon name={icon} className="text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-ink-900">{label}</span>
        <span className="text-[11px] uppercase tracking-wide text-muted">{typeLabel}</span>
      </span>
      <CodeChip code={code} />
      {active && <Icon name="Check" size={15} className="text-teal-600" />}
    </button>
  )
}
