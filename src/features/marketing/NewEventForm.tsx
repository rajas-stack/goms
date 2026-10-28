import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input } from '@/components/ui/Field'
import { PersonName } from '@/components/ui/PersonName'
import { useToast } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { useAllEmployees, useEmployeeMutations, useNodeMutations, useStates } from '@/lib/api'
import { useClientDepartmentOptions } from '@/features/masters/useMasterOptions'
import {
  autoMatchDepartments, deptKey, matchParticipants, NO_DESIGNATION, readParticipantsFile, stateCodeFor, type MarketingEvent, type Participant,
} from './eventParticipants'
import { EventDetailsFields, emptyEventInfo, type EventInfo } from './EventDetailsFields'

/** Upload → check who goes into the Directory (per person, per department) → save. Nothing is added until Save. A ticked
 *  person whose department isn't picked goes into a new department of that name, created under their State on save. */
export function NewEventForm({ onCreated, onCancel }: { onCreated: (e: MarketingEvent) => void; onCancel?: () => void }) {
  const toast = useToast()
  const { data: departments = [] } = useClientDepartmentOptions()
  const { data: states = [] } = useStates()
  const { data: people = [] } = useAllEmployees()
  const { importEmployees } = useEmployeeMutations()
  const { create: createNode } = useNodeMutations()
  const [info, setInfo] = useState<EventInfo>(emptyEventInfo)
  const [participants, setParticipants] = useState<Participant[]>([])
  /** dept key → Directory department id ('' = not matched yet). */
  const [deptMap, setDeptMap] = useState<Map<string, string>>(new Map())
  /** Participant indexes ticked to be added. */
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stateNames = useMemo(() => new Map(states.map((s) => [s.code, s.name])), [states])
  const deptOptions = useMemo(() => departments.map((d) => ({ value: d.id, label: `${d.name} · ${stateNames.get(d.stateCode ?? -1) ?? '—'}` })), [departments, stateNames])
  const existing = useMemo(() => matchParticipants(participants, people), [participants, people])
  const groups = useMemo(() => {
    const byKey = new Map<string, number[]>()
    participants.forEach((p, i) => byKey.set(deptKey(p), [...(byKey.get(deptKey(p)) ?? []), i]))
    return [...byKey].sort(([a], [b]) => Number(!!deptMap.get(a)) - Number(!!deptMap.get(b))) // unmatched first
  }, [participants]) // eslint-disable-line react-hooks/exhaustive-deps -- order is fixed at upload, not re-sorted while picking
  /** '' when the department can neither be picked nor created (no dept name, or a State the Directory doesn't know). */
  const newDeptState = (p: Participant) => (p.dept ? stateCodeFor(p.state, stateNames) : null)
  const addable = (i: number) => !existing[i] && (!!deptMap.get(deptKey(participants[i])) || newDeptState(participants[i]) != null)
  const toAdd = [...picked].filter(addable)
  const toCreate = new Set(toAdd.filter((i) => !deptMap.get(deptKey(participants[i]))).map((i) => deptKey(participants[i]))).size

  const toggle = (indexes: number[], on: boolean) => setPicked((s) => {
    const next = new Set(s)
    for (const i of indexes) if (on) next.add(i); else next.delete(i)
    return next
  })

  const readFile = async (file: File | undefined) => {
    setError(null); setParticipants([]); setPicked(new Set())
    if (!file) return
    try {
      const list = readParticipantsFile(await file.arrayBuffer())
      if (!list.length) return setError('No participants found in that file.')
      const known = matchParticipants(list, people)
      setDeptMap(autoMatchDepartments(list, departments, stateNames))
      setParticipants(list)
      setPicked(new Set(list.flatMap((_, i) => (known[i] ? [] : [i]))))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read that file.') }
  }

  const save = async () => {
    setError(null)
    if (!info.name.trim()) return setError('Give the event a name.')
    if (!info.date) return setError('Give the event a start date.')
    if (!participants.length) return setError('Upload the participant list (.xlsx, .xls or .csv).')
    setSaving(true)
    try {
      const byNode = new Map<string, { name: string; designation: string; connected: boolean }[]>()
      const created = new Map(deptMap)
      for (const i of toAdd) {
        const p = participants[i]
        if (!created.get(deptKey(p))) {
          const node = await createNode.mutateAsync({ domain: 'org', typeKey: 'department', parentId: null, stateCode: newDeptState(p), name: p.dept })
          created.set(deptKey(p), node.id)
        }
        const nodeId = created.get(deptKey(p))!
        byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), { name: p.name, designation: p.designation || NO_DESIGNATION, connected: false }])
      }
      // Before/after diff gives the new records' ids, so the event can remove exactly them later.
      const before = new Set((await repository.listAllEmployees()).map((e) => e.id))
      for (const [orgNodeId, rows] of byNode) await importEmployees.mutateAsync({ orgNodeId, rows })
      const addedIds = byNode.size ? (await repository.listAllEmployees()).filter((e) => !before.has(e.id)).map((e) => e.id) : []
      toast(`${participants.length} participants · ${addedIds.length} added to Directory`)
      onCreated({ ...info, id: crypto.randomUUID(), name: info.name.trim(), participants, addedIds })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add the participants.') }
    finally { setSaving(false) }
  }

  return (
    <section className="max-w-6xl space-y-3 rounded-xl border border-line bg-white p-5">
      <h1 className="text-lg font-semibold text-ink-900">New event</h1>
      <EventDetailsFields value={info} onChange={setInfo} />
      <Field label="Participant list" required>
        <Input type="file" aria-label="Participant list" accept=".xlsx,.xls,.csv" onChange={(e) => void readFile(e.target.files?.[0])} />
      </Field>
      <p className="text-[12px] text-muted">First row must have the column headers: Name, Designation, Dept, and optionally State (helps when a department name exists in several states).</p>
      {groups.length > 0 && <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            Check who to add · {participants.length} participants, {groups.length} departments
            {toCreate > 0 && <span className="font-normal text-muted"> · {toCreate} new departments will be created — or pick an existing one</span>}
          </h2>
          <span className="flex gap-1">
            <Button size="sm" onClick={() => toggle(participants.map((_, i) => i), true)}>Select all</Button>
            <Button size="sm" onClick={() => setPicked(new Set())}>Select none</Button>
          </span>
        </div>
        <ul className="max-h-[calc(100vh-14rem)] min-h-[20rem] overflow-auto rounded-lg border border-line">
          {groups.map(([key, idx]) => {
            const first = participants[idx[0]]
            const candidates = idx.filter(addable)
            const on = candidates.filter((i) => picked.has(i)).length
            return (
              <li key={key} className="border-b border-line last:border-b-0">
                <div className="sticky top-0 z-[1] grid items-center gap-2 bg-paper px-3 py-1.5 sm:grid-cols-[auto_1fr_minmax(0,22rem)]">
                  <Checkbox aria-label={`Add everyone from ${first.dept || 'no department'}`} disabled={!candidates.length}
                    checked={!!candidates.length && on === candidates.length} indeterminate={on > 0 && on < candidates.length}
                    onChange={(v) => toggle(candidates, v)} />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium text-ink-900">{first.dept || 'No department'}</span>
                    <span className="text-[12px] text-muted">{[first.state, `${on} of ${idx.length} to add`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Combobox aria-label={`Directory department for ${first.dept || 'no department'}`} value={deptMap.get(key) ?? ''}
                    placeholder={newDeptState(first) != null ? `New: ${first.dept} · ${first.state}` : 'Choose a Directory department…'}
                    onChange={(v) => setDeptMap((m) => new Map(m).set(key, v))} options={deptOptions} />
                </div>
                <ul className="grid gap-x-4 py-1 pl-9 pr-3 sm:grid-cols-2 xl:grid-cols-3">
                  {idx.map((i) => (
                    <li key={i} className="flex min-w-0 items-center gap-3 py-1">
                      <Checkbox aria-label={`Add ${participants[i].name}`} disabled={!addable(i)} checked={addable(i) && picked.has(i)} onChange={(v) => toggle([i], v)} />
                      <PersonName person={{ id: existing[i]?.id, name: participants[i].name, photoUrl: existing[i]?.photoUrl }} size="xs" subtitle={participants[i].designation} className="flex-1" />
                      {existing[i] && <span className="text-[12px] text-muted">Already in Directory</span>}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      </div>}
      {error && <p role="alert" className="rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Adding…' : toAdd.length ? `Save event & add ${toAdd.length} to Directory` : 'Save event'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </section>
  )
}
